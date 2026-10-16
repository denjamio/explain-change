import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { collect, repoRoot } from "../../analysis/collect.ts";
import { inferConfig } from "../../config/infer.ts";
import { loadConfig } from "../../config/load.ts";
import { HOST_IDS, type HostId } from "../../contract/config.ts";
import type { Facts } from "../../contract/facts.ts";
import { BUDGET_RANGE, CONFIG_NAME, WORK_DIR } from "../../core/constants.ts";
import { UserError } from "../../core/errors.ts";
import { git } from "../../core/git.ts";
import { buildDigest } from "../../digest/digest.ts";
import { type ExplanationState, loadExplanation, prepareExplanation } from "../../explanation/store.ts";
import { changeHost, createHosts, type Hosts, shareable } from "../../hosts/index.ts";
import { defaultReportPath, writeReport } from "../../report/render.ts";
import { openReport, shouldOpen } from "../open.ts";
import { type ChangeResult, changeSummary, explanationSummary, nextStep, printChange, printJson } from "../output.ts";
import { ensureWorkdir, readFacts, workPaths, writeFacts } from "../workspace.ts";

export interface ExplainOptions {
  /** null: the current branch (`local`); "": the active PR of the branch (`pr`); else a PR id or URL. */
  pr: string | null;
  /** --host: where the PR lives, over project.host and the remotes. */
  host: string | null;
  base: string | null;
  includeUncommitted: boolean;
  specs: string[];
  budget: number | null;
  out: string | null;
  noOpen: boolean;
  json: boolean;
}

/** `local` and `pr`: collect the change, write the facts, the digest and the explanation draft, render the page. */
export function explain(opts: ExplainOptions, hosts: Hosts = createHosts()): number {
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
  if (opts.host !== null && !(HOST_IDS as readonly string[]).includes(opts.host)) {
    throw new UserError(`--host must be ${HOST_IDS.join(" or ")}, not '${opts.host}'.`);
  }
  let pr = opts.pr;
  const host = changeHost(root, pr, hosts, { flag: opts.host as HostId | null, config: config.host });
  if (pr === "" && host) {
    const branch = git(["branch", "--show-current"], root).trim();
    if (!branch) throw new UserError("HEAD is detached: pass the PR id, `explain-change pr <id>`.");
    pr = host.activePr(root, branch);
    process.stderr.write(`explain-change: PR ${pr}, the active PR from this branch\n`);
  }
  const work = ensureWorkdir(root);
  const facts = collect(root, config, {
    base: opts.base,
    includeUncommitted: opts.includeUncommitted,
    pr,
    host,
    specs: opts.specs,
  });
  writeFacts(work, facts);
  const digest = buildDigest(facts, opts.budget ?? config.budget);
  const paths = workPaths(work);
  writeFileSync(paths.digest, digest, "utf8");
  const action = prepareExplanation(work, facts);
  const status = loadExplanation(work, facts, root);
  const report = writeReport(opts.out ?? defaultReportPath(work, facts), facts, status);
  const opened = status.state === "valid" && shouldOpen(opts.noOpen) && openReport(report);
  const result: ChangeResult = {
    command: opts.pr === null ? "local" : "pr",
    change: changeSummary(facts),
    explanation: explanationSummary(status, action),
    paths: { ...paths, report },
    digestTokens: Math.round(digest.length / 4),
    opened,
    share: shareCommand(status.state, facts, hosts),
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
export function render(opts: RenderOptions, hosts: Hosts = createHosts()): number {
  const root = repoRoot();
  const work = join(root, WORK_DIR);
  const facts = readFacts(work);
  const status = loadExplanation(work, facts, root);
  const target = opts.out ?? defaultReportPath(work, facts);
  const report = opts.dryRun ? resolve(target) : writeReport(target, facts, status);
  const opened = !opts.dryRun && status.state === "valid" && shouldOpen(opts.noOpen) && openReport(report);
  const result: ChangeResult = {
    command: opts.dryRun ? "status" : "render",
    change: changeSummary(facts),
    explanation: explanationSummary(status),
    paths: { ...workPaths(work), report: opts.dryRun ? null : report },
    opened,
    share: shareCommand(status.state, facts, hosts),
    next: nextStep(status.state, opts.dryRun ? null : report),
    notes: facts.notes,
  };
  if (opts.json) printJson(result);
  else printChange(result);
  return status.state === "valid" ? 0 : 1;
}

const shareCommand = (state: ExplanationState, facts: Facts, hosts: Hosts) =>
  state === "valid" && shareable(facts, hosts) ? "explain-change share" : null;
