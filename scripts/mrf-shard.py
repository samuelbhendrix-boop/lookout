"""Runs the extractor over one shard of plan.json and converts each file's output to Parquet.

    python3 scripts/mrf-shard.py <shard> <inputs dir> <out dir>

Each file is retried twice. Failures are recorded in <out>/summary-<shard>.jsonl, never fatal for the shard.
"""
import json, os, subprocess, sys, time
import duckdb

shard, inputs, out = int(sys.argv[1]), sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
plan = json.load(open(os.path.join(inputs, "plan.json")))
files = next(s for s in plan["shards"] if s["shard"] == shard)["files"]
con = duckdb.connect()
con.execute("SET memory_limit='6GB'; SET temp_directory='/tmp/duck'; SET preserve_insertion_order=false")
log = open(os.path.join(out, f"summary-{shard}.jsonl"), "a")

for f in files:
    prefix = os.path.join(out, f"{f['carrier']}__{f['id']}")
    result = None
    for attempt in range(3):
        t = time.time()
        p = subprocess.run(["./mrfx", "-url", f["url"], "-carrier", f["carrier"], "-network", f["network"],
                            "-npis", os.path.join(inputs, "ne-npis.txt"), "-tins", os.path.join(inputs, "ne-tins.txt"),
                            "-codes", os.path.join(inputs, "codes.csv"), "-out", prefix], capture_output=True, text=True)
        line = (p.stdout.strip().splitlines() or [""])[-1]
        try: result = json.loads(line)
        except ValueError: result = {}
        if "ok" not in result: result = {"ok": False, "error": (p.stderr or line or f"exit {p.returncode}").strip()[-400:]}
        if result.get("ok"): break
        time.sleep(30 * (attempt + 1))
    entry = {**{k: f[k] for k in ("id", "carrier", "carrierName", "network", "source", "bytes")}, "url": f["url"].split("?")[0], **result}
    if result.get("ok"):
        try:
            for kind in ("rates", "groups"):
                src = f"{prefix}.{kind}.csv.gz"
                cast = "* REPLACE (CAST(rate AS DOUBLE) AS rate)" if kind == "rates" else "*"
                con.execute(f"COPY (SELECT {cast}, '{f['id']}' AS file_id FROM read_csv('{src}', header=true, all_varchar=true)) TO '{prefix}.{kind}.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 1000000)")
                os.remove(src)
        except Exception as e:  # noqa: BLE001
            entry.update(ok=False, error=f"parquet: {e}"[:400])
    for kind in ("rates", "groups"):
        if not entry.get("ok") and os.path.exists(f"{prefix}.{kind}.csv.gz"): os.remove(f"{prefix}.{kind}.csv.gz")
    print(json.dumps({k: entry.get(k) for k in ("id", "ok", "error", "stats")}), flush=True)
    log.write(json.dumps(entry) + "\n"); log.flush()
