//! This module defines some types used to represent the information collected
//! from Gitee for each of the landscape items repositories (when applicable),
//! as well as the functionality used to collect that information.

use super::{cache::Cache, LandscapeData};
use anyhow::{format_err, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc, Duration};
use deadpool::unmanaged::{Object, Pool};
use futures::stream::{self, StreamExt};
use landscape2_core::data::{Commit, Contributors, GithubData, Release, RepositoryGithubData};
use lazy_static::lazy_static;
#[cfg(test)]
use mockall::automock;
use octorust::types::ParticipationStats;
use regex::Regex;
use reqwest::header::{self, HeaderMap, HeaderValue};
use std::collections::BTreeMap;
use std::env;
use tracing::{debug, instrument, warn};
use serde::{Serialize, Deserialize};
use serde_json::Value;

type GiteeData = GithubData;
type RepositoryGiteeData = RepositoryGithubData;

/// File used to cache data collected from Gitee.
const GITEE_CACHE_FILE: &str = "gitee.json";

/// How long the Gitee data in the cache is valid (in days).
const GITEE_CACHE_TTL: i64 = 7;

/// Environment variable containing a comma separated list of Gitee tokens.
const GITEE_TOKENS: &str = "GITEE_TOKENS";

/// Collect Gitee data for each of the items repositories in the landscape,
/// reusing cached data whenever possible.
#[instrument(skip_all, err)]
pub(crate) async fn collect_gitee_data(cache: &Cache, landscape_data: &LandscapeData) -> Result<GiteeData> {
    debug!("collecting repositories information from gitee (this may take a while)");

    // Read cached data (if available)
    let mut cached_data: Option<GiteeData> = None;
    match cache.read(GITEE_CACHE_FILE) {
        Ok(Some((_, json_data))) => match serde_json::from_slice(&json_data) {
            Ok(gitee_data) => cached_data = Some(gitee_data),
            Err(err) => warn!("error parsing gitee cache file: {err:?}"),
        },
        Ok(None) => {}
        Err(err) => warn!("error reading gitee cache file: {err:?}"),
    }

    // Setup Gitee API clients pool if any tokens have been provided
    let tokens: Option<Vec<String>> = match env::var(GITEE_TOKENS) {
        Ok(tokens) if !tokens.is_empty() => Some(tokens.split(',').map(ToString::to_string).collect()),
        Ok(_) | Err(_) => None,
    };
    let gt_pool: Option<Pool<DynGT>> = if let Some(tokens) = &tokens {
        let mut gt_clients: Vec<DynGT> = vec![];
        for token in tokens {
            let gt = Box::new(GTApi::new(token)?);
            gt_clients.push(gt);
        }
        Some(Pool::from(gt_clients))
    } else {
        warn!("gitee tokens not provided: no information will be collected from gitee");
        None
    };

    // Collect urls of the repositories to process
    let mut urls = vec![];
    for item in &landscape_data.items {
        if let Some(repositories) = &item.repositories {
            for repo in repositories {
                if GITEE_REPO_URL.is_match(&repo.url) {
                    urls.push(&repo.url);
                }
            }
        }
    }
    urls.sort();
    urls.dedup();

    // Collect repositories information from Gitee, reusing cached data when available
    let concurrency = if let Some(tokens) = tokens {
        tokens.len()
    } else {
        1
    };
    let gitee_data: GiteeData = stream::iter(urls)
        .map(|url| async {
            let url = url.clone();

            // Use cached data when available if it hasn't expired yet
            if let Some(cached_repo) = cached_data.as_ref().and_then(|cache| {
                cache.get(&url).and_then(|repo| {
                    if repo.generated_at + chrono::Duration::days(GITEE_CACHE_TTL) > Utc::now() {
                        Some(repo)
                    } else {
                        None
                    }
                })
            }) {
                (url, Ok(cached_repo.clone()))
            }
            // Otherwise we pull it from Gitee if any tokens were provided
            else if let Some(gt_pool) = &gt_pool {
                let gt = gt_pool.get().await.expect("token -when available-");
                (url.clone(), collect_repository_data(gt, &url).await)
            } else {
                (url.clone(), Err(format_err!("no tokens provided")))
            }
        })
        .buffer_unordered(concurrency)
        .collect::<BTreeMap<String, Result<RepositoryGiteeData>>>()
        .await
        .into_iter()
        .filter_map(|(url, result)| {
            if let Ok(gitee_data) = result {
                Some((url, gitee_data))
            } else {
                None
            }
        })
        .collect();

    // Write data (in json format) to cache
    cache.write(GITEE_CACHE_FILE, &serde_json::to_vec_pretty(&gitee_data)?)?;

    debug!("done!");
    Ok(gitee_data)
}

