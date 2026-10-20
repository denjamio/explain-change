import type { Mapper } from "../config/mapper.ts";
import { fnmatch } from "../core/glob.ts";
import { basename, dirname, join, normpath } from "../core/paths.ts";
import { byKeys, camelize, compareStrings } from "../core/text.ts";
import type { Extracted, Ref } from "./refs.ts";

/** A tsconfig.json with path aliases or a baseUrl. */
export interface TsConfig {
  dir: string;
  base: string;
  hasBaseUrl: boolean;
  paths: [string, string[]][];
}

/** Where a reference leads: a component (with the file, when known), outside the repository, or nowhere. */
export type Resolution =
  | { kind: "component"; components: string[]; file: string | null }
  | { kind: "unmapped" }
  | { kind: "external" }
  | { kind: "unresolved" };

const EXTERNAL: Resolution = { kind: "external" };
const UNRESOLVED: Resolution = { kind: "unresolved" };
const TS_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
  ".vue",
  ".svelte",
  "/index.vue",
];

/** Resolves raw references to components for one side (base or head) of the change. */
export class SideIndex {
  private readonly lower = new Map<string, string>();
  private readonly overrides: Record<"imports" | "namespaces" | "constants", [string, string[]][]>;
  private readonly pyIndex = new Map<string, string>();
  private readonly djangoApps = new Map<string, string>(); // app label → app folder
  private readonly rbIndex = new Map<string, string>();
  /** C#: each namespace and who declares it, by project (the .csproj) and component. */
  private readonly csNamespaces = new Map<string, { project: string | null; component: string }[]>();
  /** C#: each folder that holds a .csproj, to that project; and each project read, to the projects it references. */
  private readonly csProjectByDir = new Map<string, string>();
  private readonly csProjectRefs = new Map<string, string[]>();
  private readonly csReachCache = new Map<string, Set<string>>();
  /** SQL: each stored procedure to the .sql file that creates it. A migration script that also creates it loses. */
  private readonly procedures = new Map<string, string>();

