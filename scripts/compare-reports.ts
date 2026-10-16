/**
 * Why a rebuilt example differs from the committed one: the first differing paths of its embedded data, and whether
 * the report script itself changed. CI prints it when the examples are stale.
 *
 *   bun scripts/compare-reports.ts examples/01-….html [more.html…]   (compares with the version at HEAD)
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readReportData } from "../src/report/data.ts";

function diff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (out.length >= 5 || JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
    return;
  }
  out.push(`${path}: ${JSON.stringify(a)?.slice(0, 120)} → ${JSON.stringify(b)?.slice(0, 120)}`);
}

const script = (html: string) => html.slice(html.lastIndexOf("<script>"));
for (const file of process.argv.slice(2)) {
  const before = spawnSync("git", ["show", `HEAD:${file}`], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout;
  const after = readFileSync(file, "utf8");
  if (!before || before === after) continue;
  const out: string[] = [];
  if (before.includes('id="ec-data"') && after.includes('id="ec-data"')) {
    diff(readReportData(before), readReportData(after), "data", out);
  }
  if (script(before) !== script(after))
    out.push("the report script differs (another Bun version bundles it differently?)");
  console.log(`${file}: ${out.join(" | ") || "differs outside the data and the script"}`);
}