/// Collect repository data from Gitee.
#[instrument(skip_all, err)]
async fn collect_repository_data(gt: Object<DynGT>, repo_url: &str) -> Result<RepositoryGiteeData> {
    // Collect some information from Gitee
    let (owner, repo) = get_owner_and_repo(repo_url)?;
    let gt_repo = gt.get_repository(&owner, &repo).await?;
    let contributors_count = gt.get_contributors_count(&owner, &repo).await?;
    let license = gt.get_license(&owner, &repo).await?;
    let first_commit = gt.get_first_commit(&owner, &repo, &gt_repo.default_branch).await?;
    let languages = gt.get_languages(&owner, &repo).await?;
    let latest_commit = gt.get_latest_commit(&owner, &repo, &gt_repo.default_branch).await?;
    let latest_release = gt.get_latest_release(&owner, &repo).await?;
    let participation_stats = gt.get_participation_stats(&owner, &repo).await?.all;

    // Prepare repository instance using the information collected
    Ok(RepositoryGiteeData {
        generated_at: Utc::now(),
        contributors: Contributors {
            count: contributors_count,
            url: format!("https://gitee.com/{owner}/{repo}/graphs/contributors"),
        },
        description: gt_repo.description,
        first_commit,
        languages,
        latest_commit,
        latest_release,
        license: Some(license),
        participation_stats,
        stars: gt_repo.stargazers_count,
        topics: gt_repo.topics,
        url: gt_repo.html_url,
    })
}

/// Gitee API base url.
const GITEE_API_URL: &str = "https://gitee.com/api/v5/";

/// Type alias to represent a GT trait object.
type DynGT = Box<dyn GT + Send + Sync>;

/// Trait that defines some operations a GT implementation must support.
#[async_trait]
#[cfg_attr(test, automock)]
trait GT {
    /// Get number of repository contributors.
    async fn get_contributors_count(&self, owner: &str, repo: &str) -> Result<usize>;

    /// Get license.
    async fn get_license(&self, owner: &str, repo: &str) -> Result<String>;

    /// Get first commit.
    async fn get_first_commit(&self, owner: &str, repo: &str, ref_: &str) -> Result<Option<Commit>>;

    /// Get languages used in repository.
    async fn get_languages(&self, owner: &str, repo: &str) -> Result<Option<BTreeMap<String, i64>>>;

    /// Get latest commit.
    async fn get_latest_commit(&self, owner: &str, repo: &str, ref_: &str) -> Result<Commit>;

    /// Get latest release.
    async fn get_latest_release(&self, owner: &str, repo: &str) -> Result<Option<Release>>;

    /// Get participation stats.
    async fn get_participation_stats(&self, owner: &str, repo: &str) -> Result<ParticipationStats>;

    /// Get repository.
    async fn get_repository(&self, owner: &str, repo: &str) -> Result<PartRepository>;
}

/// GT implementation backed by the Gitee API.
struct GTApi {
    http_client: reqwest::Client,
}

// #[derive(Serialize, Deserialize)]
#[derive(Debug)]
struct PartRepository {
    // #[serde(
    //     default,
    //     skip_serializing_if = "String::is_empty",
    //     deserialize_with = "crate::utils::deserialize_null_string::deserialize"
    // )]
    pub default_branch: String,
    // #[serde(
    //     default,
    //     skip_serializing_if = "String::is_empty",
    //     deserialize_with = "crate::utils::deserialize_null_string::deserialize"
    // )]
    pub description: String,
    // #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<Vec<String>>,
    // #[serde(
    //     default,
    //     skip_serializing_if = "crate::utils::zero_i64",
    //     deserialize_with = "crate::utils::deserialize_null_i64::deserialize"
    // )]
    pub stargazers_count: i64,
    // #[serde(
    //     default,
    //     skip_serializing_if = "Vec::is_empty",
    //     deserialize_with = "crate::utils::deserialize_null_vector::deserialize"
    // )]
    pub topics: Vec<String>,
    // #[serde(
    //     default,
    //     skip_serializing_if = "String::is_empty",
    //     deserialize_with = "crate::utils::deserialize_null_string::deserialize"
    // )]
    pub html_url: String
}

impl GTApi {
    /// Create a new GTApi instance.
    fn new(token: &str) -> Result<Self> {
        // Setup octorust Gitee API client
        let user_agent = format!("{}/{}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));

        // Setup HTTP client ready to make requests to the Gitee API
        // (for some operations that cannot be done with the octorust client)
        let mut headers = HeaderMap::new();
        headers.insert(
            header::ACCEPT,
            HeaderValue::from_str("application/json").unwrap(),
        );
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
        );
        let http_client =
            reqwest::Client::builder().user_agent(user_agent).default_headers(headers).build()?;

        Ok(Self {
            http_client,
        })
    }
}

