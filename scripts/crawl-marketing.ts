import { crawlProductSites } from "../lib/marketing/run";
crawlProductSites(process.argv.slice(2).length ? process.argv.slice(2) : undefined).then((r) => { console.log(JSON.stringify(r)); process.exit(0); });
