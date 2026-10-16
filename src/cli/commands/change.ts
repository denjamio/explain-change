import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Az } from "../../ado/az.ts";
import { branchPr, requireAdo } from "../../ado/pr.ts";
import { collect, repoRoot } from "../../analysis/collect.ts";
import { inferConfig } from "../../config/infer.ts";
import { loadConfig } from "../../config/load.ts";
import { BUDGET_RANGE, CONFIG_NAME, WORK_DIR } from "../../core/constants.ts";
import { UserError } from "../../core/errors.ts";
import { buildDigest } from "../../digest/digest.ts";
import { loadExplanation, prepareExplanation } from "../../explanation/store.ts";
import { defaultReportPath, writeReport } from "../../report/render.ts";
import { openReport, shouldOpen } from "../open.ts";
import { type ChangeResult, changeSummary, explanationSummary, nextStep, printChange, printJson } from "../output.ts";
import { ensureWorkdir, readFacts, workPaths, writeFacts } from "../workspace.ts";

export interface ExplainOptions {
  /** null: the current branch (`local`); "": the active PR of the branch (`pr`); else a PR id or URL. */
  pr: string | null;
  base: string | null;
  includeUncommitted: boolean;
  specs: string[];
  budget: number | null;
  out: string | null;
  noOpen: boolean;
  json: boolean;
}

/** `local` and `pr`: collect the change, write the facts, the digest and the explanation draft, render the page. */
export function explain(opts: ExplainOptions, az = new Az()): number {
  const root = repoRoot();
  const { config, errors } = loadConfig(root, () => inferConfig(root));
  if (errors.length) throw new UserError(`${CONFIG_NAME} has errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  if (config.inferred) {
    process.stderr.write(
      `⚠ No ${CONFIG_NAME}: layers and components are guessed from folder names. ` +
        "Ask your agent to configure explain-change, or run `explain-change init`.\n",
    );
  }
  if (
    opts.budget !== null &&
    (!Number.isInteger(opts.budget) || opts.budget < BUDGET_RANGE[0] || opts.budget > BUDGET_RANGE[1])
  ) {
    throw new UserError(`--budget must be an integer between ${BUDGET_RANGE[0]} and ${BUDGET_RANGE[1]}.`);
  }
  let pr = opts.pr;
  if (pr === "") {
    pr = branchPr(root, az);
    process.stderr.write(`explain-change: PR ${pr}, the active PR from this branch\n`);
  } else if (pr) requireAdo(root, pr);
  const work = ensureWorkdir(root);
  const facts = collect(
    root,
    config,
    { base: opts.base, includeUncommitted: opts.includeUncommitted, pr, specs: opts.specs },
    az,
  );
  writeFacts(work, facts);
  const digest = buildDigest(facts, opts.budget ?? config.budget);
  const paths = workPaths(work);
  writeFileSync(paths.digest, digest, "utf8");
  const action = prepareExplanation(work, facts);
  const status = loadExplanation(work, facts, root);
  const report = opts.out ?? defaultReportPath(work, facts);
  writeReport(report, facts, status);
  const opened = status.state === "valid" && shouldOpen(opts.noOpen) && openReport(report);
  const result: ChangeResult = {
    command: opts.pr === null ? "local" : "pr",
    change: changeSummary(facts),
    explanation: explanationSummary(status, action),
    paths: { ...paths, report },
    digestTokens: Math.round(digest.length / 4),
    opened,
    next: nextStep(status.state, report),
    notes: facts.notes,
  };
  if (opts.json) printJson(result);
  else printChange(result);
  return 0;
}

export interface RenderOptions {
  out: string | null;
  noOpen: boolean;
  json: boolean;
  /** Only report the state; write nothing. */
  dryRun: boolean;
}

/**
 * `render` validates explanation.json against the collected change and writes the page (facts only while the
 * explanation is not valid). `status` reports the same without writing. Both exit 1 until the explanation is valid.
 */
export function render(opts: RenderOptions): number {
  const root = repoRoot();
  const work = join(root, WORK_DIR);
  const facts = readFacts(work);
  const status = loadExplanation(work, facts, root);
  const report = opts.out ?? defaultReportPath(work, facts);
  if (!opts.dryRun) writeReport(report, facts, status);
  const opened = !opts.dryRun && status.state === "valid" && shouldOpen(opts.noOpen) && openReport(report);
  const result: ChangeResult = {
    command: opts.dryRun ? "status" : "render",
    change: changeSummary(facts),
    explanation: explanationSummary(status),
    paths: { ...workPaths(work), report: opts.dryRun ? null : report },
    opened,
    next: nextStep(status.state, opts.dryRun ? null : report),
    notes: facts.notes,
  };
  if (opts.json) printJson(result);
  else printChange(result);
  return status.state === "valid" ? 0 : 1;
}
