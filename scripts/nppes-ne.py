"""New England providers from CMS's monthly NPPES file: every NPI with a practice location in CT, MA, ME, NH, RI or VT.

Writes ne-npis.txt (one NPI per line, for the extractor) and nppes-ne.parquet (name, type, specialty, location).

    python3 scripts/nppes-ne.py [outdir=.]
"""
import os, re, subprocess, sys, urllib.request
import duckdb

UA = {"User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)"}
out = sys.argv[1] if len(sys.argv) > 1 else "."
page = urllib.request.urlopen(urllib.request.Request("https://download.cms.gov/nppes/NPI_Files.html", headers=UA), timeout=60).read().decode("utf8", "replace")
name = sorted(set(re.findall(r"NPPES_Data_Dissemination_[A-Za-z]+_\d{4}(?:_V2)?\.zip", page)))[-1]
zip_path = os.path.join(out, name)
if not os.path.exists(zip_path):
    subprocess.run(["curl", "-sSfL", "-A", UA["User-Agent"], "-o", zip_path, f"https://download.cms.gov/nppes/{name}"], check=True)
entries = subprocess.run(["unzip", "-Z1", zip_path], capture_output=True, text=True, check=True).stdout.split()
main = next(e for e in entries if re.match(r"npidata_pfile_\d+-\d+\.csv$", e))
# Stream the 9 GB CSV out of the zip straight into DuckDB, keeping only New England rows and the columns we use.
fifo = os.path.join(out, "npi.fifo")
if os.path.exists(fifo): os.remove(fifo)
os.mkfifo(fifo)
proc = subprocess.Popen(f'unzip -p "{zip_path}" "{main}" > "{fifo}"', shell=True)
con = duckdb.connect()
con.execute(f"""
  COPY (
    SELECT "NPI" AS npi, "Entity Type Code" AS entity,
           coalesce(nullif("Provider Organization Name (Legal Business Name)", ''), trim(coalesce("Provider First Name", '') || ' ' || coalesce("Provider Last Name (Legal Name)", ''))) AS name,
           "Healthcare Provider Taxonomy Code_1" AS taxonomy,
           "Provider Business Practice Location Address City Name" AS city,
           "Provider Business Practice Location Address State Name" AS state,
           left("Provider Business Practice Location Address Postal Code", 5) AS zip
    FROM read_csv('{fifo}', header = true, all_varchar = true, quote = '"', escape = '"')
    WHERE "Provider Business Practice Location Address State Name" IN ('CT','MA','ME','NH','RI','VT')
      AND ("NPI Deactivation Date" IS NULL OR "NPI Deactivation Date" = '')
  ) TO '{os.path.join(out, "nppes-ne.parquet")}' (FORMAT parquet, COMPRESSION zstd)""")
proc.wait()
os.remove(fifo)
n = con.execute(f"SELECT count(*) FROM '{os.path.join(out, 'nppes-ne.parquet')}' WHERE state IN ('CT','MA','ME','NH','RI','VT')").fetchone()[0]
con.execute(f"COPY (SELECT npi FROM '{os.path.join(out, 'nppes-ne.parquet')}' WHERE state IN ('CT','MA','ME','NH','RI','VT')) TO '{os.path.join(out, 'ne-npis.txt')}' (HEADER false)")
print(f"{name}: {n} New England NPIs")
