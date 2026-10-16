import type { Config } from "../contract/config.ts";
import { CONTAINER_DIRS, DEFAULT_IGNORE, DEFAULT_TESTS, LAYER_HINTS } from "../core/constants.ts";
import { gitPaths } from "../core/git.ts";
import { matchesAny } from "../core/glob.ts";
import { langOf } from "../core/lang.ts";
import { basename, dirname } from "../core/paths.ts";
import { byKeys, camelize, compareStrings, slugify } from "../core/text.ts";
import { normalizeConfig } from "./load.ts";

/** A guessed component, the draft `init` writes and the map uses when there is no config. */
export interface GuessedComponent {
  id: string;
  name?: string;
  layer: string;
  paths: string[];
  desc: string;
}

export type LayoutKind = "rails" | "django" | "generic";

export interface Structure {
  kind: LayoutKind;
  components: GuessedComponent[];
}

/** app/<kind> → layer; null = not analyzed (assets). */
const RAILS_KINDS: Record<string, string | null> = {
  controllers: "web",
  channels: "web",
  serializers: "web",
  graphql: "web",
  views: "web",
  components: "web",
  helpers: "web",
  presenters: "web",
  decorators: "web",
  javascript: "web",
  frontend: "web",
  assets: null,
  services: "application",
  jobs: "application",
  workers: "application",
  interactors: "application",
  commands: "application",
  queries: "application",
  forms: "application",
  policies: "application",
  operations: "application",
  use_cases: "application",
  validators: "application",
  models: "domain",
  entities: "domain",
  value_objects: "domain",
  events: "domain",
  mailers: "infrastructure",
  clients: "infrastructure",
  adapters: "infrastructure",
  gateways: "infrastructure",
  integrations: "infrastructure",
  repositories: "infrastructure",
  uploaders: "infrastructure",
  notifiers: "infrastructure",
};
const RAILS_KIND_ORDER = Object.keys(RAILS_KINDS);
/** Presentation kinds: one "ui" component. Their folders mirror screens, not architecture, so they are never split. */
const RAILS_UI = ["views", "components", "helpers", "presenters", "decorators", "javascript", "frontend"];

/** Short names: they label the map's lanes. */
export const STRUCTURE_LAYERS: Record<LayoutKind, [string, string][]> = {
  rails: [
    ["web", "Web"],
    ["application", "Application"],
    ["domain", "Domain"],
    ["infrastructure", "Infrastructure"],
    ["other", "Other"],
  ],
  django: [
    ["web", "Web"],
    ["apps", "Apps"],
    ["shared", "Shared"],
    ["other", "Other"],
  ],
  generic: [...LAYER_HINTS.map(([id, name]) => [id, name] as [string, string]), ["other", "Other"]],
};
export const STRUCTURE_RULES: Record<LayoutKind, string[]> = {
  rails: [
    "web -> application",
    "web -> domain",
    "application -> domain",
    "application -> infrastructure",
    "infrastructure -> domain",
  ],
  django: ["web -> apps", "web -> shared", "apps -> shared"],
  generic: [],
};
const DJANGO_SHARED = new Set(["core", "common", "shared", "utils", "base", "lib", "libs", "commons"]);
const DJANGO_WEB = new Set(["api", "apis", "web", "frontend", "gateway", "graphql"]);

const isSource = (f: string) => !matchesAny(f, DEFAULT_IGNORE) && !matchesAny(f, DEFAULT_TESTS);
const componentId = (text: string) => slugify(text).toLowerCase().replace(/_/g, "-");

/** Framework-aware component guess from the repository's files. */
export function detectStructure(files: string[]): Structure {
  const src = files.filter(isSource);
  const fileSet = new Set(files);
  const hasModels = src.some((f) => f.startsWith("app/models/"));
  let structure: Structure;
  if (fileSet.has("config/application.rb") || (hasModels && fileSet.has("Gemfile"))) {
    structure = { kind: "rails", components: railsComponents(src) };
  } else {
    const django = djangoComponents(files, src);
    structure = django
      ? { kind: "django", components: django }
      : { kind: "generic", components: inferComponents(files) };
  }
  // Rules name layers and components alike, so a component never takes a layer's id.
  const layerIds = new Set(STRUCTURE_LAYERS[structure.kind].map(([id]) => id));
  const used = new Set<string>();
  for (const c of structure.components) {
    while ((layerIds.has(c.id) && c.layer !== c.id) || used.has(c.id)) c.id += "-x";
    used.add(c.id);
  }
  return structure;
}