  constructor(
    private readonly files: ReadonlySet<string>,
    private readonly mapper: Mapper,
    private readonly tsconfigs: TsConfig[],
    extracted: ReadonlyMap<string, Extracted>,
  ) {
    for (const f of files) this.lower.set(f.toLowerCase(), f);
    const own = (k: "imports" | "namespaces" | "constants") =>
      mapper.components.filter((c) => c[k].length).map((c) => [c.id, c[k]] as [string, string[]]);
    this.overrides = { imports: own("imports"), namespaces: own("namespaces"), constants: own("constants") };

    const sorted = [...files].sort(compareStrings);
    // Python roots: the repository, src/, every manage.py folder and the parent of every Django app.
    const appFiles = sorted.filter((f) => basename(f) === "apps.py");
    const roots = [
      "",
      ...[
        ...new Set([
          ...sorted.filter((f) => basename(f) === "manage.py").map(dirname),
          ...appFiles.map((f) => dirname(dirname(f))),
        ]),
      ]
        .filter(Boolean)
        .sort(compareStrings),
    ];
    if (sorted.some((f) => f.startsWith("src/")) && !roots.includes("src")) roots.push("src");
    for (const f of appFiles) {
      const label = extracted.get(f)?.djangoLabel ?? basename(dirname(f));
      if (!this.djangoApps.has(label)) this.djangoApps.set(label, dirname(f));
    }
    for (const root of roots) {
      for (const f of sorted) {
        if (!f.endsWith(".py") || (root && !f.startsWith(`${root}/`))) continue;
        let mod = (root ? f.slice(root.length + 1) : f).slice(0, -3).replace(/\//g, ".");
        if (mod.endsWith(".__init__")) mod = mod.slice(0, -9);
        if (!this.pyIndex.has(mod)) this.pyIndex.set(mod, f);
      }
    }

    const acronyms: Record<string, string> = {};
    const inflections: Record<string, string> = {};
    for (const f of [...extracted.keys()].sort(compareStrings)) {
      const ex = extracted.get(f) as Extracted;
      for (const a of ex.rubyAcronyms ?? []) acronyms[a.toLowerCase()] = a;
      for (const [k, v] of ex.rubyInflections ?? []) inflections[k] = v;
    }
    // A constant goes to the first file that defines it, files the user ignores last: a generated or vendored copy
    // never takes a constant from the code that defines it.
    const skipped = notAutoloaded(sorted);
    const rubyFiles = sorted.filter((f) => f.endsWith(".rb"));
    const ignored = (f: string) => mapper.category(f) === "ignored";
    for (const f of [...rubyFiles.filter((f) => !ignored(f)), ...rubyFiles.filter(ignored)]) {
      for (const rel of zeitwerkPaths(f.slice(0, -3).split("/"), skipped)) {
        const constant = rel.map((s) => camelize(s, acronyms, inflections)).join("::");
        if (!this.rbIndex.has(constant)) this.rbIndex.set(constant, f);
      }
    }

    for (const f of sorted) {
      if (f.toLowerCase().endsWith(".csproj") && !this.csProjectByDir.has(dirname(f))) {
        this.csProjectByDir.set(dirname(f), f);
      }
    }
    for (const [f, ex] of [...extracted].sort(([a], [b]) => compareStrings(a, b))) {
      for (const name of ex.procedures ?? []) {
        const prev = this.procedures.get(name);
        if (!prev || (/DbScripts|migrations/i.test(prev) && !/DbScripts|migrations/i.test(f)))
          this.procedures.set(name, f);
      }
    }
    for (const [f, ex] of extracted) {
      if (!f.toLowerCase().endsWith(".csproj")) continue;
      const refs = ex.refs.filter((r) => r.kind === "csproj").map((r) => this.csprojFile(f, r.raw));
      this.csProjectRefs.set(
        f,
        refs.filter((r): r is string => r !== null),
      );
    }
    for (const [f, ex] of extracted) {
      const comp = mapper.component(f);
      if (!comp) continue;
      for (const ns of ex.namespaces) {
        const decls = this.csNamespaces.get(ns) ?? [];
        decls.push({ project: this.csProjectOf(f), component: comp });
        this.csNamespaces.set(ns, decls);
      }
    }
  }

  resolve(src: string, ref: Ref): Resolution {
    const overrideKind = ref.kind === "cs_using" ? "namespaces" : ref.kind === "rb_const" ? "constants" : "imports";
    const owner = this.overrides[overrideKind].find(([, patterns]) => patterns.some((p) => fnmatch(ref.raw, p)));
    if (owner) return { kind: "component", components: [owner[0]], file: null };
    let target: string | null = null;
    switch (ref.kind) {
      case "ts": {
        const hit = this.resolveTs(src, ref.raw);
        if (typeof hit !== "string") return hit;
        target = hit;
        break;
      }
      case "py": {
        const hit = this.resolvePy(src, ref.raw, ref.extra);
        if (typeof hit !== "string") return hit;
        target = hit;
        break;
      }
      case "rb_rel": {
        const base = join(dirname(src), ref.raw);
        target = this.file(base.endsWith(".rb") ? base : `${base}.rb`);
        if (!target) return UNRESOLVED;
        break;
      }
      case "rb_req":
        target = [`lib/${ref.raw}.rb`, `${ref.raw}.rb`, `app/${ref.raw}.rb`].find((t) => this.file(t)) ?? null;
        if (!target) return EXTERNAL;
        break;
      case "rb_const":
        target = this.resolveRubyConstant(ref.raw, ref.extra);
        if (!target || target === src) return EXTERNAL;
        break;
      case "dj_model": {
        if (!ref.raw.includes(".")) return EXTERNAL; // same app
        const appDir = this.djangoApps.get(ref.raw.split(".")[0] as string);
        if (appDir === undefined) return EXTERNAL; // e.g. auth.User
        target =
          [`${appDir}/models.py`, `${appDir}/models/__init__.py`, `${appDir}/apps.py`].find((t) => this.file(t)) ??
          null;
        break;
      }
      case "cs_using": {
        // As the compiler does: a using sees its own project and the projects it references, not every project
        // that happens to declare the same namespace.
        const decls = this.csNamespaces.get(ref.raw) ?? [];
        const reach = this.csReach(this.csProjectOf(src));
        const visible = reach ? decls.filter((d) => d.project === null || reach.has(d.project)) : decls;
        if (!visible.length) return EXTERNAL;
        const comps = [...new Set(visible.map((d) => d.component))].sort(compareStrings);
        return { kind: "component", components: comps, file: null };
      }
      case "sql_proc": {
        target = this.procedures.get(ref.raw) ?? null;
        if (!target) return EXTERNAL; // a procedure of another database, or a dynamic name
        break;
      }
      case "csproj": {
        target = this.csprojFile(src, ref.raw);
        if (!target) return UNRESOLVED;
        break;
      }
    }
    if (!target) return UNRESOLVED;
    const comp = this.mapper.component(target);
    return comp ? { kind: "component", components: [comp], file: target } : { kind: "unmapped" };
  }

  /** The .csproj a ProjectReference points at, matched without case as MSBuild does on Windows. */
  private csprojFile(src: string, raw: string): string | null {
    const path = normpath(join(dirname(src), raw.replace(/\\/g, "/")));
    return this.file(path) ?? this.lower.get(path.toLowerCase()) ?? null;
  }

  /** The project of a C# file: the .csproj in its folder or the nearest folder above it. */
  private csProjectOf(file: string): string | null {
    for (let dir = dirname(file); ; dir = dirname(dir)) {
      const project = this.csProjectByDir.get(dir);
      if (project) return project;
      if (!dir || dir === ".") return null;
    }
  }

  /** The projects a project sees: itself and its references, transitively; null when its .csproj was not read. */
  private csReach(project: string | null): Set<string> | null {
    if (!project || !this.csProjectRefs.has(project)) return null;
    const cached = this.csReachCache.get(project);
    if (cached) return cached;
    const reach = new Set<string>();
    const stack = [project];
    while (stack.length) {
      const p = stack.pop() as string;
      if (reach.has(p)) continue;
      reach.add(p);
      stack.push(...(this.csProjectRefs.get(p) ?? []));
    }
    this.csReachCache.set(project, reach);
    return reach;
  }

  private file(path: string): string | null {
    const p = normpath(path);
    return this.files.has(p) ? p : null;
  }

  private resolveTs(src: string, spec: string): string | Resolution {
    if (spec.startsWith(".")) return this.tryTs(join(dirname(src), spec)) ?? UNRESOLVED;
    for (const tc of this.tsconfigs) {
      if (tc.dir && !src.startsWith(`${tc.dir}/`)) continue;
      for (const [alias, targets] of tc.paths) {
        let star: string;
        if (alias.includes("*")) {
          const at = alias.indexOf("*");
          const pre = alias.slice(0, at);
          const post = alias.slice(at + 1);
          if (!(spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length)) continue;
          star = spec.slice(pre.length, spec.length - post.length);
        } else if (spec === alias) star = "";
        else continue;
        for (const t of targets) {
          const hit = this.tryTs(join(tc.base, t.replaceAll("*", star)));
          if (hit) return hit;
        }
      }
      if (tc.hasBaseUrl) {
        const hit = this.tryTs(join(tc.base, spec));
        if (hit) return hit;
      }
    }
    return EXTERNAL;
  }

  private tryTs(path: string): string | null {
    const base = normpath(path);
    const stems = [base, ...(/\.(m|c)?js$/.test(base) ? [base.replace(/\.(m|c)?js$/, "")] : [])];
    for (const stem of stems) {
      for (const suffix of TS_SUFFIXES) if (this.files.has(stem + suffix)) return stem + suffix;
    }
    return null;
  }

  private resolvePy(src: string, mod: string, names: readonly string[]): string | Resolution {
    if (mod.startsWith(".")) {
      const level = mod.length - mod.replace(/^\.+/, "").length;
      let pkg = dirname(src);
      for (let i = 0; i < level - 1; i++) pkg = dirname(pkg);
      const rest = mod.replace(/^\.+/, "").replace(/\./g, "/");
      const base = rest ? join(pkg, rest) : pkg;
      const candidates = [
        ...names.map((n) => `${base}/${n}.py`),
        ...names.map((n) => `${base}/${n}/__init__.py`),
        `${base}.py`,
        `${base}/__init__.py`,
      ];
      for (const c of candidates) {
        const hit = this.file(c);
        if (hit) return hit;
      }
      return UNRESOLVED;
    }
    for (const candidate of [...names.map((n) => `${mod}.${n}`), mod]) {
      const parts = candidate.split(".");
      while (parts.length) {
        const hit = this.pyIndex.get(parts.join("."));
        if (hit) return hit;
        parts.pop();
      }
    }
    return EXTERNAL;
  }

  /** Ruby's constant lookup: the lexical nesting from the innermost scope out, then the top level. */
  private resolveRubyConstant(constant: string, nesting: readonly string[]): string | null {
    const prefixes = [...[...nesting].reverse(), ""];
    const parts = constant.split("::");
    while (parts.length) {
      const name = parts.join("::");
      for (const pre of prefixes) {
        const hit = this.rbIndex.get(pre ? `${pre}::${name}` : name);
        if (hit) return hit;
      }
      parts.pop();
    }
    return null;
  }
}

/** The app/ folders Rails never autoloads: their Ruby files define no constants. */
const RAILS_NOT_AUTOLOADED = ["assets", "javascript", "views"];

/**
 * The app/ folders whose files define no constants: Rails' own, and app/admin where ActiveAdmin runs (it takes the
 * folder out of autoloading, and `ActiveAdmin.register Like` there registers Like, it does not define it).
 */
function notAutoloaded(files: readonly string[]): Set<string> {
  const out = new Set(RAILS_NOT_AUTOLOADED);
  if (
    files.some((f) => f === "config/initializers/active_admin.rb" || f.endsWith("/config/initializers/active_admin.rb"))
  )
    out.add("admin");
  return out;
}

/**
 * The constant paths Zeitwerk derives from a file: app/<kind>/a/b.rb → [a, b] (and app/<kind>/concerns/…), lib/a/b.rb
 * → [a, b]; none in an app/<kind> folder that is not autoloaded.
 */
function zeitwerkPaths(parts: string[], notAutoloadedKinds: ReadonlySet<string>): string[][] {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "app" && i + 2 < parts.length) {
      if (notAutoloadedKinds.has(parts[i + 1] as string)) return [];
      const rels = [parts.slice(i + 2)];
      if (parts[i + 2] === "concerns" && i + 3 < parts.length) rels.push(parts.slice(i + 3));
      return rels;
    }
    if (parts[i] === "lib" && i + 1 < parts.length) return [parts.slice(i + 1)];
  }
  return [];
}

