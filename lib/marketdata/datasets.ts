/**
 * Public CMS datasets Payersight imports. Both are free, published by CMS, and cover all states.
 *  - URRT (Unified Rate Review) PUF: every ACA individual & small-group rate filing, with
 *    product/plan detail and SERFF tracking numbers.
 *    https://www.cms.gov/marketplace/resources/data/rate-review-data
 *  - MLR (Medical Loss Ratio) PUF: annual premium, claims, covered lives per legal entity, state
 *    and segment (individual / small group / large group).
 *    https://www.cms.gov/marketplace/resources/data/medical-loss-ratio-data-systems-resources
 * When CMS posts a new year, add its URL here (one line) and push; the worker imports it.
 */

export type Dataset = "urrt" | "mlr" | "ma_chia" | "state_snapshots" | "dol_5500" | "tic" | "rates" | "qhp" | "hpt" | "directory";

export const DATASETS: Array<{ dataset: Dataset; year: number; url: string }> = [
  { dataset: "urrt", year: 2025, url: "https://www.cms.gov/files/zip/py2025puf20241024.zip" },
  { dataset: "urrt", year: 2026, url: "https://www.cms.gov/files/zip/py2026-puf-20260327.zip" },
  { dataset: "mlr", year: 2020, url: "https://www.cms.gov/files/zip/mlr-public-use-file-2020.zip" },
  { dataset: "mlr", year: 2021, url: "https://www.cms.gov/files/zip/mlr-public-use-file-2021.zip" },
  { dataset: "mlr", year: 2022, url: "https://www.cms.gov/files/zip/mlr-public-use-file-2022.zip" },
  { dataset: "mlr", year: 2023, url: "https://www.cms.gov/files/zip/mlr-public-use-file-2023.zip" },
  { dataset: "mlr", year: 2024, url: "https://www.cms.gov/files/zip/mlr-public-use-file-2024.zip" },
  // MA CHIA Enrollment Trends databooks (semiannual; each covers ~2 years of quarters). "year" = data-through year.
  // https://www.chiamass.gov/insights-analysis/access/enrollment-in-health-insurance/
  { dataset: "ma_chia", year: 2023, url: "https://www.chiamass.gov/wp-content/uploads/2026/06/Enrollment-Trends-thru-September-2023-Databook.xlsx" },
  { dataset: "ma_chia", year: 2025, url: "https://www.chiamass.gov/wp-content/uploads/Uploads/enrollment/2025-September/Enrollment-Trends-Data-thru-September-2025-Databook.xlsx" },
  // DOL Form 5500 + Schedule A (employer plans → carrier, broker). "Latest" files are refreshed monthly by DOL;
  // url points at the main form file, schedules are derived from it. Filtered to DOL_STATES on import.
  // https://www.dol.gov/agencies/ebsa/about-ebsa/our-activities/public-disclosure/foia/form-5500-datasets
  { dataset: "dol_5500", year: 2023, url: "https://askebsa.dol.gov/FOIA%20Files/2023/Latest/F_5500_2023_Latest.zip" },
  { dataset: "dol_5500", year: 2024, url: "https://askebsa.dol.gov/FOIA%20Files/2024/Latest/F_5500_2024_Latest.zip" },
  { dataset: "dol_5500", year: 2025, url: "https://askebsa.dol.gov/FOIA%20Files/2025/Latest/F_5500_2025_Latest.zip" },
  // Transparency in Coverage indexes for every carrier in lib/marketdata/tic.ts (runs after Form 5500, monthly).
  { dataset: "tic", year: 1, url: "registry:lib/marketdata/tic.ts" },
  // Negotiated rates from regional carriers' rate files, reduced to a benchmark basket (lib/marketdata/mrf).
  { dataset: "rates", year: 1, url: "registry:lib/marketdata/mrf/files.ts#mgb" },
  { dataset: "rates", year: 2, url: "registry:lib/marketdata/mrf/files.ts#harvard_pilgrim" },
  { dataset: "rates", year: 3, url: "registry:lib/marketdata/mrf/files.ts#tufts" },
  { dataset: "rates", year: 4, url: "registry:lib/marketdata/mrf/files.ts#fallon" },
  { dataset: "rates", year: 5, url: "registry:lib/marketdata/mrf/files.ts#nhpri" },
  { dataset: "rates", year: 6, url: "registry:lib/marketdata/mrf/files.ts#cho" },
  // Offline-reduced snapshots in data/rates/ (BCBSMA + New England Blues, Cigna, Aetna, UnitedHealthcare).
  { dataset: "rates", year: 99, url: "repo:data/rates" },
  // Exchange plan designs (benefits, cost sharing, networks, premiums by age). lib/marketdata/qhp.ts lists the files:
  // CMS SBE QHP PUFs (MA, CT, RI, VT, ME) and federal Exchange PUFs (NH). Add a year here when CMS posts it.
  { dataset: "qhp", year: 2024, url: "registry:lib/marketdata/qhp.ts" },
  { dataset: "qhp", year: 2025, url: "registry:lib/marketdata/qhp.ts" },
  { dataset: "qhp", year: 2026, url: "registry:lib/marketdata/qhp.ts" },
  { dataset: "qhp", year: 2027, url: "registry:lib/marketdata/qhp.ts" },
  // Hospitals' own price transparency files (lib/marketdata/hpt.ts lists the hospital websites; each cms-hpt.txt names the file).
  { dataset: "hpt", year: 1, url: "registry:lib/marketdata/hpt.ts" },
  // Exchange insurers' provider directories and formularies (CMS MR-PUF index URLs listed in lib/marketdata/directory.ts).
  { dataset: "directory", year: 1, url: "registry:lib/marketdata/directory.ts" },
  // Curated ME/RI/NH large-group snapshots shipped in the repo; bump "year" (a version stamp) after editing them.
  { dataset: "state_snapshots", year: 20261104, url: "repo:data/state-large-group" },
];

/** Downloads come only from CMS — hardcoded, never user-supplied. */
export const ALLOWED_DATA_HOSTS = new Set(["www.cms.gov", "cms.gov", "download.cms.gov", "www.chiamass.gov", "chiamass.gov", "askebsa.dol.gov"]);

/** Re-import a dataset after this long (CMS occasionally republishes corrected files). */
export const REFRESH_DAYS = 30;
