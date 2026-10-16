import { join } from "node:path";
import { Az } from "../../ado/az.ts";
import { shareReport } from "../../ado/share.ts";
import { repoRoot } from "../../analysis/collect.ts";
import { WORK_DIR } from "../../core/constants.ts";
import { UserError } from "../../core/errors.ts";
import { loadExplanation } from "../../explanation/store.ts";
import { renderHtml } from "../../report/render.ts";
import { printJson } from "../output.ts";
import { readFacts } from "../workspace.ts";

/** `share`: uploads the report of the explained change to its Azure DevOps PR and comments with the link. */
export async function share(
  opts: { force: boolean; json: boolean },
  deps = { az: new Az(), fetch: (url: string, init: RequestInit) => fetch(url, init) },
): Promise<number> {
  const root = repoRoot();
  const work = join(root, WORK_DIR);
  const facts = readFacts(work);
  const status = loadExplanation(work, facts, root);
  if (status.state !== "valid") {
    throw new UserError(
      `The explanation is ${status.state}: only a finished report is shared. Run \`explain-change status\` for the next step.`,
    );
  }
  const result = await shareReport(root, facts, renderHtml(facts, status), deps, opts.force);
  if (opts.json) printJson({ command: "share", ...result });
  else if (result.state === "already-shared") {
    console.log(
      `PR ${result.prId} already has this report: ${result.pr ?? result.attachment} (--force shares it again)`,
    );
  } else console.log(`shared on PR ${result.prId}: ${result.pr ?? result.attachment}`);
  return 0;
}
