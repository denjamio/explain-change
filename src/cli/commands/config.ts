import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assessArchitecture } from "../../analysis/assess.ts";
import { repoRoot } from "../../analysis/collect.ts";
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
    if (category === "ignored" && matchesAny(f, MIGRATION_PATTERNS)) hidden.migrations.push(f);
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
  if (opts.json) {
    printJson({
      command: "check",
      layers: config.layers.map((l) => ({
        id: l.id,
        name: l.name,
        components: config.components
          .filter((c) => c.layer === l.id)
          .map((c) => ({ id: c.id, name: c.name, files: counts.get(c.id) ?? 0, paths: c.paths })),
      })),
      mapped,
      unmapped: { files: unmapped.length, folders: topFolders.map(([dir, files]) => ({ dir, files })) },
      violations: fit.violations,
      cycles: fit.cycles,
      changeTogether: { commits: fit.commits, pairs: fit.cochange },
      warnings,
    });
    return 0;
  }
  for (const w of warnings) process.stderr.write(`warn: ${w}\n`);
  const width = Math.max(0, ...config.components.map((c) => c.id.length));
  for (const layer of config.layers) {
    console.log(layer.id);
    for (const c of config.components.filter((c) => c.layer === layer.id)) {
      console.log(`  ${c.id.padEnd(width)}  ${String(counts.get(c.id) ?? 0).padStart(5)} files  ${c.paths.join(", ")}`);
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
  return 0;
}
