/**
 * Public CMS datasets Lookout imports. Both are free, published by CMS, and cover all states.
 *  - URRT (Unified Rate Review) PUF: every ACA individual & small-group rate filing, with
 *    product/plan detail and SERFF tracking numbers.
 *    https://www.cms.gov/marketplace/resources/data/rate-review-data
 *  - MLR (Medical Loss Ratio) PUF: annual premium, claims, covered lives per legal entity, state
 *    and segment (individual / small group / large group).
 *    https://www.cms.gov/marketplace/resources/data/medical-loss-ratio-data-systems-resources
 * When CMS posts a new year, add its URL here (one line) and push; the worker imports it.
 */

export type Dataset = "urrt" | "mlr" | "ma_chia" | "state_snapshots";

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
  // Curated ME/RI/NH large-group snapshots shipped in the repo; bump "year" (a version stamp) after editing them.
  { dataset: "state_snapshots", year: 20261104, url: "repo:data/state-large-group" },
];

/** Downloads come only from CMS — hardcoded, never user-supplied. */
export const ALLOWED_DATA_HOSTS = new Set(["www.cms.gov", "cms.gov", "www.chiamass.gov", "chiamass.gov"]);

/** Re-import a dataset after this long (CMS occasionally republishes corrected files). */
export const REFRESH_DAYS = 30;