/** tsconfig*.json files (up to 3 folders deep) that declare path aliases or a baseUrl, most specific folder first. */
export function loadTsConfigs(files: readonly string[], read: (path: string) => string | null): TsConfig[] {
  const out: TsConfig[] = [];
  for (const f of files) {
    const name = basename(f);
    if (!(name.startsWith("tsconfig") && name.endsWith(".json")) || f.split("/").length - 1 > 3) continue;
    const text = read(f);
    if (!text) continue;
    let options: { paths?: Record<string, string[]>; baseUrl?: string } | undefined;
    try {
      const json = JSON.parse(stripJsonc(text));
      options = json && typeof json === "object" ? (json.compilerOptions ?? {}) : undefined;
    } catch {
      continue;
    }
    if (!options || typeof options !== "object" || (!options.paths && !options.baseUrl)) continue;
    const dir = dirname(f);
    let base = dir || options.baseUrl ? normpath(join(dir, options.baseUrl ?? ".")) : "";
    if (base === ".") base = "";
    const paths = Object.entries(options.paths ?? {})
      .map(([k, v]) => [k, [...v]] as [string, string[]])
      .sort(byKeys(([k, v]) => [k, ...v]));
    out.push({ dir, base, hasBaseUrl: "baseUrl" in options, paths });
  }
  out.push(...bundlerAliases(files, read), ...workspacePackages(files, read));
  return out.sort(byKeys((t) => [-t.dir.length, t.dir]));
}

