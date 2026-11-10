"""Merges every shard's Parquet into one rates and one groups file per carrier, plus a manifest and release notes.

    python3 scripts/mrf-publish.py <artifacts dir> <release dir>
"""
import glob, json, os, shutil, sys
import duckdb

art, rel = sys.argv[1], sys.argv[2]
os.makedirs(rel, exist_ok=True)
con = duckdb.connect()
# Leave headroom: DuckDB spills to disk past this.
ram_gb = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
con.execute(f"SET memory_limit='{max(1, int(ram_gb * 0.5))}GB'; SET temp_directory='/tmp/duck'; SET preserve_insertion_order=false; SET threads=2")

plan = json.load(open(os.path.join(art, "inputs", "plan.json")))
summaries = [json.loads(l) for p in glob.glob(os.path.join(art, "shard-*", "summary-*.jsonl")) for l in open(p) if l.strip()]
done = {s["id"] for s in summaries}
missing = [f for s in plan["shards"] for f in s["files"] if f["id"] not in done]  # shard timed out or crashed

carriers = sorted({os.path.basename(p).split("__")[0] for p in glob.glob(os.path.join(art, "shard-*", "*.rates.parquet"))})
assets = []
for c in carriers:
    for kind in ("rates", "groups"):
        files = glob.glob(os.path.join(art, "shard-*", f"{c}__*.{kind}.parquet"))
        dest = os.path.join(rel, f"{kind}-{c}.parquet")
        dedupe = "SELECT DISTINCT ON (group_key) *" if kind == "groups" else "SELECT *"
        con.execute(f"COPY ({dedupe} FROM read_parquet({files!r})) TO '{dest}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 500000)")
        rows = con.execute(f"SELECT count(*) FROM '{dest}'").fetchone()[0]
        assets.append({"file": os.path.basename(dest), "carrier": c, "kind": kind, "rows": rows, "bytes": os.path.getsize(dest)})
# Market summary the app loads: for each carrier × service × state × setting, the spread of what it pays New England
# providers. One average per provider group first (groups repeat a price across modifiers and places of service), dollar
# prices only (percent-of-charges and per-diem terms aren't comparable), no modifier (26/TC split fees are different services).
npp = os.path.join(art, "inputs", "nppes-ne.parquet")
tinst = os.path.join(art, "inputs", "tin-states.csv")
rate_files = glob.glob(os.path.join(rel, "rates-*.parquet"))
group_files = glob.glob(os.path.join(rel, "groups-*.parquet"))
if rate_files:
    con.execute(f"""
      CREATE TEMP TABLE gstate AS
      WITH g AS (SELECT carrier, group_key, tin, string_split(ne_npis, ' ') AS npis FROM read_parquet({group_files!r})),
           byNpi AS (SELECT g.carrier, g.group_key, n.state, count(*) AS k FROM g, unnest(g.npis) AS u(npi) JOIN '{npp}' n ON n.npi = u.npi GROUP BY ALL),
           pick AS (SELECT carrier, group_key, arg_max(state, k) AS state FROM byNpi GROUP BY ALL)
      SELECT g.carrier, g.group_key, coalesce(p.state, t.state) AS state
      FROM g LEFT JOIN pick p USING (carrier, group_key) LEFT JOIN read_csv('{tinst}', all_varchar=true) t ON t.tin = g.tin""")
    # One carrier at a time keeps memory bounded on a 16 GB runner.
    con.execute("CREATE TEMP TABLE summary (carrier VARCHAR, state VARCHAR, code_type VARCHAR, code VARCHAR, billing_class VARCHAR, providers BIGINT, p25 DOUBLE, median DOUBLE, p75 DOUBLE)")
    for rf in rate_files:
        con.execute(f"""
          INSERT INTO summary
          WITH per_group AS (
            SELECT r.carrier, s.state, r.code_type, r.code, r.billing_class, r.group_key, avg(r.rate) AS rate
            FROM '{rf}' r JOIN gstate s USING (carrier, group_key)
            WHERE r.negotiated_type IN ('negotiated', 'fee schedule', 'derived') AND coalesce(r.modifier, '') = '' AND r.rate > 0 AND s.state IS NOT NULL
            GROUP BY ALL)
          SELECT carrier, state, code_type, code, billing_class, count(*) AS providers,
                 round(quantile_cont(rate, 0.25), 2), round(median(rate), 2), round(quantile_cont(rate, 0.75), 2)
          FROM per_group GROUP BY ALL HAVING count(*) >= 3""")
    con.execute(f"COPY summary TO '{os.path.join(rel, "summary-code-rates.csv.gz")}' (HEADER, COMPRESSION gzip)")
    n = con.execute(f"SELECT count(*) FROM read_csv('{os.path.join(rel, 'summary-code-rates.csv.gz')}')").fetchone()[0]
    assets.append({"file": "summary-code-rates.csv.gz", "carrier": None, "kind": "summary", "rows": n, "bytes": os.path.getsize(os.path.join(rel, "summary-code-rates.csv.gz"))})

for extra in ("nppes-ne.parquet", "codes.csv"):
    src = os.path.join(art, "inputs", extra)
    if os.path.exists(src):
        shutil.copy(src, os.path.join(rel, extra))

ok = [s for s in summaries if s.get("ok")]
failed = [s for s in summaries if not s.get("ok")] + [{**f, "ok": False, "error": "shard did not finish (timeout or crash)"} for f in missing]
manifest = {"month": plan["month"], "files": len(ok), "failed": failed, "problems": plan.get("problems", []), "assets": assets,
            "sources": [{k: s.get(k) for k in ("id", "carrier", "carrierName", "network", "source", "stats")} for s in ok]}
json.dump(manifest, open(os.path.join(rel, "manifest.json"), "w"), indent=1)
rows = sum(a["rows"] for a in assets if a["kind"] == "rates")
with open(os.path.join(rel, "NOTES.md"), "w") as f:
    f.write(f"Negotiated rates for New England providers, top services by Medicare spend, {plan['month']}.\n\n")
    f.write(f"- {len(ok)} of {len(ok) + len(failed)} rate files extracted; {rows:,} rate rows across {len(carriers)} carriers.\n")
    f.write("- `rates-<carrier>.parquet`: one row per provider group × service × price; `groups-<carrier>.parquet`: who each group is (TIN, NPIs).\n")
    f.write("- `nppes-ne.parquet`: New England providers (name, specialty, location) by NPI. `manifest.json`: per-file stats and failures.\n")
    if failed:
        f.write("\nNot extracted:\n" + "".join(f"- {x.get('carrierName')} · {x.get('network')}: {str(x.get('error'))[:160]}\n" for x in failed))
    for p in plan.get("problems", []):
        f.write(f"- {p}\n")
print(f"{len(ok)} ok, {len(failed)} failed, {rows:,} rows, {len(assets)} assets")
