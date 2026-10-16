import { closeSync, existsSync, openSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assessArchitecture } from "../../analysis/assess.ts";
import { looksGenerated, repoRoot } from "../../analysis/collect.ts";
import { draftConfig } from "../../config/draft.ts";
import { detectStructure, inferConfig, structureLayers } from "../../config/infer.ts";
import { loadConfig } from "../../config/load.ts";
import { Mapper } from "../../config/mapper.ts";
import { ADR_PATTERNS, CONFIG_NAME, MIGRATION_PATTERNS } from "../../core/constants.ts";
import { UserError } from "../../core/errors.ts";
import { gitPaths } from "../../core/git.ts";
import { matchesAny } from "../../core/glob.ts";
import { langOf } from "../../core/lang.ts";
import { basename, dirname } from "../../core/paths.ts";
import { byKeys } from "../../core/text.ts";
import { printJson } from "../output.ts";

/** `init`: writes a commented draft of .explain-change.toml from the folder layout. */
export function init(opts: { force: boolean; json: boolean }): number {
  const root = repoRoot();
  const path = join(root, CONFIG_NAME);
  if (existsSync(path) && !opts.force) throw new UserError(`${CONFIG_NAME} already exists (use --force to overwrite).`);
  const structure = detectStructure(gitPaths(["ls-files"], root));
  writeFileSync(path, draftConfig(basename(root), structure), "utf8");
  const layers = structureLayers(structure).length;
  if (opts.json)
    printJson({ command: "init", path, layout: structure.kind, components: structure.components.length, layers });
  else {
    console.log(
      `Wrote ${path}: ${structure.kind} layout, ${structure.components.length} components in ${layers} layers. ` +
        "Review it, then run `explain-change check`.",
    );
  }
  return 0;
}

/** A component changed in this share of the history or less (and at least QUIET_MIN commits) rarely changes. */
const QUIET_SHARE = 0.01;
const QUIET_MIN = 2;
/**
 * More single files than this in a component's paths, and it is a list to keep up by hand: a new file next to them
 * falls to another component, usually the shared kernel. Folders and name globs (`app/models/order**`) keep up.
 */