/**
 * The repository's own packages, by the name their package.json declares (`@immich/sdk` → packages/sdk), read as
 * tsconfig paths: a monorepo imports its packages by name, not by path. The source entry comes first (src/index),
 * then the entry package.json names, which often points at a build output the repository does not hold.
 */
export function workspacePackages(files: readonly string[], read: (path: string) => string | null): TsConfig[] {
  const paths: [string, string[]][] = [];
  for (const f of files) {
    if (
      basename(f) !== "package.json" ||
      !f.includes("/") ||
      f.split("/").length - 1 > 3 ||
      f.includes("node_modules/")
    )
      continue;
    let pkg: { name?: unknown; types?: unknown; module?: unknown; main?: unknown };
    try {
      pkg = JSON.parse(read(f) ?? "");
    } catch {
      continue;
    }
    if (typeof pkg?.name !== "string" || !pkg.name) continue;
    const dir = dirname(f);
    const entries = [pkg.types, pkg.module, pkg.main]
      .filter((e): e is string => typeof e === "string")
      .map((e) => normpath(join(dir, e)).replace(/\.(d\.ts|[cm]?js)$/, ""));
    paths.push(
      [pkg.name, [`${dir}/src/index`, `${dir}/index`, ...entries]],
      [`${pkg.name}/*`, [`${dir}/src/*`, `${dir}/*`]],
    );
  }
  return paths.length ? [{ dir: "", base: "", hasBaseUrl: false, paths: paths.sort(byKeys(([k]) => [k])) }] : [];
}

