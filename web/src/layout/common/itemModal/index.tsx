import { Item, Repository, SVGIconKind } from '../../../types';
import Modal from '../Modal';
import styles from './ItemModal.module.css';
import { useEffect, useState } from 'react';
import itemsDataGetter from '../../../utils/itemsDataGetter';
import cleanEmojis from '../../../utils/cleanEmojis';
import MaturityBadge from '../MaturityBadge';
import Image from '../Image';
import ExternalLink from '../ExternalLink';
import prettifyNumber from '../../../utils/prettifyNumber';
import moment from 'moment';
import classNames from 'classnames';
import ParticipationStats from './ParticipationStats';
import formatProfitLabel from '../../../utils/formatLabelProfit';
import { Loading } from '../Loading';
import SVGIcon from '../SVGIcon';

interface Props {
  activeItemId?: string;
  removeActiveItem: () => void;
}

const ItemModal = (props: Props) => {
  const [fullDataReady, setFullDataReady] = useState<boolean>(false);
  const [itemInfo, setItemInfo] = useState<Item | null | undefined>(undefined);
  let description = 'This item does not have a description available yet';
  let stars: number | undefined;
  let mainRepo: Repository | undefined;
  let websiteUrl: string | undefined = itemInfo ? itemInfo.homepage_url : undefined;

  itemsDataGetter.isReady({
    updateStatus: (status: boolean) => setFullDataReady(status),
  });

  if (
    itemInfo &&
    itemInfo.crunchbase_data &&
    itemInfo.crunchbase_data.description &&
    itemInfo.crunchbase_data.description !== ''
  ) {
    description = cleanEmojis(itemInfo.crunchbase_data.description);
  }

  if (itemInfo && itemInfo.repositories) {
    const primaryRepo = itemInfo.repositories.find((repo: Repository) => repo.primary);

    if (
      primaryRepo &&
      primaryRepo.github_data &&
      primaryRepo.github_data.description &&
      primaryRepo.github_data.description !== ''
    ) {
      description = cleanEmojis(primaryRepo.github_data.description);
    }

    itemInfo.repositories.forEach((repo: Repository) => {
      if (repo.primary) {
        mainRepo = repo;
      }

      if (repo.github_data) {
        stars = stars || 0 + repo.github_data.stars;
      }
    });
  }

  // If homepage_url is undefined or is equal to main repository url
  // and project field is undefined,
  // we use the homepage_url fron crunchbase
  if (itemInfo && (websiteUrl === undefined || (mainRepo && websiteUrl === mainRepo.url))) {
    if (itemInfo.crunchbase_data && itemInfo.crunchbase_data.homepage_url) {
      websiteUrl = itemInfo.crunchbase_data.homepage_url;
    }
  }

  const formatDate = (date: string): string => {
    return moment(date).format("MMM 'YY");
  };

  useEffect(() => {
    async function fetchItemInfo() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        setItemInfo(await itemsDataGetter.get(props.activeItemId!));
      } catch {
        setItemInfo(null);
      }
    }

    if (props.activeItemId && fullDataReady) {
      fetchItemInfo();
    } else {
      setItemInfo(undefined);
    }
  }, [props.activeItemId, fullDataReady]);

  if (props.activeItemId === undefined) return null;

  return (
    <Modal size="xl" open modalDialogClassName={styles.modalDialog} onClose={() => props.removeActiveItem()}>
      {itemInfo ? (
        <div className="d-flex flex-column p-3">
          <div className="d-flex flex-row align-items-center">
            <div className={`d-flex align-items-center justify-content-center ${styles.logoWrapper}`}>
              <Image name={itemInfo.name} className={`m-auto ${styles.logo}`} logo={itemInfo.logo} />
            </div>

            <div className={`d-flex flex-column justify-content-between ms-3 ${styles.itemInfo}`}>
              <div className="d-flex flex-row align-items-center">
                <div className={`fw-semibold text-truncate pe-2 ${styles.title}`}>{itemInfo.name}</div>
                <div className={`d-flex flex-row align-items-center ms-2 ${styles.extra}`}>
                  {itemInfo.project !== undefined && (
                    <>
                      <div title="CNCF" className="badge rounded-0 bg-primary">
                        CNCF
                      </div>
                      <MaturityBadge level={itemInfo.project} className="mx-2" />

                      {itemInfo.accepted_at !== undefined && (
                        <div
                          title={`Accepted at ${itemInfo.accepted_at}`}
                          className="d-flex flex-row align-items-center accepted-date me-3"
                        >
                          <SVGIcon kind={SVGIconKind.Calendar} className="me-1 text-muted" />
                          <div>
                            <small>{itemInfo.accepted_at.split('-')[0]}</small>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
              {itemInfo.crunchbase_data && itemInfo.crunchbase_data.name && (
                <div className={`text-muted text-truncate ${styles.name}`}>
                  <small>{itemInfo.crunchbase_data.name}</small>
                </div>
              )}
              <div className="d-flex flex-row align-items-center mb-1">
                <div className={`d-none d-xl-flex badge border rounded-0 ${styles.badgeOutlineDark}`}>
                  {itemInfo.category}
                </div>
                <div className={`badge border ms-0 ms-xl-2 me-3 rounded-0 ${styles.badgeOutlineDark}`}>
                  {itemInfo.subcategory}
                </div>
                <div className="ms-auto">
                  <div className={`d-flex flex-row align-items-center ${styles.extra}`}>
                    {websiteUrl && (
                      <ExternalLink title="Website" className={`ms-3 ${styles.link}`} href={websiteUrl}>
                        <SVGIcon kind={SVGIconKind.World} />
                      </ExternalLink>
                    )}

                    {mainRepo !== undefined && (
                      <ExternalLink title="Repository" className={`ms-3 ${styles.link}`} href={mainRepo.url}>
                        <SVGIcon kind={SVGIconKind.GitHubCircle} />
                      </ExternalLink>
                    )}

                    {itemInfo.devstats_url !== undefined && (
                      <ExternalLink title="Devstats" className={`ms-3 ${styles.link}`} href={itemInfo.devstats_url}>
                        <SVGIcon kind={SVGIconKind.Stats} />
                      </ExternalLink>
                    )}

                    {itemInfo.twitter_url !== undefined && (
                      <ExternalLink title="Twitter" className={`ms-3 ${styles.link}`} href={itemInfo.twitter_url}>
                        <SVGIcon kind={SVGIconKind.Twitter} />
                      </ExternalLink>
                    )}

                    {itemInfo.youtube_url !== undefined && (
                      <ExternalLink title="Youtube" className={`ms-3 ${styles.link}`} href={itemInfo.youtube_url}>
                        <SVGIcon kind={SVGIconKind.Youtube} />
                      </ExternalLink>
                    )}

                    {itemInfo.slack_url !== undefined && (
                      <ExternalLink title="Slack" className={`ms-3 ${styles.link}`} href={itemInfo.slack_url}>
                        <SVGIcon kind={SVGIconKind.Slack} />
                      </ExternalLink>
                    )}

                    {itemInfo.discord_url !== undefined && (
                      <ExternalLink title="Discord" className={`ms-3 ${styles.link}`} href={itemInfo.discord_url}>
                        <SVGIcon kind={SVGIconKind.Discord} />
                      </ExternalLink>
                    )}

                    {itemInfo.docker_url !== undefined && (
                      <ExternalLink title="Docker" className={`ms-3 ${styles.link}`} href={itemInfo.docker_url}>
                        <SVGIcon kind={SVGIconKind.Docker} />
                      </ExternalLink>
                    )}

                    {itemInfo.stack_overflow_url !== undefined && (
                      <ExternalLink
                        title="Stack overflow"
                        className={`ms-3 ${styles.link}`}
                        href={itemInfo.stack_overflow_url}
                      >
                        <SVGIcon kind={SVGIconKind.StackOverflow} />
                      </ExternalLink>
                    )}

                    {itemInfo.project === undefined && itemInfo.crunchbase_url !== undefined && (
                      <ExternalLink title="Crunchbase" className={`ms-3 ${styles.link}`} href={itemInfo.crunchbase_url}>
                        <SVGIcon kind={SVGIconKind.Crunchbase} />
                      </ExternalLink>
                    )}

                    {itemInfo.blog_url !== undefined && (
                      <ExternalLink title="Blog" className={`ms-3 ${styles.link}`} href={itemInfo.blog_url}>
                        <SVGIcon kind={SVGIconKind.Blog} />
                      </ExternalLink>
                    )}

                    {itemInfo.mailing_list_url !== undefined && (
                      <ExternalLink
                        title="Mailing list"
                        className={`ms-3 ${styles.link}`}
                        href={itemInfo.mailing_list_url}
                      >
                        <SVGIcon kind={SVGIconKind.MailingList} />
                      </ExternalLink>
                    )}

                    {itemInfo.openssf_best_practices_url !== undefined && (
                      <ExternalLink
                        title="OpenSSF best practices"
                        className={`ms-3 ${styles.link}`}
                        href={itemInfo.openssf_best_practices_url}
                      >
                        <SVGIcon kind={SVGIconKind.OpenssfBestPractices} />
                      </ExternalLink>
                    )}

                    {itemInfo.artwork_url !== undefined && (
                      <ExternalLink title="Artwork" className={`ms-3 ${styles.link}`} href={itemInfo.artwork_url}>
                        <SVGIcon kind={SVGIconKind.Artwork} />
                      </ExternalLink>
                    )}

                    {itemInfo.github_discussions_url !== undefined && (
                      <ExternalLink
                        title="Github discussions"
                        className={`ms-3 ${styles.link}`}
                        href={itemInfo.github_discussions_url}
                      >
                        <SVGIcon kind={SVGIconKind.Discussions} />
                      </ExternalLink>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* Description */}
          <div className={`mb-3 mt-4 text-muted ${styles.description}`}>{description}</div>

          {/* Project status */}
          {itemInfo.project !== undefined && (
            <div className={`position-relative my-4 border ${styles.fieldset}`}>
              <div className={`position-absolute px-2 bg-white fw-semibold ${styles.fieldsetTitle}`}>
                Project status
              </div>

              <div className="position-relative mt-2">
                <div className="d-flex flex-row justify-content-between">
                  <div className="d-flex flex-column align-items-center">
                    <div className={`badge rounded-1 p-2 ${styles.projectBadge} ${styles.activeProjectBadge}`}>
                      {itemInfo.accepted_at ? (
                        <>
                          {itemInfo.accepted_at === itemInfo.incubating_at ||
                          itemInfo.accepted_at === itemInfo.graduated_at
                            ? '-'
                            : itemInfo.accepted_at}
                        </>
                      ) : (
                        '-'
                      )}
                    </div>
                    <small className={`text-uppercase fw-semibold text-muted mt-2 ${styles.statusLegend}`}>
                      Sandbox
                    </small>
                  </div>

                  <div className="d-flex flex-column align-items-center">
                    <div
                      className={classNames('badge rounded-1 p-2', styles.projectBadge, {
                        [styles.activeProjectBadge]: ['incubating', 'graduated', 'archived'].includes(itemInfo.project),
                      })}
                    >
                      {itemInfo.incubating_at || '-'}
                    </div>
                    <small className={`text-uppercase fw-semibold text-muted mt-2 ${styles.statusLegend}`}>
                      Incubating
                    </small>
                  </div>

                  <div className="d-flex flex-column align-items-center">
                    <div
                      className={classNames('badge rounded-1 p-2', styles.projectBadge, {
                        [styles.activeProjectBadge]: ['graduated', 'archived'].includes(itemInfo.project),
                      })}
                    >
                      {itemInfo.graduated_at || '-'}
                    </div>
                    <small className={`text-uppercase fw-semibold text-muted mt-2 ${styles.statusLegend}`}>
                      Graduated
                    </small>
                  </div>
                </div>
                <div className={`${styles.line} ${itemInfo.project}Line`} />
              </div>
            </div>
          )}

          {/* Organization */}
          {itemInfo.crunchbase_data && (
            <div className={`position-relative my-4 border ${styles.fieldset}`}>
              <div className={`position-absolute px-2 bg-white fw-semibold ${styles.fieldsetTitle}`}>Organization</div>
              <div className="d-flex flex-row align-items-center">
                <div className={`fw-semibold text-truncate fs-6`}>{itemInfo.crunchbase_data.name}</div>

                {itemInfo.crunchbase_data.kind && (
                  <div
                    className={`ms-3 badge rounded-0 text-dark text-uppercase border ${styles.badgeOutlineDark} ${styles.miniBadge}`}
                  >
                    {itemInfo.crunchbase_data.kind}
                  </div>
                )}
                {itemInfo.crunchbase_data.company_type && (
                  <div
                    className={`ms-3 badge rounded-0 text-dark text-uppercase border ${styles.badgeOutlineDark} ${styles.miniBadge}`}
                  >
                    {formatProfitLabel(itemInfo.crunchbase_data.company_type)}
                  </div>
                )}
              </div>
              <div className={`text-muted pt-1 ${styles.location}`}>
                {itemInfo.crunchbase_data.city}
                {itemInfo.crunchbase_data.country !== undefined ? `, ${itemInfo.crunchbase_data.country}` : ''}
              </div>
              <div className="mt-3">
                <small className="text-muted">{itemInfo.crunchbase_data.description}</small>
              </div>
              <div className="row g-4 my-0 mb-2">
                <div className="col">
                  <div
                    className={`text-center p-3 h-100 d-flex flex-column justify-content-center ${styles.highlighted}`}
                  >
                    <div className={`fw-bold ${styles.highlightedTitle}`}>
                      {itemInfo.crunchbase_data.funding ? prettifyNumber(itemInfo.crunchbase_data.funding) : '-'}
                    </div>
                    <div className={`fw-semibold ${styles.highlightedLegend}`}>
                      <small>Funding</small>
                    </div>
                  </div>
                </div>

                <div className="col">
                  <div
                    className={`text-center p-3 h-100 d-flex flex-column justify-content-center ${styles.highlighted}`}
                  >
                    {itemInfo.crunchbase_data.num_employees_min && itemInfo.crunchbase_data.num_employees_max ? (
                      <div className={`fw-bold ${styles.highlightedTitle}`}>
                        {itemInfo.crunchbase_data.num_employees_min
                          ? prettifyNumber(itemInfo.crunchbase_data.num_employees_min)
                          : '-'}
                        -
                        {itemInfo.crunchbase_data.num_employees_max
                          ? prettifyNumber(itemInfo.crunchbase_data.num_employees_max)
                          : '-'}
                      </div>
                    ) : (
                      <div className={`fw-bold ${styles.highlightedTitle}`}>-</div>
                    )}
                    <div className={`fw-semibold ${styles.highlightedLegend}`}>
                      <small>Employees</small>
                    </div>
                  </div>
                </div>

                <div className="col">
                  <div
                    className={`text-center p-3 h-100 d-flex flex-column justify-content-center ${styles.highlighted}`}
                  >
                    <div className={`fw-bold text-uppercase ${styles.highlightedTitle}`}>
                      {itemInfo.crunchbase_data.stock_exchange ? itemInfo.crunchbase_data.stock_exchange : '-'}
                    </div>
                    <div className={`fw-semibold ${styles.highlightedLegend}`}>
                      <small>Stock exchange</small>
                    </div>
                  </div>
                </div>

                <div className="col">
                  <div
                    className={`text-center p-3 h-100 d-flex flex-column justify-content-center ${styles.highlighted}`}
                  >
                    <div className={`fw-bold ${styles.highlightedTitle}`}>
                      {itemInfo.crunchbase_data.ticker ? itemInfo.crunchbase_data.ticker : '-'}
                    </div>
                    <div className={`fw-semibold ${styles.highlightedLegend}`}>
                      <small>Ticker</small>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Repositories */}
          {itemInfo.repositories !== undefined && (
            <div className={`position-relative mt-4 border ${styles.fieldset}`}>
              <div className={`position-absolute px-2 bg-white fw-semibold ${styles.fieldsetTitle}`}>Repositories</div>
              {mainRepo !== undefined && (
                <>
                  <div>
                    <small className="text-muted">Primary repository:</small>
                  </div>
                  <div className="d-flex flex-row align-items-center my-2">
                    <ExternalLink className="text-reset p-0 align-baseline fw-semibold" href={mainRepo.url}>
                      {mainRepo.url}
                    </ExternalLink>
                    {mainRepo.github_data && (
                      <div className={`ms-3 badge border rounded-0 ${styles.badgeOutlineDark} ${styles.miniBadge}`}>
                        {mainRepo.github_data.license}
                      </div>
                    )}
                  </div>
                  {mainRepo.github_data && (
                    <>
                      <div className="row g-4 my-0 mb-2">
                        <div className="col">
                          <div
                            className={`text-center p-3 h-100 d-flex flex-column justify-content-center ${styles.highlighted}`}
                          >
                            <div className={`fw-bold ${styles.highlightedTitle}`}>
                              {prettifyNumber(mainRepo.github_data.stars, 1)}
                            </div>
                            <div className={`fw-semibold ${styles.highlightedLegend}`}>
                              <small>Stars</small>
                            </div>
                          </div>
                        </div>

                        <div className="col">
                          <div
                            className={`text-center p-3 h-100 d-flex flex-column justify-content-center ${styles.highlighted}`}
                          >
                            <div className={`fw-bold ${styles.highlightedTitle}`}>
                              {prettifyNumber(mainRepo.github_data.contributors.count)}
                            </div>
                            <div className={`fw-semibold ${styles.highlightedLegend}`}>
                              <small>Contributors</small>
                            </div>
                          </div>
                        </div>

                        <div className="col">
                          <div
                            className={`text-center p-3 h-100 d-flex flex-column justify-content-center ${styles.highlighted}`}
                          >
                            <div className={`fw-bold ${styles.highlightedTitle}`}>
                              {formatDate(mainRepo.github_data.first_commit.ts)}
                            </div>
                            <div className={`fw-semibold ${styles.highlightedLegend}`}>
                              <small>First commit</small>
                            </div>
                          </div>
                        </div>

                        <div className="col">
                          <div
                            className={`text-center p-3 h-100 d-flex flex-column justify-content-center ${styles.highlighted}`}
                          >
                            <div className={`fw-bold ${styles.highlightedTitle}`}>
                              {formatDate(mainRepo.github_data.latest_commit.ts)}
                            </div>
                            <div className={`fw-semibold ${styles.highlightedLegend}`}>
                              <small>Latest commit</small>
                            </div>
                          </div>
                        </div>

                        <div className="col">
                          <div
                            className={`text-center p-3 h-100 d-flex flex-column justify-content-center ${styles.highlighted}`}
                          >
                            <div className={`fw-bold ${styles.highlightedTitle}`}>
                              {mainRepo.github_data.latest_release
                                ? formatDate(mainRepo.github_data.latest_release.ts)
                                : '-'}
                            </div>
                            <div className={`fw-semibold ${styles.highlightedLegend}`}>
                              <small>Latest release</small>
                            </div>
                          </div>
                        </div>
                      </div>
                      {mainRepo.github_data.participation_stats && (
                        <div className="mt-4">
                          <small className="text-muted">Participation stats:</small>
                          <ParticipationStats stats={mainRepo.github_data.participation_stats} />
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              {itemInfo.repositories && itemInfo.repositories.length > 1 && (
                <div className="mt-4">
                  <small className="text-muted">Other repositories:</small>
                  <table className="table table-sm table-striped table-bordered mt-3">
                    <thead>
                      <tr>
                        <th className="text-center" scope="col">
                          URL
                        </th>
                        <th className="text-center" scope="col">
                          STARS
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemInfo.repositories.map((repo: Repository) => {
                        if (repo.primary) return null;
                        return (
                          <tr className={styles.tableRepos} key={`table_${repo.url}`}>
                            <td className="px-3">
                              <ExternalLink className="text-muted" href={repo.url}>
                                {repo.url}
                              </ExternalLink>
                            </td>
                            <td className="px-3 text-center">
                              {repo.github_data && repo.github_data.stars
                                ? prettifyNumber(repo.github_data.stars)
                                : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className={`d-flex flex-column p-5 ${styles.loadingWrapper}`}>
          <Loading />
        </div>
      )}
    </Modal>
  );
};

export default ItemModal;