#[async_trait]
impl GT for GTApi {
    /// [GT::get_contributors_count]
    #[instrument(skip(self), err)]
    async fn get_contributors_count(&self, owner: &str, repo: &str) -> Result<usize> {
        let url = format!("{GITEE_API_URL}/repos/{owner}/{repo}/contributors?type=authors");
        let response = self.http_client.get(url).send().await?;

        if !response.status().is_success() {
            return Err(format_err!("get_contributors_count failed!"));
        }

        let body_text: String = response.text().await?;
        let body_json: Value = serde_json::from_str(&body_text)?;
        let length = body_json.as_array().map_or(0, |arr| arr.len());
        println!("get_contributors_count success");
        Ok(length)
    }

    /// [GT::get_license]
    #[instrument(skip(self), err)]
    async fn get_license(&self, owner: &str, repo: &str) -> Result<String> {
        let url = format!("{GITEE_API_URL}/repos/{owner}/{repo}/license");
        let response = self.http_client.get(url).send().await?;

        if !response.status().is_success() {
            return Err(format_err!("get_license failed!"));
        }

        let body_text: String = response.text().await?;
        let body_json: Value = serde_json::from_str(&body_text)?;
        let license = body_json.get("license").and_then(Value::as_str).map(|s| s.to_owned()).unwrap_or_default();
        println!("get_license success");
        Ok(license)
    }

    /// [GT::get_first_commit]
    #[allow(clippy::cast_possible_wrap)]
    #[instrument(skip(self), err)]
    async fn get_first_commit(&self, owner: &str, repo: &str, ref_: &str) -> Result<Option<Commit>> {
        // Get last commits page
        let url = format!("{GITEE_API_URL}/repos/{owner}/{repo}/commits?sha={ref_}&per_page=1&page=1");
        let head_response = self.http_client.head(url).send().await?;
        let last_page = get_last_page(head_response.headers())?.unwrap_or(1);

        let last_page_url = format!("{GITEE_API_URL}/repos/{owner}/{repo}/commits?sha={ref_}&per_page=1&page={last_page}");
        let response = self.http_client.get(last_page_url).send().await?;
        if !response.status().is_success() {
            return Err(format_err!("get_first_commit failed!"));
        }

        let body_text: String = response.text().await?;
        let body_json: Value = serde_json::from_str(&body_text)?;

        if let Some(commit) = body_json.as_array().and_then(|arr| arr.get(0)) {
            println!("get_first_commit success");
            return Ok(Some(new_commit_from(commit)));
        }
        Ok(None)
    }

    /// [GT::get_languages]
    #[instrument(skip(self), err)]
    async fn get_languages(&self, owner: &str, repo: &str) -> Result<Option<BTreeMap<String, i64>>> {
        // let url = format!("{GITEE_API_URL}/repos/{owner}/{repo}/languages");
        // let languages: BTreeMap<String, i64> = self.http_client.get(url).send().await?.json().await?;
        // Ok(Some(languages))
        Ok(None)
    }

    /// [GT::get_latest_commit]
    #[instrument(skip(self), err)]
    async fn get_latest_commit(&self, owner: &str, repo: &str, ref_: &str) -> Result<Commit> {
        let url = format!("{GITEE_API_URL}/repos/{owner}/{repo}/commits?sha={ref_}&per_page=1&page=1");
        let response = self.http_client.get(url).send().await?;

        if !response.status().is_success() {
            return Err(format_err!("get_first_commit failed!"));
        }

        let body_text: String = response.text().await?;
        let body_json: Value = serde_json::from_str(&body_text)?;

        if let Some(commit) = body_json.as_array().and_then(|arr| arr.get(0)) {
            println!("get_latest_commit success");
            return Ok(new_commit_from(commit));
        }
        Ok(Commit::default())
    }

    /// [GT::get_latest_release]
    #[instrument(skip(self), err)]
    async fn get_latest_release(&self, owner: &str, repo: &str) -> Result<Option<Release>> {
        let url = format!("{GITEE_API_URL}/repos/{owner}/{repo}/releases?per_page=1&page=1&direction=desc");
        let response = self.http_client.get(url).send().await?;

        if !response.status().is_success() {
            return Err(format_err!("get_latest_release failed!"));
        }

        let body_text: String = response.text().await?;
        let body_json: Value = serde_json::from_str(&body_text)?;

        if let Some(release) = body_json.as_array().and_then(|arr| arr.get(0)) {
            println!("get_latest_release success");
            return Ok(Some(new_release_from(release)));
        }
        Ok(None)
    }

