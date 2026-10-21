import type { NormalizedExplanation } from "../contract/explanation.ts";
import type { Facts } from "../contract/facts.ts";
import type { ExplanationState } from "../explanation/store.ts";
import type { Issue } from "../explanation/validate.ts";
import type { HunkSpan } from "../hosts/links.ts";
import type { Since } from "../review/since.ts";

/** What the page embeds as JSON and the report script draws. */
export interface ReportData {
  tool: string;
  facts: Facts;
  explanation: NormalizedExplanation | null;
  state: ExplanationState;
  issues: Issue[];
  /**
   * The hunks of each changed file before the page cut them to its excerpts: a link to a line opens the PR at it
   * only inside a hunk. Absent from pages rendered before 0.17.0.
   */
  hunkSpans?: Record<string, HunkSpan[]>;
  /** What changed in the PR since your last review of another head; absent without one. */
  since?: Since;
}

/** The data a rendered page embeds: what renderHtml wrote, for scripts and tests that read reports back. */
export function readReportData(html: string): ReportData {
  const m = /<script type="application\/json" id="ec-data">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("not an explain-change report: no embedded data");
  return JSON.parse(m[1] as string);
}
