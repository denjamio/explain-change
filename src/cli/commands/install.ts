import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import prompt from "../../../skills/explain-change/PROMPT.md" with { type: "text" };
import skill from "../../../skills/explain-change/SKILL.md" with { type: "text" };
import configureCheck from "../../../skills/explain-change-configure/references/check.md" with { type: "text" };
import configureComponents from "../../../skills/explain-change-configure/references/components.md" with {
  type: "text",
};
import configureRules from "../../../skills/explain-change-configure/references/rules-and-language.md" with {
  type: "text",
};
import configureSkill from "../../../skills/explain-change-configure/SKILL.md" with { type: "text" };
import { VERSION } from "../../core/constants.ts";
import { ensureDir } from "../../core/fs.ts";
import { printJson } from "../output.ts";

/**
 * The skills the CLI carries: folder name → files (a path may hold a folder: `references/check.md`). The configure
 * skill keeps its detail in references/, read only at the step that needs it. Agents with skill support find them in ~/.agents/skills and ~/.claude/skills. */
export const SKILLS: Record<string, Record<string, string>> = {
  "explain-change": { "SKILL.md": skill, "PROMPT.md": prompt },
  "explain-change-configure": {
    "SKILL.md": configureSkill,
    "references/check.md": configureCheck,
    "references/components.md": configureComponents,
    "references/rules-and-language.md": configureRules,
  },
};
const MARKER = ".explain-change-install"; // marks a folder this tool wrote, so a later install may replace it

export function skillRoots(home = homedir()): string[] {
  return [join(home, ".agents", "skills"), join(home, ".claude", "skills")];
}

type Outcome = "installed" | "linked" | "up-to-date" | "skipped" | "removed" | "absent";

/** The skills folder of a source checkout, when running from one (for --link). */
function sourceSkills(): string | null {
  try {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "skills");
    return existsSync(join(dir, "explain-change", "SKILL.md")) ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Writes one skill folder. Replaces earlier installs of this tool (they carry the marker); a folder without it is
 * someone else's and needs --force. With `link`, each file is a symlink to the source checkout, so edits show at once.
 */
export function installSkill(
  dest: string,
  files: Record<string, string>,
  opts: { force: boolean; linkFrom: string | null },
): Outcome {
  const marker = join(dest, MARKER);
  const exists = existsSync(dest) || isLink(dest);
  if (exists && !isLink(dest) && !existsSync(marker) && !opts.force) return "skipped";
  if (
    exists &&
    !opts.linkFrom &&
    existsSync(marker) &&
    readFileSync(marker, "utf8").trim() === VERSION &&
    Object.entries(files).every(
      ([name, text]) =>
        existsSync(join(dest, name)) && !isLink(join(dest, name)) && readFileSync(join(dest, name), "utf8") === text,
    )
  ) {
    return "up-to-date";
  }
  rmSync(dest, { recursive: true, force: true }); // removes links, never what they point to
  ensureDir(dest);
  for (const [name, text] of Object.entries(files)) {
    ensureDir(dirname(join(dest, name)));
    if (opts.linkFrom) symlinkSync(join(opts.linkFrom, name), join(dest, name));
    else writeFileSync(join(dest, name), text, "utf8");
  }
  writeFileSync(marker, `${VERSION}\n`, "utf8");
  return opts.linkFrom ? "linked" : "installed";
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** `install`: puts the agent skills where agents look for them. */
export function install(opts: { force: boolean; link: boolean; json: boolean; home?: string }): number {
  const linkRoot = opts.link ? sourceSkills() : null;
  if (opts.link && !linkRoot) {
    process.stderr.write("explain-change: --link needs a source checkout; installing copies instead.\n");
  }
  const results: { path: string; outcome: Outcome }[] = [];
  for (const root of skillRoots(opts.home)) {
    for (const [name, files] of Object.entries(SKILLS)) {
      const dest = join(root, name);
      results.push({
        path: dest,
        outcome: installSkill(dest, files, { force: opts.force, linkFrom: linkRoot ? join(linkRoot, name) : null }),
      });
    }
  }
  const skipped = results.filter((r) => r.outcome === "skipped");
  if (opts.json) printJson({ command: "install", version: VERSION, skills: results });
  else {
    for (const r of results) console.log(`${r.outcome.padEnd(10)} ${r.path}`);
    if (skipped.length)
      console.log("note: skipped folders that are not an explain-change install; use --force to replace them");
  }
  return skipped.length ? 1 : 0;
}

/** Removes one skill folder, only when this tool wrote it (it carries the marker). */
export function uninstallSkill(dest: string): Outcome {
  if (!existsSync(dest) && !isLink(dest)) return "absent";
  if (isLink(dest) || !existsSync(join(dest, MARKER))) return "skipped";
  rmSync(dest, { recursive: true, force: true }); // removes links, never what they point to
  return "removed";
}

/** `uninstall`: removes the agent skills `install` wrote, then says how to remove the CLI itself. */
export function uninstall(opts: { json: boolean; cli: string; home?: string }): number {
  const results = skillRoots(opts.home).flatMap((root) =>
    Object.keys(SKILLS).map((name) => ({ path: join(root, name), outcome: uninstallSkill(join(root, name)) })),
  );
  if (opts.json) printJson({ command: "uninstall", version: VERSION, skills: results, cli: opts.cli });
  else {
    for (const r of results) console.log(`${r.outcome.padEnd(10)} ${r.path}`);
    if (results.some((r) => r.outcome === "skipped"))
      console.log("note: kept folders that are not an explain-change install");
    console.log(`next: ${opts.cli}`);
  }
  return 0;
}
