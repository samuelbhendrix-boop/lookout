# Monthly MRF extract and manual files

## The extract

`.github/workflows/mrf-extract.yml` runs free on GitHub Actions on the 4th of each month (or **Actions → MRF extract (monthly) → Run workflow**):

1. **plan**: `scripts/nppes-ne.py` builds the New England provider list from CMS's NPPES file. `scripts/mrf-plan.ts` lists every carrier rate file (live carriers' indexes, the snapshot carriers' indexes and manual uploads) and splits them into shards.
2. **extract**: `tools/mrfx` (Go) streams each file and keeps provider groups with a New England NPI or a known New England TIN, for the services in `data/mrf/codes.csv`. `scripts/mrf-shard.py` converts the output to Parquet.
3. **publish**: `scripts/mrf-publish.py` merges by carrier and builds `summary-code-rates.csv.gz`. Everything goes on the release `mrf-YYYY-MM`.

Payersight checks daily for a newer release (`lib/marketdata/mrfx.ts`) and loads the summary into `MarketCodeRate` for the Rate explorer. The full Parquet files stay on the release for DuckDB drill-downs.

`data/mrf/codes.csv` (top 1,800 CPT/HCPCS codes by Medicare spend plus every MS-DRG) is rebuilt with `python3 scripts/build-mrf-codes.py`.

## Manual files (sites that only serve browsers)

Payersight never works around a bot block. A person downloads these in a browser and adds them to the release **manual-mrf**. The workflow creates that release on its first run. The full guide with links is the "Manual MRF Extraction QRG" doc.

| File | Upload named | Or a line in `links.txt` |
| --- | --- | --- |
| Hospital standard charges | `hpt__<domain>__<anything>.json\|csv\|zip` | `hpt <domain> <https url>` |
| Carrier in-network rates | `tic__<carrier>__<network>.json\|json.gz\|zip` | `tic <carrier> <network words> <https url>` |
| Carrier index (e.g. BCBSMA) | `toc__<carrier>.json` | `toc <carrier> <https url>` |

Hospital files are read by `importHospitalFiles` in place of a blocked `cms-hpt.txt`. Carrier files and indexes are read by `scripts/mrf-plan.ts`; a `toc__bcbsma` index unlocks BCBSMA HMO Blue and Anthem NH HMO Blue New England Choice.