/** One component per app/<kind>, big kinds split by namespace, presentation merged into "ui", plus lib, packs and engines. */
function railsComponents(src: string[]): GuessedComponent[] {
  const comps: GuessedComponent[] = [];
  const byKind = new Map<string, string[]>();
  for (const f of src) {
    const parts = f.split("/");
    if (parts.length >= 3 && parts[0] === "app" && (langOf(f) || parts[1] === "views")) {
      const kind = parts[1] as string;
      byKind.set(kind, [...(byKind.get(kind) ?? []), f]);
    }
  }
  const ui = RAILS_UI.filter((k) => byKind.has(k));
  if (ui.length) {
    comps.push({
      id: "ui",
      layer: "web",
      paths: ui.map((k) => `app/${k}/**`),
      desc: "Views, components, helpers and JS",
    });
  }
  const rank = (k: string) => (RAILS_KIND_ORDER.includes(k) ? RAILS_KIND_ORDER.indexOf(k) : 99);
  for (const kind of [...byKind.keys()].sort(byKeys((k) => [rank(k), k]))) {
    const layer = Object.hasOwn(RAILS_KINDS, kind) ? RAILS_KINDS[kind] : "other";
    if (layer === null || layer === undefined || RAILS_UI.includes(kind)) continue;
    const files = byKind.get(kind) ?? [];
    const subs = new Map<string, number>();
    for (const f of files) {
      const parts = f.split("/");
      if (parts.length > 3 && parts[2] !== "concerns")
        subs.set(parts[2] as string, (subs.get(parts[2] as string) ?? 0) + 1);
    }
    // Split a kind by namespace only when it is big and the namespace carries real weight (max 6 per kind).
    const big =
      files.length >= 30
        ? [...subs.entries()]
            .filter(([, n]) => n >= 8)
            .sort(byKeys(([sub, n]) => [-n, sub]))
            .slice(0, 6)
            .map(([sub]) => sub)
            .sort(compareStrings)
        : [];
    for (const sub of big) {
      // Named after the concept, not the Ruby syntax: Family = app/models/family.rb + app/models/family/**.
      const constant = camelize(sub);
      const words = sub.replace(/_/g, " ");
      const label = words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
      const root = `app/${kind}/${sub}.rb`;
      comps.push({
        id: componentId(`${kind}-${sub}`),
        layer,
        name: kind === "models" ? label : `${label} ${kind}`,
        paths: [...(files.includes(root) ? [root] : []), `app/${kind}/${sub}/**`],
        desc: kind === "models" ? `${constant} and the ${constant}:: namespace` : `${constant}:: ${kind}`,
      });
    }
    const withRoutes = kind === "controllers" && src.includes("config/routes.rb");
    comps.push({
      id: kind.replace(/_/g, "-"),
      layer,
      paths: [`app/${kind}/**`, ...(withRoutes ? ["config/routes.rb"] : [])],
      desc: "",
    });
  }
  if (src.some((f) => f.startsWith("lib/") && f.endsWith(".rb"))) {
    comps.push({ id: "lib", layer: "infrastructure", paths: ["lib/**"], desc: "" });
  }
  for (const container of ["packs", "engines", "components"]) {
    const packs = [
      ...new Set(
        src
          .filter((f) => f.startsWith(`${container}/`) && f.split("/").length >= 3)
          .map((f) => f.split("/")[1] as string),
      ),
    ].sort(compareStrings);
    for (const pack of packs) {
      comps.push({
        id: componentId(pack),
        layer: "other",
        paths: [`${container}/${pack}/**`],
        desc: `${container.slice(0, -1)} ${pack}`,
      });
    }
  }
  return comps;
}

