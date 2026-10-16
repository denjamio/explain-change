import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installSkill, SKILLS, skillRoots } from "../src/cli/commands/install.ts";
import { assetName, verifyAsset } from "../src/cli/commands/update.ts";
import { expectedSum, formatSums, sha256 } from "../src/core/checksum.ts";
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

describe("checksums", () => {
  const bin = new TextEncoder().encode("binary");
  const sums = formatSums({ "explain-change-linux-x64": bin, "explain-change-darwin-arm64": new Uint8Array() });

  test("SHA256SUMS lines read like sha256sum's", () => {
    expect(sums.split("\n")[1]).toBe(`${sha256(bin)}  explain-change-linux-x64`);
    expect(expectedSum(sums, "explain-change-linux-x64")).toBe(sha256(bin));
    expect(expectedSum(`${sha256(bin).toUpperCase()} *a.exe\r\n`, "a.exe")).toBe(sha256(bin));
    expect(expectedSum(sums, "explain-change-linux")).toBeNull();
  });

  test("update installs only a listed asset with the listed hash", () => {
    expect(() => verifyAsset("explain-change-linux-x64", bin, sums)).not.toThrow();
    expect(() => verifyAsset("explain-change-linux-x64", new TextEncoder().encode("evil"), sums)).toThrow(
      "does not match",
    );
    expect(() => verifyAsset("explain-change-linux-arm64", bin, sums)).toThrow("does not list");
  });

  // install.sh needs curl and a POSIX shell; it runs here against a release served from file://.
  test.skipIf(process.platform === "win32")("install.sh refuses a binary that does not match", () => {
    const releases = tempDir();
    const dir = join(releases, "latest", "download");
    mkdirSync(dir, { recursive: true });
    const asset = assetName();
    const fake = new TextEncoder().encode('#!/bin/sh\necho "explain-change 9.9.9"\n');
    writeFileSync(join(dir, asset), fake);
    const install = (sumsText: string) => {
      writeFileSync(join(dir, "SHA256SUMS"), sumsText);
      const bin = tempDir();
      const p = spawnSync("sh", [join(ROOT, "install.sh")], {
        encoding: "utf8",
        env: { ...process.env, EXPLAIN_CHANGE_RELEASES: `file://${releases}`, EXPLAIN_CHANGE_BIN: bin },
      });
      return { status: p.status, stderr: p.stderr, installed: existsSync(join(bin, "explain-change")) };
    };
    expect(install(formatSums({ [asset]: fake }))).toMatchObject({ status: 0, installed: true });
    const bad = install(formatSums({ [asset]: new TextEncoder().encode("other") }));
    expect(bad).toMatchObject({ status: 1, installed: false });
    expect(bad.stderr).toContain("does not match");
    expect(install("")).toMatchObject({ status: 1, installed: false });
  });
});