    /// [GT::get_participation_stats]
    #[instrument(skip(self), err)]
    async fn get_participation_stats(&self, owner: &str, repo: &str) -> Result<ParticipationStats> {
        let begin_date = Utc::now() - Duration::days(365);
        let mut page = 1;
        let mut week_commit_count: [i64; 52] = [0; 52];
        loop {
            let url = format!("{GITEE_API_URL}/repos/{owner}/{repo}/commits?per_page=100&page={page}&since={begin_date}");
            let response = self.http_client.get(url).send().await?;

            if !response.status().is_success() {
                return Err(format_err!("get_first_commit failed!"));
            }

            let body_text: String = response.text().await?;
            let body_json: Value = serde_json::from_str(&body_text)?;
            if (body_json.as_array().map_or(0, |arr| arr.len()) ) == 0 {
                break;
            }
            if let Some(array) = body_json.as_array() {
                for commit in array {
                    if let Some(commit_date_str) = commit["commit"]["author"]["date"].as_str() {
                        if let Ok(commit_date) = DateTime::parse_from_rfc3339(commit_date_str) {
                            let created_at = commit_date.with_timezone(&Utc);
                            let week_index = (created_at - begin_date).num_days() as usize / 7;
                            if week_index < 52 {
                                week_commit_count[week_index] += 1;
                            }
                        } else {
                            println!("Error parsing date: {}", commit_date_str);
                        }
                    } else {
                        println!("Date field not found in commit data");
                    }
                }
            }
            page += 1
        }
        println!("get_participation_stats success");
        Ok(ParticipationStats{all: week_commit_count.to_vec(), owner: vec![]})
    }

    /// [GT::get_repository]
    #[instrument(skip(self), err)]
    async fn get_repository(&self, owner: &str, repo: &str) -> Result<PartRepository> {
        let url = format!("{GITEE_API_URL}/repos/{owner}/{repo}");
        let response = self.http_client.get(url).send().await?;

        if !response.status().is_success() {
            return Err(format_err!("get_repository failed!"));
        }

        let body_text: String = response.text().await?;
        let body_json: Value = serde_json::from_str(&body_text)?;

        let mut repo = PartRepository {
            default_branch: body_json.get("default_branch").and_then(Value::as_str).map(|s| s.to_owned()).unwrap_or_default(),
            description: body_json.get("description").map(Value::to_string).unwrap_or_default(),
            license: body_json.get("license").map(|val| vec![val.to_string()]),
            stargazers_count: body_json.get("stargazers_count").and_then(Value::as_i64).unwrap_or_default(),
            topics: body_json.get("topics").map(|val| vec![val.to_string()]).unwrap_or_default(),
            html_url: body_json.get("html_url").map(Value::to_string).unwrap_or_default(),
        };

        // println!("Parsed JSON body: {:?}", repo);
        println!("get_repository success");
        Ok(repo)
    }
}

lazy_static! {
    /// Gitee repository url regular expression.
    pub(crate) static ref GITEE_REPO_URL: Regex =
        Regex::new("^https://gitee.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/?$")
            .expect("exprs in GITEE_REPO_URL to be valid");
}

/// Return the last page of results available from the headers provided.
fn get_last_page(headers: &HeaderMap) -> Result<Option<usize>> {
    if let Some(total_count) = headers.get("total_count") {
        if let Ok(count) = total_count.to_str().map(str::parse::<usize>) {
            return Ok(Some(count?));
        } else {
            return Err(format_err!("Failed to parse total count"));
        }
    }
    Ok(None)
}

/// Extract the owner and repository from the repository url provided.
fn get_owner_and_repo(repo_url: &str) -> Result<(String, String)> {
    let c = GITEE_REPO_URL.captures(repo_url).ok_or_else(|| format_err!("invalid repository url"))?;
    Ok((c["owner"].to_string(), c["repo"].to_string()))
}

/// Create a new commit instance from the octorust commit data provided.
fn new_commit_from(value: &Value) -> Commit {
    let commit_url = value["html_url"].as_str().unwrap_or("");
    let ts = value["commit"]["author"]["date"].as_str()
        .and_then(|date| DateTime::parse_from_rfc3339(date).ok())
        .map(|dt| dt.into());

    Commit {
        url: commit_url.to_string(),
        ts,
    }
}

/// Create a new release instance from the octorust release data provided.
fn new_release_from(value: &Value) -> Release {
    let tag_name = value["tag_name"].as_str().unwrap_or("");
    let browser_download_url = value["assets"][0]["browser_download_url"].as_str().unwrap_or("");
    let url = if let Some(repo_url) = browser_download_url.split("archive").next() {
        format!("{repo_url}releases/tag/{tag_name}")
    } else {
        "".to_string()
    };

    let ts = value["created_at"].as_str()
        .and_then(|date| DateTime::parse_from_rfc3339(date).ok())
        .map(|dt| dt.into());

    Release {
        url: url,
        ts,
    }
}