const SINGLE_FILES = 3;
const isSingleFile = (path: string) => !/[*?[]/.test(path) && /\.[^/]+$/.test(path);

/** The first bytes of a file, enough for a generator marker; null when it cannot be read. */
function fileHead(path: string): string | null {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(2048);
      return buf.toString("utf8", 0, readSync(fd, buf, 0, buf.length, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** `check`: validates the config and lists each lane with its components and file counts, and what no component holds. */
export function check(opts: { json: boolean; history: number }): number {
  const root = repoRoot();
  if (!existsSync(join(root, CONFIG_NAME))) throw new UserError(`No ${CONFIG_NAME}. Run \`explain-change init\`.`);
  const { config, errors } = loadConfig(root, () => inferConfig(root));
  if (errors.length) throw new UserError(`${CONFIG_NAME} has errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  const mapper = new Mapper(config);
  const counts = new Map(config.components.map((c) => [c.id, 0]));
  const unmapped: string[] = [];
  const hidden = { migrations: [] as string[], adrs: [] as string[] };
  for (const f of gitPaths(["ls-files"], root)) {
    const category = mapper.category(f);
    // A generated migration file (EF's .Designer.cs) is no evidence: ignoring it hides nothing.
    if (category === "ignored" && matchesAny(f, MIGRATION_PATTERNS) && !looksGenerated(fileHead(join(root, f)))) {
      hidden.migrations.push(f);
    }
    if (category === "ignored" && matchesAny(f, ADR_PATTERNS)) hidden.adrs.push(f);
    if (category === "test" || category === "ignored" || category === "docs" || category === "migration") continue;
    const comp = mapper.component(f);
    if (comp) counts.set(comp, (counts.get(comp) ?? 0) + 1);
    else if (category !== "config" && langOf(f)) unmapped.push(f);
  }
  const folders = new Map<string, number>();
  for (const f of unmapped) folders.set(dirname(f) || ".", (folders.get(dirname(f) || ".") ?? 0) + 1);
  const topFolders = [...folders.entries()].sort(byKeys(([d, n]) => [-n, d])).slice(0, 20);
  const empty = config.components.filter((c) => !counts.get(c.id)).map((c) => c.id);
  const warnings = [
    ...empty.map((id) => `component '${id}' matches no files`),
    ...(hidden.migrations.length
      ? [
          `[ignore] hides ${hidden.migrations.length} migration files, the data model's evidence (e.g. ${hidden.migrations[0]}): take them out of [ignore]`,
        ]
      : []),
    ...(hidden.adrs.length
      ? [
          `[ignore] hides ${hidden.adrs.length} architecture decision records, the decisions' evidence (e.g. ${hidden.adrs[0]}): take them out of [ignore]`,
        ]
      : []),
  ];
  const mapped = [...counts.values()].reduce((a, n) => a + n, 0);
  const fit = assessArchitecture(root, config, mapper, opts.history);
  const commitsOf = new Map(fit.activity.map((a) => [a.id, a.commits]));
  // Hints for a config that stays small and easy to keep: a component that rarely changes may belong inside its
  // context, and a list of single files breaks each time a file is added next to them.
  const quietMax = Math.max(QUIET_MIN, Math.floor(fit.commits * QUIET_SHARE));
  const quiet = fit.commits ? fit.activity.filter((a) => a.commits <= quietMax) : [];
  const singleFiles = config.components
    .map((c) => ({ id: c.id, files: c.paths.filter(isSingleFile) }))
    .filter((c) => c.files.length > SINGLE_FILES);
  if (opts.json) {
    printJson({
      command: "check",
      layers: config.layers.map((l) => ({
        id: l.id,
        name: l.name,
        components: config.components
          .filter((c) => c.layer === l.id)
          .map((c) => ({
            id: c.id,
            name: c.name,
            files: counts.get(c.id) ?? 0,
            commits: commitsOf.get(c.id) ?? 0,
            paths: c.paths,
          })),
      })),
      mapped,
      unmapped: { files: unmapped.length, folders: topFolders.map(([dir, files]) => ({ dir, files })) },
      violations: fit.violations,
      cycles: fit.cycles,
      changeTogether: { commits: fit.commits, pairs: fit.cochange },
      quiet: { maxCommits: quietMax, components: quiet },
      singleFiles,
      warnings,
    });
    return 0;
  }
  for (const w of warnings) process.stderr.write(`warn: ${w}\n`);
  const width = Math.max(0, ...config.components.map((c) => c.id.length));
  for (const layer of config.layers) {
    console.log(layer.id);
    for (const c of config.components.filter((c) => c.layer === layer.id)) {
      const files = `${String(counts.get(c.id) ?? 0).padStart(5)} files`;
      const commits = `${String(commitsOf.get(c.id) ?? 0).padStart(4)} commits`;
      console.log(`  ${c.id.padEnd(width)}  ${files}  ${commits}  ${c.paths.join(", ")}`);
    }
  }
  console.log(`${config.components.length} components, ${mapped} source files mapped, ${unmapped.length} unmapped`);
  for (const [dir, n] of topFolders) console.log(`  unmapped: ${dir}/ (${n} files)`);
  // How the config fits the code: the evidence for boundaries and rules.
  console.log(`\nDependencies that break [rules] today: ${fit.violations.length || "none"}`);
  for (const v of fit.violations) console.log(`  ${v.from} -> ${v.to}  ${v.refs} refs, e.g. ${v.example}  (${v.rule})`);
  console.log(`Components that depend on each other: ${fit.cycles.length || "none"}`);
  for (const c of fit.cycles) console.log(`  ${c.a} <-> ${c.b}  ${c.refsAB} / ${c.refsBA} refs`);
  console.log(`Components that change together (last ${fit.commits} commits): ${fit.cochange.length || "none"}`);
  for (const c of fit.cochange)
    console.log(`  ${c.a} + ${c.b}  ${c.commits} commits, ${Math.round(c.coupling * 100)}%`);
  console.log(
    `Components that rarely change (${quietMax} of the last ${fit.commits} commits or fewer): ${quiet.length || "none"}`,
  );
  for (const q of quiet) console.log(`  ${q.id}  ${q.commits} commit${q.commits === 1 ? "" : "s"}`);
  console.log(`Components that list more than ${SINGLE_FILES} single files: ${singleFiles.length || "none"}`);
  for (const c of singleFiles) console.log(`  ${c.id}  ${c.files.length} files, e.g. ${c.files[0]}`);
  return 0;
}
