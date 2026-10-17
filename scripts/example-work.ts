/**
 * Rewrites an example's explanation with the current tool, the way an agent does it with the skill.
 *
 *   bun scripts/example-work.ts open <example> <dir>   the example's repository in <dir>, explained by this checkout:
 *                                                      a fresh digest and draft in <dir>/<repo>/.explain-change/,
 *                                                      and the committed explanation as .explain-change/reference.json
 *   bun scripts/example-work.ts save <example> <dir>   validates <dir>'s explanation with `render` and, when it is
 *                                                      valid, writes it back to the example
 *   bun scripts/example-work.ts list                   the examples (the real PRs, then the test fixtures)
 *
 * Then `bun run examples -- --real` rebuilds the pages. Run it after any change to the outline, the draft or the
 * rules: the examples show what the current version produces, and `bun run eval` scores agents against them.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "../src/core/fs.ts";
import { buildAssets } from "./build.ts";
import { exampleTargets, GIT_ENV } from "./build-examples.ts";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "src/cli/bin.ts");
const [command, name, dir] = process.argv.slice(2);

function cli(args: string[], cwd: string) {
  return spawnSync("bun", [CLI, ...args, "--no-open", "--json"], {
    cwd,
    env: { ...process.env, ...GIT_ENV },
    encoding: "utf8",
  });
}

/** The repository `open` built in `dir`: its only folder with a work folder. */
function repoIn(root: string): string {
  const hit = (d: string): string | null => {
    if (existsSync(join(d, ".explain-change"))) return d;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== ".git") {
        const found = hit(join(d, e.name));
        if (found) return found;
      }
    }
    return null;
  };
  const repo = hit(root);
  if (!repo) throw new Error(`no explained repository under ${root}: run open first`);
  return repo;
}

const targets = exampleTargets();
if (command === "list") {
  for (const t of targets) console.log(`${t.kind}\t${t.name}`);
  process.exit(0);
}
const target = targets.find((t) => t.name === name);
if (!target || !dir || !["open", "save"].includes(command ?? "")) {
  console.error("usage: bun scripts/example-work.ts open|save <example> <dir>  (examples: list)");
  process.exit(2);
}

if (command === "open") {
  await buildAssets();
  ensureDir(dir);
  const repo = target.build(dir);
  const p = cli(target.args, repo);
  if (p.status !== 0) throw new Error(p.stdout + p.stderr);
  if (existsSync(target.explanation))
    writeFileSync(join(repo, ".explain-change", "reference.json"), readFileSync(target.explanation));
  console.log(
    `${repo}\n  read .explain-change/digest.md, write .explain-change/explanation.json from its draft, then: save ${name} ${dir}`,
  );
} else {
  const repo = repoIn(dir);
  const p = cli(["render"], repo);
  const out = JSON.parse(p.stdout || "{}");
  if (p.status !== 0) {
    console.error(JSON.stringify(out.explanation?.issues ?? out, null, 2));
    process.exit(1);
  }
  const {
    version: _v,
    key: _k,
    lang: _l,
    ...body
  } = JSON.parse(readFileSync(join(repo, ".explain-change/explanation.json"), "utf8"));
  writeFileSync(target.explanation, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`saved ${target.explanation}`);
}