/** One component per Django app, plus the project package and shared packages; null when this is not Django. */
function djangoComponents(files: string[], src: string[]): GuessedComponent[] | null {
  const pyDirs = new Set(src.filter((f) => f.endsWith(".py")).map(dirname));
  // An app is a package with apps.py, models, views or admin (apps without apps.py in INSTALLED_APPS included).
  const markers = new Set(["apps.py", "models.py", "views.py", "admin.py"]);
  let appDirs = [
    ...new Set([
      ...files.filter((f) => markers.has(basename(f))).map(dirname),
      ...files
        .filter((f) => f.endsWith("/models/__init__.py") || f.endsWith("/migrations/__init__.py"))
        .map((f) => dirname(dirname(f))),
    ]),
  ].sort(compareStrings);
  const projectFiles = new Set(["settings.py", "wsgi.py", "asgi.py"]);
  const settingsDirs = [
    ...new Set([
      ...src.filter((f) => projectFiles.has(basename(f))).map(dirname),
      ...src.filter((f) => f.includes("/settings/")).map((f) => dirname(dirname(f))),
    ]),
  ].sort(compareStrings);
  appDirs = appDirs.filter((d) => d && !settingsDirs.includes(d));
  if (!appDirs.length || !files.some((f) => basename(f) === "manage.py" || f.includes("/settings"))) return null;
  const project = settingsDirs.find((d) => d) ?? null;
  // A package grouping many small apps (integrations/<x>) is one component; a few keep their own.
  const nested = new Map<string, string[]>();
  for (const d of appDirs) {
    const parent = appDirs.find((o) => d.startsWith(`${o}/`)) ?? dirname(d);
    nested.set(parent, [...(nested.get(parent) ?? []), d]);
  }
  const collapsed = new Set(
    [...nested.entries()]
      .filter(([parent, kids]) => kids.length >= 6 && parent !== "" && parent !== project)
      .map(([p]) => p),
  );
  appDirs = appDirs.filter((d) => ![...collapsed].some((c) => d.startsWith(`${c}/`)));
  const topApps = appDirs.filter((d) => !appDirs.some((o) => d.startsWith(`${o}/`)));
  const parents = new Set(topApps.map(dirname));
  const isShared = (d: string) =>
    Boolean(d) &&
    parents.has(dirname(d)) &&
    !appDirs.includes(d) &&
    d !== project &&
    !appDirs.some((a) => d.startsWith(`${a}/`)) &&
    !["tests", "migrations", "templatetags", "management"].includes(basename(d));
  const packages = [...new Set([...[...pyDirs].filter(isShared), ...collapsed])].sort(compareStrings);
  const comps: GuessedComponent[] = [];
  const used = new Set<string>();
  for (const d of [...new Set([...appDirs, ...packages])].sort(byKeys((d) => [d.split("/").length - 1, d]))) {
    const label = basename(d) || "app";
    let id = componentId(label);
    while (used.has(id)) id += "-x";
    used.add(id);
    const isApp = appDirs.includes(d);
    const layer = DJANGO_WEB.has(label) ? "web" : DJANGO_SHARED.has(label) || !isApp ? "shared" : "apps";
    const desc = isApp
      ? `Django app ${label}`
      : collapsed.has(d)
        ? `${nested.get(d)?.length ?? 0} apps under ${label}/`
        : `package ${label}`;
    comps.push({ id, layer, paths: [`${d}/**`], desc });
  }
  if (files.some((f) => f.startsWith("templates/"))) {
    comps.push({ id: "templates", layer: "web", paths: ["templates/**"], desc: "Project-level templates" });
  }
  if (project) {
    // Only the project's own modules: apps nested inside the project package keep their own component.
    comps.unshift({
      id: "project",
      layer: "web",
      paths: [`${project}/*.py`, `${project}/settings/**`],
      desc: "Settings, root URLs, WSGI/ASGI",
    });
  }
  return comps;
}

/** Folder-based guess: first level, or second level under container folders (src/, packages/, …). */
function inferComponents(files: string[]): GuessedComponent[] {
  const groups = new Map<string, number>();
  for (const f of files) {
    if (!isSource(f)) continue;
    const parts = f.split("/");
    if (parts.length < 2 || (parts[0] as string).startsWith(".")) continue;
    const key =
      CONTAINER_DIRS.has(parts[0] as string) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : (parts[0] as string);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const used = new Set<string>();
  return [...groups.keys()].sort(compareStrings).map((key) => {
    let id = slugify(key.replace(/\//g, "-")).toLowerCase();
    while (used.has(id)) id += "-x";
    used.add(id);
    const leaf = (key.split("/").pop() as string).toLowerCase();
    const layer = LAYER_HINTS.find(([, , words]) => words.has(leaf))?.[0] ?? "other";
    return { id, layer, paths: [`${key}/**`], desc: "" };
  });
}

/** The layers a structure uses, in lane order. */
export function structureLayers(structure: Structure): [string, string][] {
  const used = new Set(structure.components.map((c) => c.layer));
  return STRUCTURE_LAYERS[structure.kind].filter(([id]) => used.has(id));
}

/** The config used when the repository has none: guessed, and marked as such everywhere it shows. */
export function inferConfig(root: string): Config {
  const structure = detectStructure(gitPaths(["ls-files"], root));
  const layers = structureLayers(structure).map(([id, name]) => ({ id, name }));
  const components = structure.components.map(({ id, name, layer, paths, desc }) => ({
    id,
    ...(name ? { name } : {}),
    layer,
    paths,
    desc,
  }));
  return normalizeConfig({ project: { name: basename(root) }, layers, components }, true).config;
}
