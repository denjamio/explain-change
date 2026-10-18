import type { Facts } from "../contract/facts.ts";
import { CONFIG_NAME, FILES, WORK_DIR } from "../core/constants.ts";
import type { ExplanationState, ExplanationStatus } from "../explanation/store.ts";
import { formatIssue, type Issue } from "../explanation/validate.ts";
import { display } from "./workspace.ts";

/**
 * What the agent does next, by explanation state. Agents read `next.action` from `--json` output; people read the
 * same sentence in the terminal.
 */
export type NextAction = "configure" | "write-explanation" | "fix-explanation" | "collect-change" | "done";

export interface Next {
  action: NextAction;
  message: string;
}

export function nextStep(state: ExplanationState, reportPath: string | null, facts?: Facts): Next {
  const explanation = `${WORK_DIR}/${FILES.explanation}`;
  // A team config that maps none of the changed code draws an empty map: fix the config, not the prose.
  if (
    facts &&
    !facts.config.inferred &&
    facts.stats.codeLines > 0 &&
    facts.stats.mappedLines === 0 &&
    state !== "valid"
  ) {
    return {
      action: "configure",
      message: `None of the changed code is on the map: no component holds its folders. Update ${CONFIG_NAME} (\`explain-change check\` lists the unmapped files), then run \`explain-change local\` (or \`pr\`) again.`,
    };
  }
  switch (state) {
    case "missing":
      return {
        action: "write-explanation",
        message: `Read ${WORK_DIR}/${FILES.digest}. ${explanation} does not exist yet: create it with 1 Write, the draft at the end of the digest with every "<…>" filled, then run \`explain-change render\`.`,
      };
    case "draft":
      return {
        action: "write-explanation",
        message: `Read ${WORK_DIR}/${FILES.digest}, fill every "<…>" left in ${explanation}, then run \`explain-change render\`.`,
      };
    case "invalid":
      return {
        action: "fix-explanation",
        message: `Fix only the fields listed in ${explanation}, then run \`explain-change render\` again.`,
      };
    case "stale":
      return {
        action: "collect-change",
        message: `${explanation} belongs to another change. Run \`explain-change local\` (or \`pr\`) for this change first.`,
      };
    case "valid":
      return { action: "done", message: `The report is ready${reportPath ? `: ${display(reportPath)}` : ""}.` };
  }
}

/** The result of `local`, `pr`, `render` and `status`, printed as JSON with --json. */
export interface ChangeResult {
  command: string;
  change: {
    key: string;
    title: string;
    source: Facts["source"]["kind"];
    files: number;
    additions: number;
    deletions: number;
    components: number;
    newViolations: number;
    configInferred: boolean;
  };
  explanation: { state: ExplanationState; issues: Issue[]; fixed?: string[]; action?: "kept" | "restored" | "drafted" };
  paths: { facts: string; digest: string; explanation: string; report: string | null };
  digestTokens?: number;
  opened: boolean;
  /** The command that shares the finished report on its Azure DevOps PR; null when there is no PR to share it on. */
  share: string | null;
  next: Next;
  notes: string[];
}

export function changeSummary(facts: Facts): ChangeResult["change"] {
  return {
    key: facts.key,
    title: facts.source.title,
    source: facts.source.kind,
    files: facts.stats.files,
    additions: facts.stats.additions,
    deletions: facts.stats.deletions,
    components: facts.components.filter((c) => c.delta !== "unchanged").length,
    newViolations: facts.stats.newViolations,
    configInferred: facts.config.inferred,
  };
}

/** The explanation's state for the output: placeholders folded into one issue that lists their paths. */
export function explanationSummary(status: ExplanationStatus, action?: "kept" | "restored" | "drafted") {
  const holes = status.issues.filter((i) => i.code === "placeholder").map((i) => i.path);
  const issues: Issue[] = status.issues.filter((i) => i.code !== "placeholder");
  if (holes.length) {
    issues.unshift({
      path: FILES.explanation,
      code: "placeholder",
      message: `${holes.length} placeholders to write: ${holes.join(", ")}`,
    });
  }
  return {
    state: status.state,
    issues,
    ...(status.fixes?.length ? { fixed: status.fixes } : {}),
    ...(action ? { action } : {}),
  };
}

const STATE_LINE: Record<ExplanationState, string> = {
  missing: "missing",
  draft: "draft: placeholders left to fill",
  invalid: "rejected",
  stale: "stale: written for another change",
  valid: "valid ✓",
};

/** The terminal version of a change result. */
export function printChange(r: ChangeResult): void {
  const c = r.change;
  const lines = [
    `explain-change: ${c.files} files (+${c.additions} −${c.deletions}) · ${c.components} components · ` +
      `${c.newViolations} new violation(s) · key ${c.key}`,
  ];
  if (r.digestTokens !== undefined)
    lines.push(`  digest:       ${display(r.paths.digest)} (~${r.digestTokens} tokens)`);
  const restored = r.explanation.action === "restored" ? " (restored: this change was explained before)" : "";
  lines.push(`  explanation:  ${display(r.paths.explanation)}: ${STATE_LINE[r.explanation.state]}${restored}`);
  for (const issue of r.explanation.issues) {
    lines.push(`    - ${issue.code === "placeholder" ? issue.message.replace(/: .*/, "") : formatIssue(issue)}`);
  }
  for (const fix of r.explanation.fixed ?? []) lines.push(`    fixed: ${fix}`);
  if (r.paths.report) {
    lines.push(
      `  report:       ${display(r.paths.report)}${r.explanation.state === "valid" ? "" : " (facts only, no story yet)"}`,
    );
  }
  if (r.opened) lines.push("  opened in the browser");
  if (r.share) lines.push(`  share:        \`${r.share}\` attaches it to the PR, for whoever can open the PR`);
  for (const n of r.notes) lines.push(`  note:         ${n}`);
  lines.push(`  next:         ${r.next.message}`);
  console.log(lines.join("\n"));
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
