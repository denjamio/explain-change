/**
 * Writes the eval's assertions for each real example (examples/real/<name>/assertions.json): what any good
 * explanation of that PR says, written by a model once from the PR's title, description and diff, never from
 * explain-change's digest or explanation, so the eval does not grade the tool against its own output. They are
 * committed: every eval grades against the same assertions, so 2 versions compare. Review them once and delete the
 * ones that are wrong; nobody writes them by hand.
 *
 *   bun scripts/eval-assertions.ts [--model sonnet] [--force] [example…]
 *
 * An example that already has assertions keeps them unless --force. Costs about $0.05–0.15 per example (sonnet).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import type { Facts } from "../src/contract/facts.ts";
import { removeTree } from "../src/core/fs.ts";
import { buildAssets } from "./build.ts";
import { exampleTargets, GIT_ENV } from "./build-examples.ts";
import type { AssertionFile } from "./eval-graders.ts";
import { askModel, spent } from "./eval-judge.ts";

const ROOT = join(import.meta.dir, "..");
/** At most this many characters of diff reach the writer: code and migrations first, by size, tests last. */
const DIFF_CHARS = 60_000;
const ORDER = ["code", "migration", "config", "test", "docs"];

/** The change as a diff the writer reads, with each file's component; generated and vendored files left out. */
export function diffText(facts: Facts): string {
  const files = facts.files
    .filter((f) => f.category !== "ignored" && !f.binary)
    .sort(
      (a, b) =>
        ORDER.indexOf(a.category) - ORDER.indexOf(b.category) ||
        b.additions + b.deletions - (a.additions + a.deletions) ||
        (a.path < b.path ? -1 : 1),
    );
  let out = "";
  let left = 0;
  for (const f of files) {
    const body = [
      `### ${f.path} (${f.delta}, ${f.category}, component ${f.component ?? "none"})`,
      ...f.hunks.flatMap((h) => [
        `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@ ${h.header}`,
        ...h.lines.map(([k, t]) => `${k}${t}`),
      ]),
      f.truncated ? "[hunks left out: generated or too large]" : "",
    ].join("\n");
    if (out.length + body.length > DIFF_CHARS) left++;
    else out += `${body}\n`;
  }
  return left ? `${out}\n[${left} more files left out]` : out;
}

export function writerPrompt(facts: Facts): string {
  const touched = new Set(facts.files.map((f) => f.component).filter(Boolean));
  const components = facts.config.components
    .filter((c) => touched.has(c.id))
    .map((c) => `- ${c.id} (${c.name}): ${c.desc}`)
    .join("\n");
  return (
    "You write the assertions an eval grades explanations of this pull request with. An explanation is a short " +
    "design write-up: a TL;DR, the goal, a story over the architecture, flows, the data model and the design " +
    "decisions. Read the PR and its diff, then write the assertions:\n" +
    "- 5 to 8 of kind llm: each a condition on the explanation that any good explanation meets, starting with " +
    "'Says that' (e.g. 'Says that the export runs in a background job, not in the request.'). The most important " +
    "first: what the change does for a user or the system; where it sits (which components); a new or changed data " +
    "model; a design decision the PR description or the code states, with its reason.\n" +
    "- 1 or 2 of kind llm starting with 'Does not claim that': a plausible but false reading of this diff a " +
    "careless reader could write.\n" +
    "- 2 to 4 of kind mentions: a code name or domain term the explanation must name, as the diff spells it, with " +
    "its accepted alternatives in `any`.\n" +
    "Each condition checks 1 fact, in at most 25 words: never 'A, B and C', never a list of files, fields or " +
    "statuses. State the gist; an explanation that says it in its own words, without every detail, must pass. No " +
    "exact wording, no file paths, no line numbers, nothing a 1-page write-up leaves out. Ids are kebab-case.\n" +
    'Answer only with JSON: {"assertions": [{"id": "...", "kind": "llm", "text": "Says that ..."}, ' +
    '{"id": "...", "kind": "mentions", "text": "names the new model", "any": ["FamilyExport"]}]}\n\n' +
    `<pr-title>${facts.source.title}</pr-title>\n\n<pr-description>\n${facts.source.description.slice(0, 12_000)}\n</pr-description>\n\n` +
    `<components>\n${components}\n</components>\n\n<diff>\n${diffText(facts)}\n</diff>`
  );
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      model: { type: "string", default: "sonnet" },
      agent: { type: "string", default: "claude -p" },
      force: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  await buildAssets();
  const tmp = mkdtempSync(join(tmpdir(), "explain-change-assertions-"));
  const env = { ...process.env, ...GIT_ENV };
  try {
    const targets = exampleTargets().filter((t) =>
      positionals.length ? positionals.includes(t.name) : t.kind === "real",
    );
    for (const target of targets) {
      const file = join(dirname(target.explanation), "assertions.json");
      if (existsSync(file) && !values.force) {
        console.log(`${target.name}: has assertions (--force to rewrite)`);
        continue;
      }
      const repo = target.build(tmp);
      spawnSync("bun", [join(ROOT, "src/cli/bin.ts"), ...target.args, "--no-open", "--json"], {
        cwd: repo,
        env,
        encoding: "utf8",
      });
      const facts = JSON.parse(readFileSync(join(repo, ".explain-change/facts.json"), "utf8")) as Facts;
      const answer = askModel(values.agent as string, values.model as string, writerPrompt(facts));
      const json = answer?.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1);
      const assertions = (JSON.parse(json || "{}") as Partial<AssertionFile>).assertions;
      if (!assertions?.length) throw new Error(`${target.name}: no assertions in the answer:\n${answer}`);
      const out: AssertionFile = {
        $comment:
          "What any good explanation of this PR says, written by a model from the PR's title, description and diff only (scripts/eval-assertions.ts). The eval grades each run against them. Delete one that is wrong; keep them stable so evals compare.",
        generated: { model: values.model as string, head: facts.source.headSha },
        assertions,
      };
      writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
      console.log(`${target.name}: ${assertions.length} assertions (total $${spent().toFixed(2)})`);
    }
  } finally {
    removeTree(tmp);
  }
}
