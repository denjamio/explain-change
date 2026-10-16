import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { Facts } from "../contract/facts.ts";
import { CONTRACT_VERSION, FILES, WORK_DIR } from "../core/constants.ts";
import { UserError } from "../core/errors.ts";
import { ensureDir } from "../core/fs.ts";
import { git } from "../core/git.ts";

/** The work folder, .explain-change/ at the repository root. It is added to .git/info/exclude, never committed. */
export function ensureWorkdir(root: string): string {
  const work = join(root, WORK_DIR);
  ensureDir(join(work, FILES.reports));
  try {
    const raw = git(["rev-parse", "--git-path", "info/exclude"], root).trim();
    const exclude = isAbsolute(raw) ? raw : join(root, raw);
    const text = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    if (!text.split("\n").includes(`/${WORK_DIR}/`)) {
      ensureDir(join(exclude, ".."));
      writeFileSync(exclude, `${text}${text && !text.endsWith("\n") ? "\n" : ""}/${WORK_DIR}/\n`);
    }
  } catch {
    // a read-only .git still works: the folder only shows in `git status`
  }
  return work;
}

export const workPaths = (work: string) => ({
  facts: join(work, FILES.facts),
  digest: join(work, FILES.digest),
  explanation: join(work, FILES.explanation),
});

export function writeFacts(work: string, facts: Facts): void {
  writeFileSync(workPaths(work).facts, `${JSON.stringify(facts, null, 1)}\n`, "utf8");
}

export function readFacts(work: string): Facts {
  const path = workPaths(work).facts;
  if (!existsSync(path))
    throw new UserError("No change collected yet. Run `explain-change local` or `explain-change pr <id>` first.");
  const facts = JSON.parse(readFileSync(path, "utf8")) as Facts;
  if (facts.version !== CONTRACT_VERSION) {
    throw new UserError(
      "The collected change comes from another version of explain-change. Run `explain-change local` or `pr` again.",
    );
  }
  // Facts from 0.2 name no host: their PRs were all on Azure DevOps.
  facts.source.host ??= facts.source.kind === "pr" ? "azure-devops" : null;
  return facts;
}

/** A path as the user reads it: relative to the current folder when inside it. */
export function display(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}
