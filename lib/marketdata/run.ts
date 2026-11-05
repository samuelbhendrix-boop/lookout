import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { importDataset } from "./import";
import type { Dataset } from "./datasets";

/**
 * Runs an import in a separate Node process when possible. Imports parse ~50 MB CSVs; isolating
 * them means a memory spike can never take the web server down with it, and memory is fully
 * returned to the OS afterwards. Falls back to in-process when the script isn't on disk.
 */
export async function runImport(dataset: Dataset, year: number): Promise<string> {
  const cwd = process.cwd();
  // Prefer the precompiled bundle (npm run build:import): running through tsx costs ~90 MB more per import process,
  // enough to push a 51-network rate import past a 512 MB server.
  const compiled = join(cwd, "dist", "import-market-data.cjs");
  const script = join(cwd, "scripts", "import-market-data.ts");
  const tsx = join(cwd, "node_modules", "tsx", "dist", "cli.mjs");
  const args = existsSync(compiled) ? [compiled] : existsSync(script) && existsSync(tsx) ? [tsx, script] : null;
  if (!args) {
    const rows = await importDataset(dataset, year);
    return `${dataset} ${year}: ${rows} rows (in-process)`;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=256", ...args, dataset, String(year)], {
      cwd,
      // One malloc arena + eager trim: zlib/undici fragment native memory across threads (409 → 304 MB peak on rate files).
      env: { ...process.env, MALLOC_ARENA_MAX: "1", MALLOC_TRIM_THRESHOLD_: "131072" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`import ${dataset} ${year} exited ${code}: ${out.slice(-400)}`)),
    );
  });
}
