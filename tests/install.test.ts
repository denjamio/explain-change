import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installSkill, SKILLS, skillRoots } from "../src/cli/commands/install.ts";
import { assetName } from "../src/cli/commands/update.ts";
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

  test("a folder this tool did not write needs --force", () => {
    const dest = join(tempDir(), "explain-change");
    mkdirSync(dest);
    writeFileSync(join(dest, "mine.txt"), "keep");
    expect(installSkill(dest, files, { force: false, linkFrom: null })).toBe("skipped");
    expect(existsSync(join(dest, "mine.txt"))).toBe(true);
    expect(installSkill(dest, files, { force: true, linkFrom: null })).toBe("installed");
    expect(existsSync(join(dest, "mine.txt"))).toBe(false);
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
    expect(skillRoots("h")).toEqual([join("h", ".agents", "skills"), join("h", ".claude", "skills")]);
  });
});

describe("update", () => {
  test("release asset names", () => {
    expect(assetName("linux", "x64")).toBe("explain-change-linux-x64");
    expect(assetName("darwin", "arm64")).toBe("explain-change-darwin-arm64");
    expect(assetName("win32", "x64")).toBe("explain-change-windows-x64.exe");
    expect(() => assetName("freebsd", "x64")).toThrow("npm");
  });
});
