import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { installSkill, SKILLS, skillRoots, uninstallSkill } from "../src/cli/commands/install.ts";
import { inFolder, npmSpec } from "../src/cli/commands/update.ts";
import { ROOT, tempDir } from "./helpers.ts";

const files = SKILLS["explain-change"] as Record<string, string>;

describe("skill install", () => {
  test("installs, then is a no-op, then replaces its own older install", () => {
    const dest = join(tempDir(), "explain-change");
    expect(installSkill(dest, files, { force: false, linkFrom: null })).toBe("installed");
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe(files["SKILL.md"] as string);
    expect(installSkill(dest, files, { force: false, linkFrom: null })).toBe("up-to-date");
    writeFileSync(join(dest, ".explain-change-install"), "0.0.1\n");
    expect(installSkill(dest, files, { force: false, linkFrom: null })).toBe("installed");
  });

  test("writes a skill's references in their folder", () => {
    const dest = join(tempDir(), "explain-change-configure");
    const configure = SKILLS["explain-change-configure"] as Record<string, string>;
    expect(installSkill(dest, configure, { force: false, linkFrom: null })).toBe("installed");
    expect(readFileSync(join(dest, "references", "components.md"), "utf8")).toBe(
      configure["references/components.md"] as string,
    );
  });

  test("a folder this tool did not write needs --force", () => {
    const dest = join(tempDir(), "explain-change");
    mkdirSync(dest);
    writeFileSync(join(dest, "mine.txt"), "keep");
    expect(installSkill(dest, files, { force: false, linkFrom: null })).toBe("skipped");
    expect(existsSync(join(dest, "mine.txt"))).toBe(true);
    expect(installSkill(dest, files, { force: true, linkFrom: null })).toBe("installed");
    expect(existsSync(join(dest, "mine.txt"))).toBe(false);
  });

  test("uninstall removes only its own install", () => {
    const dest = join(tempDir(), "explain-change");
    expect(uninstallSkill(dest)).toBe("absent");
    installSkill(dest, files, { force: false, linkFrom: null });
    expect(uninstallSkill(dest)).toBe("removed");
    expect(existsSync(dest)).toBe(false);
    mkdirSync(dest);
    writeFileSync(join(dest, "mine.txt"), "keep");
    expect(uninstallSkill(dest)).toBe("skipped");
    expect(existsSync(join(dest, "mine.txt"))).toBe(true);
  });

  test.skipIf(process.platform === "win32")("--link points each file at the source checkout", () => {
    const dest = join(tempDir(), "explain-change");
    expect(installSkill(dest, files, { force: false, linkFrom: join(ROOT, "skills/explain-change") })).toBe("linked");
    expect(lstatSync(join(dest, "SKILL.md")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe(
      readFileSync(join(ROOT, "skills/explain-change/SKILL.md"), "utf8"),
    );
  });

  test("the CLI carries the skills as they are in the repository", () => {
    for (const [name, skill] of Object.entries(SKILLS)) {
      for (const [file, text] of Object.entries(skill))
        expect(text).toBe(readFileSync(join(ROOT, "skills", name, file), "utf8"));
    }
    // Every file of a skill folder, references included: a file the CLI does not carry is missing for its users.
    for (const name of Object.keys(SKILLS)) {
      const onDisk = readdirSync(join(ROOT, "skills", name), { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) =>
          relative(join(ROOT, "skills", name), join(d.parentPath, d.name))
            .split(sep)
            .join("/"),
        )
        .sort();
      expect(Object.keys(SKILLS[name] as Record<string, string>).sort()).toEqual(onDisk);
    }
    expect(skillRoots("h")).toEqual([join("h", ".agents", "skills"), join("h", ".claude", "skills")]);
  });
});

describe("update", () => {
  test("an npm install updates through npm, only when global", () => {
    expect(npmSpec(null)).toBe("explain-change@latest");
    expect(npmSpec("v0.3.0")).toBe("explain-change@0.3.0");
    expect(npmSpec("0.3.0")).toBe("explain-change@0.3.0");
    const g = join("usr", "lib", "node_modules");
    expect(inFolder(join(g, "explain-change", "dist", "explain-change.js"), g)).toBe(true);
    expect(inFolder(join("home", "me", ".npm", "_npx", "a", "explain-change.js"), g)).toBe(false);
    expect(inFolder(g, g)).toBe(false);
  });
});
