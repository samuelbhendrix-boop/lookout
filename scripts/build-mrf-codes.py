"""Builds data/mrf/codes.csv: the services the MRF extractor keeps.

Top HCPCS/CPT codes by 2024 national Medicare spend (physician & other practitioners, which also prices the facility side of
most outpatient services), plus every MS-DRG Medicare paid for. Together these cover the large majority of dollars; the
long tail of rarely billed codes is left out to keep the extract small.

    python3 scripts/build-mrf-codes.py [top_n=1800]
"""
import csv, io, sys, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)"}
PHYS = "https://data.cms.gov/sites/default/files/2026-05/e534c74b-79b8-4892-8a95-5a17e2dfec9f/MUP_PHY_R26_P05_V10_D24_Geo.csv"
# The inpatient CSV link in CMS's catalog is dead; its data API serves the same table (national rows only).
INP = "https://data.cms.gov/data-api/v1/dataset/0a011f40-7063-4c83-bc05-529f3522b727/data?filter%5BRndrng_Prvdr_Geo_Lvl%5D=National&size=5000"

def rows(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
        yield from csv.DictReader(io.TextIOWrapper(r, encoding="utf-8-sig", errors="replace"))

def json_rows(url):
    import json
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
        yield from json.load(r)

def num(s):
    try: return float(s or 0)
    except ValueError: return 0.0

top_n = int(sys.argv[1]) if len(sys.argv) > 1 else 1800
spend, desc = {}, {}
for r in rows(PHYS):
    if r.get("Rndrng_Prvdr_Geo_Lvl") != "National": continue
    c = r["HCPCS_Cd"].strip()
    spend[c] = spend.get(c, 0) + num(r["Tot_Srvcs"]) * num(r["Avg_Mdcr_Pymt_Amt"])
    desc.setdefault(c, r.get("HCPCS_Desc", "").strip())
total = sum(spend.values())
top = sorted(spend, key=spend.get, reverse=True)[:top_n]
covered = sum(spend[c] for c in top) / total

drg, ddesc = {}, {}
for r in json_rows(INP):
    if r.get("Rndrng_Prvdr_Geo_Lvl") != "National": continue
    c = r["DRG_Cd"].strip().zfill(3)
    drg[c] = drg.get(c, 0) + num(r["Tot_Dschrgs"]) * num(r["Avg_Mdcr_Pymt_Amt"])
    ddesc.setdefault(c, r.get("DRG_Desc", "").strip())

with open("data/mrf/codes.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["type", "code", "rank", "medicare_spend", "description"])
    for i, c in enumerate(top): w.writerow(["CPT", c, i + 1, round(spend[c]), desc[c]])
    for i, c in enumerate(sorted(drg, key=drg.get, reverse=True)): w.writerow(["MS-DRG", c, i + 1, round(drg[c]), ddesc[c]])
print(f"{len(top)} HCPCS/CPT codes = {covered:.1%} of Medicare physician-fee-schedule spend; {len(drg)} MS-DRGs")
