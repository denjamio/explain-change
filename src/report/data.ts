import type { NormalizedExplanation } from "../contract/explanation.ts";
import type { Facts } from "../contract/facts.ts";
import type { ExplanationState } from "../explanation/store.ts";
import type { Issue } from "../explanation/validate.ts";

/** What the page embeds as JSON and the report script draws. */
export interface ReportData {
  tool: string;
  facts: Facts;
  explanation: NormalizedExplanation | null;
  state: ExplanationState;
  issues: Issue[];
}
