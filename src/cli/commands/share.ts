import { join } from "node:path";
import { repoRoot } from "../../analysis/collect.ts";
import { FILES, WORK_DIR } from "../../core/constants.ts";
import { UserError } from "../../core/errors.ts";
import { loadExplanation } from "../../explanation/store.ts";
import { createHosts, type Hosts } from "../../hosts/index.ts";
import { renderHtml } from "../../report/render.ts";
import { printJson } from "../output.ts";
import { readFacts } from "../workspace.ts";

/** `share`: attaches the report of the explained change to its PR and comments with the link. */
export async function share(
  opts: { force: boolean; json: boolean },
  hosts: Hosts = createHosts(),
  root: string = repoRoot(),
): Promise<number> {
  const work = join(root, WORK_DIR);
  const facts = readFacts(work);
  const host = facts.source.host ? hosts[facts.source.host] : null;
  if (!host) {
    throw new UserError("This repository has no remote of a PR host explain-change knows: the report stays local.");
  }
  const attach = host.api.share;
  if (!attach) {
    throw new UserError(
      `${host.name} cannot take the report as a PR attachment (its API and CLI attach only images and videos): send the HTML file in ${WORK_DIR}/${FILES.reports}/ yourself.`,
    );
  }
  const status = loadExplanation(work, facts, root);
  if (status.state !== "valid") {
    throw new UserError(
      `The explanation is ${status.state}: only a finished report is shared. Run \`explain-change status\` for the next step.`,
    );
  }
  const result = await attach(root, facts, renderHtml(facts, status), opts.force);
  if (opts.json) printJson({ command: "share", ...result });
  else if (result.state === "already-shared") {
    console.log(
      `PR ${result.prId} already has this report: ${result.pr ?? result.attachment} (--force shares it again)`,
    );
  } else console.log(`shared on PR ${result.prId}: ${result.pr ?? result.attachment}`);
  return 0;
}
