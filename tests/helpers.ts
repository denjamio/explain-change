import { expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GIT_ENV } from "../scripts/build-examples.ts";
import { collect } from "../src/analysis/collect.ts";
import { inferConfig } from "../src/config/infer.ts";
import { loadConfig, normalizeConfig } from "../src/config/load.ts";
import type { Facts } from "../src/contract/facts.ts";
import { UserError } from "../src/core/errors.ts";
import { Az, type AzResult } from "../src/hosts/azure-devops/az.ts";
import { Gh, type GhResult } from "../src/hosts/github/gh.ts";
import { changeHost, createHosts, type HostDeps, type Hosts } from "../src/hosts/index.ts";

export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src/cli/bin.ts");
// Every test runs git with a fixed identity and date, without the user's config, and never opens a browser.
Object.assign(process.env, GIT_ENV);

export function tempDir(prefix = "ec-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A throwaway git repository: `main` with two models, then branch `feature` with one more association. */
export class Repo {
  readonly path: string;

  constructor(config?: string, opts: { empty?: boolean } = {}) {
    this.path = tempDir();
    this.git("init", "-q", "-b", "main");
    if (opts.empty) return;
    this.write({ "app/models/order.rb": "class Order\nend\n", "app/models/line_item.rb": "class LineItem\nend\n" });
    if (config) this.write({ ".explain-change.toml": config });
    this.commit("base");
    this.git("checkout", "-qb", "feature");
    this.write({ "app/models/order.rb": "class Order\n  has_many :line_items\nend\n" });
    this.commit("feature");
  }

  git(...args: string[]): string {
    const p = spawnSync("git", args, { cwd: this.path, encoding: "utf8", env: process.env });
    if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
    return p.stdout;
  }

  write(files: Record<string, string>): void {
    for (const [path, text] of Object.entries(files)) {
      const f = join(this.path, path);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, text);
    }
  }

  commit(message: string): void {
    this.git("add", "-A");
    this.git("commit", "-qm", message);
  }

  /** Runs the CLI in this repository. */
  run(args: string[], env: Record<string, string> = {}) {
    const p = spawnSync("bun", [CLI, ...args], { cwd: this.path, encoding: "utf8", env: { ...process.env, ...env } });
    return { status: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
  }

  /** `run` with --json, parsed. */
  json(args: string[]) {
    const r = this.run([...args, "--json"]);
    return { status: r.status, out: JSON.parse(r.stdout), stderr: r.stderr };
  }

  read(path: string): string {
    return readFileSync(join(this.path, path), "utf8");
  }

  facts(): Facts {
    return JSON.parse(this.read(".explain-change/facts.json"));
  }

  collect(opts: { base?: string; uncommitted?: boolean; pr?: string; az?: Az } = {}): Facts {
    const { config, errors } = loadConfig(this.path, () => inferConfig(this.path));
    if (errors.length) throw new Error(errors.join("\n"));
    const pr = opts.pr ?? null;
    const hosts = fakeHosts({ az: opts.az });
    return collect(this.path, config, {
      base: opts.base ?? "main",
      includeUncommitted: opts.uncommitted ?? false,
      pr,
      host: changeHost(this.path, pr, hosts, { flag: null, config: config.host }),
      specs: [],
    });
  }

  close(): void {
    rmSync(this.path, { recursive: true, force: true });
  }
}

/** az replaced: each call returns the next scripted result; login is counted, never run. */
export class FakeAz extends Az {
  readonly calls: string[][] = [];
  logins = 0;

  constructor(
    private readonly results: AzResult[],
    private readonly loginOk = true,
  ) {
    super();
  }

  override call(args: string[]): AzResult {
    this.calls.push(args);
    return this.results.shift() ?? { error: "az CLI not found" };
  }

  override login(): boolean {
    this.logins++;
    return this.loginOk;
  }
}

/** The hosts with their CLIs and HTTP replaced: nothing runs outside the test. */
export function fakeHosts(deps: Partial<HostDeps> = {}): Hosts {
  return createHosts({
    az: deps.az ?? new FakeAz([]),
    gh: deps.gh ?? new FakeGh([]),
    fetch: deps.fetch ?? (async () => new Response("{}", { status: 500 })),
  });
}

/** gh replaced: each call returns the next scripted result. */
export class FakeGh extends Gh {
  readonly calls: string[][] = [];

  constructor(private readonly results: GhResult[]) {
    super();
  }

  override call(args: string[]): GhResult {
    this.calls.push(args);
    return this.results.shift() ?? { error: "gh CLI not found" };
  }
}

/** Expects `fn` to throw a UserError whose message contains `needle`. */
export function throwsUser(fn: () => unknown, needle: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(UserError);
    expect((e as Error).message).toContain(needle);
    return;
  }
  throw new Error(`expected a UserError with '${needle}'`);
}

export const ok = (stdout: unknown): AzResult => ({ status: 0, stdout: JSON.stringify(stdout), stderr: "" });
export const fail = (stderr: string): AzResult => ({ status: 1, stdout: "", stderr });

/** A config from components and layers, for analysis tests. */
export function makeConfig(
  components: { id: string; layer: string; paths: string[]; constants?: string[]; imports?: string[] }[],
  layers?: string[],
  rules: { allow?: string[]; forbid?: string[] } = {},
) {
  const ids = layers ?? [...new Set(components.map((c) => c.layer))].sort();
  const { config, errors } = normalizeConfig({ layers: ids.map((id) => ({ id })), components, rules }, false);
  if (errors.length) throw new Error(errors.join("\n"));
  return config;
}