const BUNDLER_CONFIG_RE = /^(?:vite|vitest|svelte|webpack|nuxt)\.(?:config|shared)\.(?:[cm]?[jt]s)$/;

/**
 * Import aliases a bundler declares, read as tsconfig paths: `alias: { $lib: 'src/lib' }` (SvelteKit),
 * `dashboard: path.resolve('./app/javascript/dashboard')` (Vite). An alias whose target holds no file of the
 * repository (`vue: 'vue/dist/vue.esm-bundler.js'`) is a package, not a folder: it is left out. SvelteKit's `$lib`
 * is implicit when a project does not declare it.
 */
export function bundlerAliases(files: readonly string[], read: (path: string) => string | null): TsConfig[] {
  const out: TsConfig[] = [];
  const holdsFiles = (target: string) => files.some((f) => f === target || f.startsWith(`${target}/`));
  for (const f of files) {
    if (!BUNDLER_CONFIG_RE.test(basename(f)) || f.split("/").length - 1 > 3) continue;
    const text = read(f);
    if (!text) continue;
    const dir = dirname(f);
    const paths: [string, string[]][] = [];
    const block = /\balias(?:es)?\s*[:=]\s*\{/.exec(text);
    if (block) {
      let depth = 1;
      let i = block.index + block[0].length;
      const start = i;
      for (; i < text.length && depth; i++) depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
      const body = text.slice(start, i - 1);
      for (const m of body.matchAll(/(?:^|[,{\n])\s*(['"]?)([$@\w./*-]+)\1\s*:\s*([^,\n]+)/g)) {
        const literal = [...(m[3] as string).matchAll(/['"`]([^'"`]+)['"`]/g)].pop()?.[1];
        if (!literal) continue;
        const key = (m[2] as string).replace(/\/\*$/, "");
        const target = normpath(join(dir, literal.replace(/^\/+/, "").replace(/\/\*$/, "")));
        if (!holdsFiles(target)) continue;
        paths.push([key, [target]], [`${key}/*`, [`${target}/*`]]);
      }
    }
    if (basename(f).startsWith("svelte.") && !paths.some(([k]) => k === "$lib")) {
      const lib = normpath(join(dir, "src/lib"));
      if (holdsFiles(lib)) paths.push(["$lib", [lib]], ["$lib/*", [`${lib}/*`]]);
    }
    if (paths.length) out.push({ dir, base: "", hasBaseUrl: false, paths: paths.sort(byKeys(([k]) => [k])) });
  }
  return out;
}

/** Removes // and /* *\/ comments and trailing commas: tsconfig is JSONC. */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i] as string;
    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (text.startsWith("//", i)) {
      const j = text.indexOf("\n", i);
      i = j < 0 ? text.length : j;
      continue;
    } else if (text.startsWith("/*", i)) {
      const j = text.indexOf("*/", i + 2);
      i = j < 0 ? text.length : j + 2;
      continue;
    } else out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}
