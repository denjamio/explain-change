/*
 * explain-change report. Pure and deterministic: same data → same DOM and SVG. No dependencies.
 * Layout: a map (architecture lanes · data flows · data model) driven by a story whose steps move the camera and
 * light what changed; below it the design decisions, the SDD section (OpenSpec pipeline, requirement × component
 * matrix, scenarios) and the changes by component.
 */
import type { NormalizedExplanation } from "../src/contract/explanation.ts";
import type {
  ComponentFacts,
  Delta,
  DependencyFacts,
  FileFacts,
  Hunk,
  Requirement,
  Scenario,
  SpecChange,
} from "../src/contract/facts.ts";
import { prFileUrl as fileUrlOnPr } from "../src/hosts/links.ts";
import type { ReportData } from "../src/report/data.ts";
import BULB from "./bulb.svg" with { type: "text" };

type NFlow = NormalizedExplanation["flows"][number];
type NStep = NFlow["steps"][number];
type StoryStep = NormalizedExplanation["story"][number];
type Entity = NormalizedExplanation["dataModel"]["entities"][number];
type ReqStatus = "implemented" | "partial" | "missing" | "not-applicable" | "pending" | "none";

const DATA: ReportData = JSON.parse((document.getElementById("ec-data") as HTMLElement).textContent ?? "{}");
const facts = DATA.facts;
const ex = DATA.explanation;
const cfg = facts.config;
const src = facts.source;
const st = facts.stats;
const OS = facts.openspec;
const REDUCED = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

const I18N = {
  en: {
    story: "Story",
    canvas: "Map",
    architecture: "Architecture",
    spec: "SDD",
    openspec: "OpenSpec",
    local: "Local branch",
    pr: "Azure DevOps PR",
    commit: "commit",
    commits: "commits",
    noExplanation: "No story yet",
    noExplanationText: "Ask your agent to explain this change with explain-change.",
    draftExplanation: "Story in progress",
    draftExplanationText:
      "The explanation still has parts to write. Ask your agent to finish it and run explain-change render.",
    staleExplanation: "Story out of date",
    staleText: "The code changed after the story was written. Ask your agent to explain the change again.",
    invalidExplanation: "Story rejected",
    invalidText: "explanation.json has errors:",
    goal: "Goal",
    file: "file",
    kFiles: "files",
    kLines: "lines",
    kComponents: "components",
    component: "component",
    kTasks: "tasks",
    kReqs: "requirements",
    delta: "Changes",
    after: "After",
    before: "Before",
    decisions: "Design decisions",
    brokenRule: "broken rule",
    brokenRules: "broken rules",
    lAdded: "new",
    nAdded: "new",
    nChanged: "changed",
    nRemoved: "removed",
    lChanged: "changed",
    lRemoved: "removed",
    lNeighbor: "untouched",
    lUnchanged: "unchanged",
    lMoreRefs: "references changed",
    lViolation: "breaks a rule",
    lKey: "key dependency",
    refs: "refs",
    unresolved: "references in the changed files not resolved",
    unresolved1: "reference in the changed files not resolved",
    unmapped: "changed files outside the map",
    unmapped1: "changed file outside the map",
    context: "Context",
    contextHint:
      "Untouched components the changed code uses or is used by, through dependencies the change keeps as they were",
    lgComponents: "Components",
    lgDependencies: "Dependencies",
    lgSteps: "Steps",
    lgEntities: "Entities",
    nextStep: "Next",
    restart: "Back to the start",
    modeDelta: "Base and head together: what was added, changed and removed",
    modeAfter: "Only the result, as the code is now",
    modeBefore: "Only the starting point, as the code was",
    archEmpty: "No configured component is touched by this change.",
    startsAt: "Starts at",
    vsReference: "Compared with the reference flow",
    extraSteps: "new steps",
    missingSteps: "steps missing",
    matchesReference: "matches the reference flow",
    tests: "Tests",
    theme: "Theme",
    themeAuto: "auto",
    themeLight: "light",
    themeDark: "dark",
    alternative: "Alternative",
    unverified: "The code has no dependency between these components",
    viaPort: "Linked through {x}: both depend on it",
    unverifiedNote: "No dependency in the code:",
    prev: "Previous",
    next: "Next",
    fit: "Fit",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    motion: "Animation",
    resize: "Drag to resize · double-click to reset",
    canvasHint: "Drag to pan · Ctrl/⌘ + wheel to zoom · click a component for details · ← → to step",
    back: "Story",
    files: "Files",
    dependsOn: "Depends on",
    usedBy: "Used by",
    reqs: "Requirements",
    symbols: "Public API",
    storyAuto: "Automatic summary.",
    autoOverviewH: "{n} components touched in {m} layers",
    autoOverviewB: "{f} files, +{a} −{d} lines.",
    autoNewH: "{x} added",
    autoRemovedH: "{x} removed",
    autoViolH: "{a} now depends on {b}",
    autoChangedH: "{x} changed",
    autoChangedB: "{n} file(s), +{a} −{d}.",
    autoNewB: "New component in {l}.",
    autoRemovedB: "All its files were deleted.",
    autoSpecH: "{n} requirements in {id}",
    autoSpecB: "Spec changes included.",
    phaseActive: "active",
    phaseArchived: "archived",
    phaseArchiving: "archived by this change",
    proposal: "Proposal",
    specs: "Specs",
    designDoc: "Design",
    tasks: "Tasks",
    code: "Code",
    archive: "Archive",
    sAdded: "added",
    sModified: "edited",
    sUnchanged: "unchanged",
    sAbsent: "none",
    sDeleted: "deleted",
    pending: "pending",
    implemented: "implemented",
    partial: "partial",
    missing: "missing",
    "not-applicable": "n/a",
    notMapped: "not mapped",
    opADDED: "added",
    opMODIFIED: "modified",
    opREMOVED: "removed",
    opRENAMED: "renamed",
    opSPEC: "spec",
    scenarios: "Scenarios",
    why: "Why",
    whatChanges: "What changes",
    impact: "Impact",
    scenario: "Scenario",
    showFlow: "Show flow",
    kGIVEN: "Given",
    kWHEN: "When",
    kTHEN: "Then",
    but: "but",
    status: "Status",
    seeReqs: "See the requirements",
    showOnMap: "Show on the map",
    pendingMap: "Requirements not linked to code yet.",
    mainSpec: "main spec",
    merged: "merged",
    dataView: "Data model",
    migrations: "Migrations",
    fields: "Fields",
    relations: "Relations",
    evidence: "Evidence",
    coverageHint: "Share of the changed code that sits in a component on the map.",
    onMap: "of the code on the map",
    noConfig: "No architecture configured",
    noConfigText: "Layers and components are guessed from folder names. Run explain-change init to define them.",
    decisionsDoc: "Decisions",
    openTasksN: "{n} open",
    changesTitle: "Changes by component",
    outsideMap: "Outside the map",
    testFiles: "Tests",
    leadChanges: "{c} components · {f} files",
    leadDecisions: "{n} decisions: why it is built this way",
    leadDecision1: "1 decision: why it is built this way",
    leadSpec: "{n} requirements · {i} implemented",
  },
  es: {
    story: "Historia",
    canvas: "Mapa",
    architecture: "Arquitectura",
    spec: "SDD",
    openspec: "OpenSpec",
    local: "Rama local",
    pr: "PR de Azure DevOps",
    commit: "commit",
    commits: "commits",
    noExplanation: "Sin historia todavía",
    noExplanationText: "Pide a tu agente que explique este cambio con explain-change.",
    draftExplanation: "Historia en curso",
    draftExplanationText:
      "A la explicación le faltan partes por escribir. Pide a tu agente que la termine y ejecute explain-change render.",
    staleExplanation: "Historia desactualizada",
    staleText: "El código cambió después de escribir la historia. Pide a tu agente que vuelva a explicar el cambio.",
    invalidExplanation: "Historia rechazada",
    invalidText: "explanation.json tiene errores:",
    goal: "Objetivo",
    file: "archivo",
    kFiles: "archivos",
    kLines: "líneas",
    kComponents: "componentes",
    component: "componente",
    kTasks: "tareas",
    kReqs: "requisitos",
    delta: "Cambios",
    after: "Después",
    before: "Antes",
    decisions: "Decisiones de diseño",
    brokenRule: "regla rota",
    brokenRules: "reglas rotas",
    lAdded: "nuevo",
    nAdded: "nuevos",
    nChanged: "cambiados",
    nRemoved: "eliminados",
    lChanged: "cambiado",
    lRemoved: "eliminado",
    lNeighbor: "sin tocar",
    lUnchanged: "sin cambios",
    lMoreRefs: "referencias cambiadas",
    lViolation: "rompe una regla",
    lKey: "dependencia clave",
    refs: "refs",
    unresolved: "referencias sin resolver en los ficheros cambiados",
    unresolved1: "referencia sin resolver en los ficheros cambiados",
    unmapped: "archivos cambiados fuera del mapa",
    unmapped1: "archivo cambiado fuera del mapa",
    context: "Contexto",
    contextHint:
      "Componentes sin tocar que el código cambiado usa o que lo usan, por dependencias que el cambio deja como estaban",
    lgComponents: "Componentes",
    lgDependencies: "Dependencias",
    lgSteps: "Pasos",
    lgEntities: "Entidades",
    nextStep: "Siguiente",
    restart: "Volver al principio",
    modeDelta: "Base y head a la vez: qué se añadió, cambió y eliminó",
    modeAfter: "Solo el resultado, como queda el código",
    modeBefore: "Solo el punto de partida, como estaba el código",
    archEmpty: "Este cambio no toca ningún componente configurado.",
    startsAt: "Empieza en",
    vsReference: "Frente al flujo de referencia",
    extraSteps: "pasos nuevos",
    missingSteps: "pasos que faltan",
    matchesReference: "coincide con el flujo de referencia",
    tests: "Tests",
    theme: "Tema",
    themeAuto: "auto",
    themeLight: "claro",
    themeDark: "oscuro",
    alternative: "Alternativa",
    unverified: "El código no tiene dependencia entre estos componentes",
    viaPort: "Conectados a través de {x}: ambos dependen de él",
    unverifiedNote: "Sin dependencia en el código:",
    prev: "Anterior",
    next: "Siguiente",
    fit: "Ajustar",
    zoomIn: "Acercar",
    zoomOut: "Alejar",
    motion: "Animación",
    resize: "Arrastra para cambiar el alto · doble clic para restaurar",
    canvasHint:
      "Arrastra para mover · Ctrl/⌘ + rueda para zoom · clic en un componente para ver detalle · ← → para avanzar",
    back: "Historia",
    files: "Archivos",
    dependsOn: "Depende de",
    usedBy: "Usado por",
    reqs: "Requisitos",
    symbols: "API pública",
    storyAuto: "Resumen automático.",
    autoOverviewH: "{n} componentes tocados en {m} capas",
    autoOverviewB: "{f} archivos, +{a} −{d} líneas.",
    autoNewH: "{x} añadido",
    autoRemovedH: "{x} eliminado",
    autoViolH: "{a} ahora depende de {b}",
    autoChangedH: "{x} cambia",
    autoChangedB: "{n} archivo(s), +{a} −{d}.",
    autoNewB: "Componente nuevo en {l}.",
    autoRemovedB: "Se borraron todos sus archivos.",
    autoSpecH: "{n} requisitos en {id}",
    autoSpecB: "Cambios de spec incluidos.",
    phaseActive: "activo",
    phaseArchived: "archivado",
    phaseArchiving: "archivado en este cambio",
    proposal: "Propuesta",
    specs: "Specs",
    designDoc: "Diseño",
    tasks: "Tareas",
    code: "Código",
    archive: "Archivo",
    sAdded: "añadido",
    sModified: "editado",
    sUnchanged: "sin cambios",
    sAbsent: "no hay",
    sDeleted: "eliminado",
    pending: "pendiente",
    implemented: "implementado",
    partial: "parcial",
    missing: "falta",
    "not-applicable": "n/a",
    notMapped: "sin mapear",
    opADDED: "añadido",
    opMODIFIED: "modificado",
    opREMOVED: "eliminado",
    opRENAMED: "renombrado",
    opSPEC: "spec",
    scenarios: "Escenarios",
    why: "Por qué",
    whatChanges: "Qué cambia",
    impact: "Impacto",
    scenario: "Escenario",
    showFlow: "Ver flujo",
    kGIVEN: "Dado",
    kWHEN: "Cuando",
    kTHEN: "Entonces",
    but: "pero",
    status: "Estado",
    seeReqs: "Ver los requisitos",
    showOnMap: "Ver en el mapa",
    pendingMap: "Requisitos aún sin enlazar al código.",
    mainSpec: "spec principal",
    merged: "fusionado",
    dataView: "Modelo de datos",
    migrations: "Migraciones",
    fields: "Campos",
    relations: "Relaciones",
    evidence: "Evidencia",
    coverageHint: "Parte del código cambiado que está en un componente del mapa.",
    onMap: "del código en el mapa",
    noConfig: "Sin arquitectura configurada",
    noConfigText:
      "Capas y componentes deducidos de los nombres de carpetas. Ejecuta explain-change init para definirlos.",
    decisionsDoc: "Decisiones",
    openTasksN: "{n} abiertas",
    changesTitle: "Cambios por componente",
    outsideMap: "Fuera del mapa",
    testFiles: "Tests",
    leadChanges: "{c} componentes · {f} archivos",
    leadDecisions: "{n} decisiones: por qué está construido así",
    leadDecision1: "1 decisión: por qué está construido así",
    leadSpec: "{n} requisitos · {i} implementados",
  },
} as const;
type TKey = keyof (typeof I18N)["en"];
const T: Record<TKey, string> = I18N[cfg.lang] ?? I18N.en;
const t = (key: string): string => (T as Record<string, string>)[key] ?? key;
function tf(key: TKey, o: Record<string, string | number>): string {
  return T[key].replace(/\{(\w+)\}/g, (_, k: string) => (o[k] !== undefined ? String(o[k]) : ""));
}

// ── helpers ──
type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> | null;
const SVGNS = "http://www.w3.org/2000/svg";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const c of children) append(el, c);
  return el;
}
function s(tag: string, attrs?: Attrs, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVGNS, tag) as SVGElement;
  setAttrs(el, attrs);
  for (const c of children) append(el, c);
  return el;
}
function setAttrs(el: Element, attrs?: Attrs) {
  if (!attrs) return;
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.setAttribute("class", String(v));
    else if (k === "text") el.textContent = String(v);
    else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
}
function append(el: Node, child: Child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(el, c);
    return;
  }
  el.appendChild(
    typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child,
  );
}
/** Per-viewer conveniences in localStorage (remembered heights, theme, motion); the page works without them. */
function store<V>(key: string, value?: V | null): V | null {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
  return null;
}
const fmt = (n: number) => Number(n).toLocaleString(cfg.lang === "es" ? "es-ES" : "en-US");
function trunc(text: unknown, n: number): string {
  const v = String(text ?? "");
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}
// Shortens a label to the pixels it has (character counts misjudge wide letters and bold faces).
const measure = document.createElement("canvas").getContext("2d");
function fit(text: string, font: string, maxW: number): string {
  let v = String(text || "");
  if (!measure) return v;
  measure.font = `${font} ${getComputedStyle(document.body).fontFamily}`;
  if (measure.measureText(v).width <= maxW) return v;
  while (v.length > 1 && measure.measureText(`${v}…`).width > maxW) v = v.slice(0, -1);
  return `${v.trimEnd()}…`;
}
/** The list stored under `key`, created on first use. */
function listAt<T>(o: Record<string, T[]>, key: string): T[] {
  let list = o[key];
  if (!list) {
    list = [];
    o[key] = list;
  }
  return list;
}
/** A label's width in pixels, measured when the browser can (estimated per character otherwise). */
const MONO = 'ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, Consolas, monospace';
function textWidth(text: string, font: string, family?: string): number {
  if (!measure) return text.length * 7;
  measure.font = `${font} ${family ?? getComputedStyle(document.body).fontFamily}`;
  return measure.measureText(text).width;
}
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const r1 = (n: number) => Math.round(n * 10) / 10;
/** git's one-letter status of a changed file. */
const gitLetter = (f: FileFacts) =>
  f.delta === "added" ? "A" : f.delta === "removed" ? "D" : f.previousPath ? "R" : "M";

const compById: Record<string, (typeof cfg.components)[number]> = {};
const layerRank: Record<string, number> = {};
const compRank: Record<string, [number, number]> = {};
cfg.layers.forEach((l, i) => {
  layerRank[l.id] = i;
});
cfg.components.forEach((c, i) => {
  compById[c.id] = c;
  compRank[c.id] = [layerRank[c.layer] ?? 99, i];
});
function byCompRank(a: string, b: string): number {
  const ra = compRank[a] ?? [99, 999];
  const rb = compRank[b] ?? [99, 999];
  return ra[0] - rb[0] || ra[1] - rb[1] || (a < b ? -1 : a > b ? 1 : 0);
}
const changeComp: Record<string, ComponentFacts> = {};
for (const c of facts.components) changeComp[c.id] = c;
const fileIndex: Record<string, number> = {};
facts.files.forEach((f, i) => {
  fileIndex[f.path] = i;
});
const summaryOf: Record<string, string> = {};
if (ex) for (const c of ex.components) summaryOf[c.id] = c.summary;
const compName = (id: string) => compById[id]?.name ?? id;
function layerName(id: string): string {
  const c = compById[id];
  return c ? (cfg.layers[layerRank[c.layer] ?? -1]?.name ?? c.layer) : "";
}
/** The label of a delta: a component left untouched is a "neighbor"; anything else unchanged is "unchanged". */
function deltaLabel(delta: Delta, component = false): string {
  if (delta === "unchanged") return component ? T.lNeighbor : T.lUnchanged;
  return t(`l${cap(delta)}`);
}

// OpenSpec: the requirements (deltas of the changes, then main-spec edits no delta covers) and the agent's map.
const REQS: Requirement[] = [];
const reqById: Record<string, Requirement> = {};
if (OS) {
  for (const c of OS.changes) REQS.push(...c.requirements);
  const seen = new Set(REQS.map((r) => r.id));
  for (const sp of OS.specs) for (const r of sp.requirements) if (!seen.has(r.id)) REQS.push(r);
  for (const r of REQS) reqById[r.id] = r;
}
const specMap: Record<string, NormalizedExplanation["requirements"][number]> = {};
if (ex) for (const m of ex.requirements) specMap[m.id] = m;
const reqsOfComp = (id: string) => REQS.filter((r) => specMap[r.id]?.components?.includes(id));
/** Requirement ids → the components that implement them; component ids pass through. */
function specComponents(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const comps = reqById[id] ? (specMap[id]?.components ?? []) : compById[id] ? [id] : [];
    for (const c of comps) if (!out.includes(c)) out.push(c);
  }
  return out;
}
/** The agent's status; pending = not mapped yet; none = removed or renamed, nothing to map. */
function reqStatus(r: Requirement): ReqStatus {
  const m = specMap[r.id];
  if (m) return m.status;
  return ex?.requirements.length || r.op === "REMOVED" || r.op === "RENAMED" ? "none" : "pending";
}
const RS_ICON: Record<ReqStatus, string> = {
  implemented: "✓",
  partial: "◐",
  missing: "✗",
  "not-applicable": "–",
  pending: "…",
  none: "–",
};
const rsLabel = (v: ReqStatus) => (v === "pending" ? T.notMapped : v === "none" ? "—" : t(v));

// A file reference links to the file in the PR when the source has one; otherwise it is plain text.
function prFileUrl(path: string): string | null {
  return src.kind === "pr" && src.url && src.host ? fileUrlOnPr(src.host, src.url, path) : null;
}
function onOpen<E extends Element>(el: E, path: string): E {
  const url = prFileUrl(path);
  if (url) {
    el.classList.add("linked");
    el.addEventListener("click", () => window.open(url, "_blank", "noopener"));
  }
  return el;
}
function fileLink(ref: string, label?: string): HTMLElement {
  const path = /^(.+?):\d+/.exec(ref || "")?.[1] ?? ref;
  const url = prFileUrl(path);
  return url
    ? h("a", { href: url, target: "_blank", rel: "noopener", class: "ref", text: label || ref })
    : h("code", { class: "ref", text: label || ref });
}
/** A section: its title, one line with its figures, then the body. */
function sectionShell(id: string, title: string, body: Child, lead?: string): HTMLElement {
  return h(
    "section",
    { class: "section", id },
    h(
      "div",
      { class: "section-head" },
      h("h2", { text: title }),
      lead ? h("span", { class: "section-lead", text: lead }) : null,
    ),
    body,
  );
}
function legendItem(kind: string, color: string, label: string): HTMLElement {
  if (kind === "swatch") return h("span", null, h("i", { class: "swatch", style: `background:${color}` }), label);
  return h(
    "span",
    null,
    h("i", {
      class: `legend-line${kind.includes("anim") ? " anim" : ""}`,
      style: `border-top-color:${color}${kind.includes("dashed") ? ";border-top-style:dashed" : ""}`,
    }),
    label,
  );
}

// ═════════════════════════════ header ═════════════════════════════
function renderHeader(): HTMLElement {
  const states: Record<string, [string, string]> = {
    stale: [T.staleExplanation, T.staleText],
    invalid: [T.invalidExplanation, T.invalidText],
    draft: [T.draftExplanation, T.draftExplanationText],
  };
  const [noticeTitle, noticeText] = states[DATA.state] ?? [T.noExplanation, T.noExplanationText];
  const notice = ex
    ? null
    : h(
        "div",
        { class: "notice" },
        h("span", { class: "notice-icon", text: "i" }),
        h(
          "div",
          null,
          h("b", { text: noticeTitle }),
          " ",
          noticeText,
          DATA.state === "invalid"
            ? h(
                "ul",
                null,
                DATA.issues.slice(0, 20).map((e) => h("li", { text: `${e.path}: ${e.message}` })),
              )
            : null,
        ),
      );
  const counts = { added: 0, changed: 0, removed: 0 };
  for (const c of facts.components) if (c.delta !== "unchanged") counts[c.delta]++;
  const srcLabel = src.kind === "pr" ? `${T.pr} #${src.prId}` : T.local;
  const coverage = st.codeLines ? Math.round((100 * (st.mappedLines || 0)) / st.codeLines) : 100;
  // One chip per question: how big (files, lines), what moved (components), is the spec met, what to check.
  const part = (v: string | number, label: string, cls?: string): Child[] => [
    h("b", { class: cls || "", text: String(v) }),
    h("span", { text: label }),
  ];
  function group(parts: (Child[] | null)[], title?: string | null, href?: string | null): HTMLElement {
    const el = h(href ? "a" : "span", { class: "stat-chip", title: title || null, href: href || null }) as HTMLElement;
    parts.filter(Boolean).forEach((pt, i) => {
      if (i) el.appendChild(h("span", { class: "sep", text: "·" }));
      append(el, pt as Child);
    });
    return el;
  }
  const moved = [
    counts.added ? part(counts.added, counts.added === 1 ? T.lAdded : T.nAdded, "added") : null,
    counts.changed ? part(counts.changed, counts.changed === 1 ? T.lChanged : T.nChanged, "changed") : null,
    counts.removed ? part(counts.removed, counts.removed === 1 ? T.lRemoved : T.nRemoved, "removed") : null,
  ].filter(Boolean);
  const chips: Child[] = [
    group([
      part(fmt(st.files), st.files === 1 ? T.file : T.kFiles),
      [
        h(
          "b",
          null,
          h("span", { class: "add", text: `+${fmt(st.additions)}` }),
          " ",
          h("span", { class: "del", text: `−${fmt(st.deletions)}` }),
        ),
        h("span", { text: T.kLines }),
      ],
    ]),
    moved.length ? group(moved, null, "#changes") : null,
    coverage < 100
      ? h(
          "span",
          { class: "stat-chip", title: T.coverageHint },
          h("b", { text: `${coverage}%` }),
          h("span", { text: T.onMap }),
        )
      : null,
    st.newViolations
      ? chip(st.newViolations, st.newViolations === 1 ? T.brokenRule : T.brokenRules, "violation")
      : null,
  ];
  if (OS) {
    let done = 0;
    let total = 0;
    for (const c of OS.changes) {
      if (c.tasks) {
        done += c.tasks.done;
        total += c.tasks.total;
      }
    }
    const spec = [
      REQS.length ? part(REQS.length, T.kReqs, "accent") : null,
      total ? part(`${done}/${total}`, T.kTasks, done === total ? "ok" : "warn") : null,
    ].filter(Boolean);
    if (spec.length) chips.push(group(spec, null, "#sdd"));
  }
  return h(
    "header",
    { class: "page-head", id: "summary" },
    cfg.inferred
      ? h(
          "div",
          { class: "config-warn", role: "note" },
          h("span", { class: "config-warn-icon", text: "!" }),
          h("div", null, h("b", { text: T.noConfig }), " ", h("span", { text: T.noConfigText })),
        )
      : null,
    h(
      "div",
      { class: "eyebrow" },
      h("span", { text: cfg.name }),
      h("span", { class: "faint", text: "·" }),
      src.url ? h("a", { href: src.url, text: srcLabel }) : h("span", { text: srcLabel }),
      h("span", { class: "faint", text: "·" }),
      h("span", null, h("code", { text: src.branch }), " → ", h("code", { text: src.baseRef })),
      h("span", {
        class: "faint",
        text: `${src.commits} ${src.commits === 1 ? T.commit : T.commits}${src.headDate ? ` · ${src.headDate.slice(0, 10)}` : ""}`,
      }),
    ),
    h("h1", { class: "title", text: src.title }),
    ex ? h("p", { class: "goal" }, h("b", { text: T.goal }), ex.goal) : null,
    ex ? h("p", { class: "tldr", text: ex.tldr }) : null,
    notice,
    h("div", { class: "chips" }, chips),
    facts.notes.map((n) => h("p", { class: "note faint", text: n })),
  );
}
function chip(v: number, label: string, cls?: string): HTMLElement {
  return h("span", { class: `stat-chip ${cls || ""}` }, h("b", { text: String(v) }), h("span", { text: label }));
}

// ═════════════════════════════ views ═════════════════════════════
// Every view draws into one SVG and registers its focusable elements: geo[key] (box), data-k on the element, and
// edges carrying data-a / data-b. `expand(set)` says what else lights up with a focus set.
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface View {
  id: string;
  svg: SVGElement;
  W: number;
  H: number;
  geo: Record<string, Box>;
  empty?: string;
  links?: [string, string][];
  keyOf: (x: string) => string;
  expand: (set: Record<string, boolean>) => Record<string, boolean>;
  focusBoxKeys?: (ids: string[]) => string[];
}

function newView(id: string, W: number, H: number): View {
  const svg = s("svg", {
    class: `view-svg view-${id.split(":")[0]}`,
    role: "img",
    preserveAspectRatio: "xMidYMid meet",
  });
  return { id, svg, W, H, geo: {}, keyOf: (x) => x, expand: (set) => set };
}
function markers(svg: SVGElement, prefix: string, kinds: string[]) {
  const defs = s("defs");
  for (const k of kinds) {
    defs.appendChild(
      s(
        "marker",
        {
          id: prefix + k,
          viewBox: "0 0 10 10",
          refX: "8",
          refY: "5",
          markerWidth: "10",
          markerHeight: "10",
          markerUnits: "userSpaceOnUse",
          orient: "auto-start-reverse",
        },
        s("path", { d: "M0,0 L10,5 L0,10 z", class: `arrow arrow-${k}` }),
      ),
    );
  }
  svg.appendChild(defs);
}

// ── Architecture: lanes (layers, top = entry), components ordered to cut crossings ──
const keyPairs: Record<string, string> = {};
if (ex) for (const x of ex.keyDependencies) keyPairs[`${x.from}>${x.to}`] = x.label ?? "";

interface ArchLayout {
  W: number;
  H: number;
  bands: { layer: (typeof cfg.layers)[number]; y: number; h: number; n: number }[];
  pos: Record<string, Box>;
  compact: boolean;
  GX: number;
}

function layoutArch(nodes: ComponentFacts[], edges: DependencyFacts[], compact: boolean): ArchLayout {
  const W = compact ? 380 : 1160;
  const LABEL = compact ? 0 : 156;
  const NW = compact ? 168 : 200;
  const NH = 66;
  const GX = compact ? 12 : 34;
  const GY = 22;
  const PADY = 24;
  const TOPL = compact ? 30 : 0;
  const perRow = Math.max(1, Math.floor((W - LABEL - 24 + GX) / (NW + GX)));
  const layerOf = (id: string) => compById[id]?.layer;
  const layers = cfg.layers.filter((l) => nodes.some((n) => layerOf(n.id) === l.id));
  const byLayer: Record<string, ComponentFacts[]> = {};
  const idx: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  for (const l of layers) {
    byLayer[l.id] = nodes
      .filter((n) => layerOf(n.id) === l.id)
      .sort((a, b) => Number(a.delta === "unchanged") - Number(b.delta === "unchanged") || byCompRank(a.id, b.id));
  }
  for (const e of edges) {
    listAt(adj, e.from).push(e.to);
    listAt(adj, e.to).push(e.from);
  }
  const reindex = (l: { id: string }) => {
    const arr = byLayer[l.id] ?? [];
    arr.forEach((n, i) => {
      idx[n.id] = (i + 0.5) / arr.length;
    });
  };
  layers.forEach(reindex);
  // Barycenter sweeps (down, up, down, up): each lane is reordered by the mean position of its neighbors in other lanes.
  for (let it = 0; it < 4; it++) {
    for (const l of it % 2 ? [...layers].reverse() : layers) {
      const bc: Record<string, number> = {};
      for (const n of byLayer[l.id] ?? []) {
        const nb = (adj[n.id] ?? []).filter((x) => idx[x] !== undefined && layerOf(x) !== l.id);
        bc[n.id] = nb.length ? nb.reduce((a, x) => a + (idx[x] as number), 0) / nb.length : (idx[n.id] as number);
      }
      (byLayer[l.id] ?? []).sort((a, b) => (bc[a.id] as number) - (bc[b.id] as number) || byCompRank(a.id, b.id));
      reindex(l);
    }
  }
  const bands: ArchLayout["bands"] = [];
  const pos: Record<string, Box> = {};
  let y = 0;
  for (const layer of layers) {
    const inLayer = byLayer[layer.id] ?? [];
    const rows = Math.ceil(inLayer.length / perRow);
    const ids = inLayer.map((n) => n.id);
    const ARC = edges.some((e) => ids.includes(e.from) && ids.includes(e.to)) ? 40 : 0;
    const top = TOPL + ARC;
    const bh = rows * NH + (rows - 1) * GY + PADY * 2 + top;
    bands.push({ layer, y, h: bh, n: inLayer.length });
    inLayer.forEach((n, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const inRow = Math.min(perRow, inLayer.length - row * perRow);
      const rowW = inRow * NW + (inRow - 1) * GX;
      const x0 = LABEL + (W - LABEL - rowW) / 2;
      pos[n.id] = { x: x0 + col * (NW + GX), y: y + top + PADY + row * (NH + GY), w: NW, h: NH };
    });
    y += bh + 12;
  }
  return { W, H: Math.max(y - 12, 60), bands, pos, compact, GX };
}

function edgePaths(edges: DependencyFacts[], pos: Record<string, Box>, L: ArchLayout) {
  // Port allocation: spread attachment points along each node side, ordered by the other end's x.
  const ports: Record<string, { key: string; x: number }[]> = {};
  const addPort = (node: string, side: string, edgeKey: string, otherX: number) => {
    const k = `${node}|${side}`;
    listAt(ports, k).push({ key: edgeKey, x: otherX });
  };
  const geo = edges.map((e) => {
    const a = pos[e.from] as Box;
    const b = pos[e.to] as Box;
    const down = b.y > a.y + 1;
    const up = b.y + 1 < a.y;
    const g = { e, key: `${e.from}>${e.to}`, a, b, sa: "top", sb: "top" };
    if (down) [g.sa, g.sb] = ["bottom", "top"];
    else if (up) [g.sa, g.sb] = ["top", "bottom"];
    addPort(e.from, g.sa, g.key, b.x);
    addPort(e.to, g.sb, g.key, a.x);
    return g;
  });
  function portX(node: string, side: string, key: string): number {
    const list = [...(ports[`${node}|${side}`] ?? [])].sort((p, q) => p.x - q.x || (p.key < q.key ? -1 : 1));
    const i = list.findIndex((p) => p.key === key);
    const r = pos[node] as Box;
    return r.x + (r.w * (i + 1)) / (list.length + 1);
  }
  // Nodes lying between both ends block a direct curve; such edges detour through the gap beside them.
  function obstacles(g: (typeof geo)[number], x1: number, x2: number, yTop: number, yBot: number): Box[] {
    const lo = Math.min(x1, x2) - 8;
    const hi = Math.max(x1, x2) + 8;
    return Object.keys(pos)
      .filter((id) => {
        if (id === g.e.from || id === g.e.to) return false;
        const r = pos[id] as Box;
        return r.y < yBot && r.y + r.h > yTop && r.x < hi && r.x + r.w > lo;
      })
      .map((id) => pos[id] as Box);
  }
  const laneUse: Record<number, number> = {};
  return geo.map((g) => {
    const x1 = portX(g.e.from, g.sa, g.key);
    const x2 = portX(g.e.to, g.sb, g.key);
    const y1 = g.sa === "bottom" ? g.a.y + g.a.h : g.a.y;
    const y2 = g.sb === "top" ? g.b.y - 4 : g.b.y + g.b.h + 4;
    if (g.sa === "top" && g.sb === "top") {
      const lift = Math.min(34, 22 + Math.abs(x2 - x1) / 10);
      const d = `M${r1(x1)},${y1} C${r1(x1)},${r1(y1 - lift)} ${r1(x2)},${r1(y2 - lift)} ${r1(x2)},${y2}`;
      return { e: g.e, d, mx: (x1 + x2) / 2, my: Math.min(y1, y2) - lift * 0.75 };
    }
    const dir = y2 > y1 ? 1 : -1;
    let blockers = obstacles(g, x1, x2, Math.min(y1, y2), Math.max(y1, y2));
    if (!blockers.length) {
      const my = (y1 + y2) / 2;
      const d = `M${r1(x1)},${y1} C${r1(x1)},${r1(my)} ${r1(x2)},${r1(my)} ${r1(x2)},${y2}`;
      return { e: g.e, d, mx: (x1 + x2) / 2, my };
    }
    const gap = (L.GX || 20) / 2;
    const mid = (x1 + x2) / 2;
    const yTop = Math.min(y1, y2);
    const yBot = Math.max(y1, y2);
    let lane = 0;
    let right = 0;
    let left = 0;
    // Grow the blocker set until the chosen lane is clear of every node between both ends.
    for (let guard = 0; guard < 12; guard++) {
      right = Math.max(...blockers.map((r) => r.x + r.w)) + gap;
      left = Math.min(...blockers.map((r) => r.x)) - gap;
      lane = (Math.abs(right - mid) <= Math.abs(left - mid) && right < L.W - 4) || left < 4 ? right : left;
      const hit = obstacles(g, lane, lane, yTop, yBot).filter((r) => !blockers.includes(r));
      if (!hit.length) break;
      blockers = blockers.concat(hit);
    }
    const used = (laneUse[Math.round(lane)] ?? 0) + 1;
    laneUse[Math.round(lane)] = used;
    lane += (lane === right ? 1 : -1) * (used - 1) * 4;
    const ra = y1 + dir * 26;
    const rb = y2 - dir * 26;
    const d =
      `M${r1(x1)},${y1} C${r1(x1)},${y1 + dir * 18} ${r1(lane)},${y1 + dir * 8} ${r1(lane)},${ra}` +
      ` L${r1(lane)},${rb} C${r1(lane)},${y2 - dir * 8} ${r1(x2)},${y2 - dir * 18} ${r1(x2)},${y2}`;
    return { e: g.e, d, mx: lane, my: (y1 + y2) / 2 };
  });
}

type ArchMode = "delta" | "after" | "before";

function buildArchitecture(
  mode: ArchMode,
  compact: boolean,
  withContext: boolean,
  onNode?: (g: SVGElement, id: string) => void,
): View {
  const nodes = facts.components.filter(
    (n) =>
      !(mode === "before" && n.delta === "added") &&
      !(mode === "after" && n.delta === "removed") &&
      (withContext || !isContext(n)),
  );
  const vis = new Set(nodes.map((n) => n.id));
  const edges = facts.dependencies.filter((e) => {
    if (!vis.has(e.from) || !vis.has(e.to)) return false;
    if (mode === "before") return e.delta !== "added";
    if (mode === "after") return e.delta !== "removed";
    return true;
  });
  const L = layoutArch(nodes, edges, compact);
  const V = newView("architecture", L.W, L.H);
  const svg = V.svg;
  svg.classList.add(`mode-${mode}`);
  if (!nodes.length) {
    V.empty = T.archEmpty;
    return V;
  }
  markers(svg, "ar-", ["unchanged", "added", "changed", "removed", "violation", "key"]);
  for (const b of L.bands) {
    svg.appendChild(s("rect", { x: 0, y: b.y, width: L.W, height: b.h, rx: 14, class: "band" }));
    if (L.compact)
      svg.appendChild(s("text", { x: 14, y: b.y + 20, class: "band-label", text: trunc(b.layer.name, 40) }));
    else {
      svg.appendChild(s("text", { x: 18, y: b.y + b.h / 2 - 2, class: "band-label", text: trunc(b.layer.name, 18) }));
      svg.appendChild(
        s("text", {
          x: 18,
          y: b.y + b.h / 2 + 14,
          class: "band-sub",
          text: `${b.n} ${b.n === 1 ? T.component : T.kComponents}`,
        }),
      );
    }
  }
  const edgeLayer = s("g", { class: "edges" });
  const labelLayer = s("g", { class: "edge-labels" });
  // A label sits on its arrow's midpoint, or the nearest spot beside it that covers no box and no other label.
  const labels: Box[] = [];
  const freeSpot = (cx: number, cy: number, w: number, h: number): [number, number] => {
    const covers = (x: number, y: number) =>
      [...Object.values(L.pos), ...labels].some(
        (b) => x - w / 2 < b.x + b.w + 4 && x + w / 2 > b.x - 4 && y - h / 2 < b.y + b.h + 4 && y + h / 2 > b.y - 4,
      );
    for (const dy of [0, -14, 14, -28, 28, -42, 42, -56, 56]) {
      for (const dx of [0, -(w / 2 + 14), w / 2 + 14]) if (!covers(cx + dx, cy + dy)) return [cx + dx, cy + dy];
    }
    return [cx, cy];
  };
  edgePaths(edges, L.pos, L).forEach((p, i) => {
    const e = p.e;
    // A rule broken before this change is context: red only once the reader opens it.
    const k = isNewViolation(e) || (e.violation && withContext) ? "violation" : e.delta;
    const isKey = keyPairs[`${e.from}>${e.to}`] !== undefined;
    const tip =
      `${compName(e.from)} → ${compName(e.to)} · ${e.headCount || e.baseCount} ${T.refs}` +
      (e.examples[0] ? ` · ${e.examples[0]}` : "") +
      (e.violation ? ` · ⚠ ${e.violation.rule}` : "");
    const pid = `ep-${i}`;
    const g = s(
      "g",
      { class: `edge-g${isKey ? " key" : ""}`, "data-k": `e:${e.from}>${e.to}`, "data-a": e.from, "data-b": e.to },
      s("title", { text: tip }),
      s("path", { d: p.d, class: "edge-hit" }),
      isKey ? s("path", { d: p.d, class: "edge-glow" }) : null,
      s("path", {
        id: pid,
        d: p.d,
        class: `edge e-${k}${k === "violation" && e.violation?.preexisting ? " existing" : ""}`,
        "marker-end": `url(#ar-${isKey && k !== "violation" ? "key" : k})`,
      }),
    );
    if ((isKey || e.delta === "added") && e.delta !== "removed") {
      // A dot travels the dependency: the change's new paths and its key one read as live.
      g.appendChild(
        s(
          "circle",
          { r: isKey ? 4.5 : 3, class: `pulse${isKey ? " key" : ""}` },
          s(
            "animateMotion",
            { dur: isKey ? "2.2s" : "3s", repeatCount: "indefinite", begin: `-${r1((i % 5) * 0.4)}s` },
            s("mpath", { href: `#${pid}` }),
          ),
        ),
      );
    }
    edgeLayer.appendChild(g);
    const keyLabel = keyPairs[`${e.from}>${e.to}`];
    if (isKey && keyLabel) {
      const label = trunc(keyLabel, 40);
      const lw = Math.ceil(textWidth(label, "600 11.5px")) + 20;
      const [cx, cy] = freeSpot(p.mx, p.my, lw, 22);
      labels.push({ x: cx - lw / 2, y: cy - 11, w: lw, h: 22 });
      labelLayer.appendChild(
        s(
          "g",
          { class: "edge-label", "data-a": e.from, "data-b": e.to },
          s("rect", { x: r1(cx - lw / 2), y: r1(cy - 11), width: r1(lw), height: 22, rx: 11 }),
          s("text", { x: r1(cx), y: r1(cy + 4), "text-anchor": "middle", text: label }),
        ),
      );
    }
  });
  svg.appendChild(edgeLayer);
  for (const n of nodes) {
    const r = L.pos[n.id] as Box;
    const c = compById[n.id] as (typeof cfg.components)[number];
    V.geo[n.id] = r;
    const nreq = reqsOfComp(n.id).length;
    const neighbor = n.delta === "unchanged";
    const info = neighbor
      ? T.lNeighbor
      : `${n.files} ${n.files === 1 ? T.file : T.kFiles}${nreq ? ` · ◆ ${nreq}` : ""}`;
    const g = s(
      "g",
      {
        class: `node st-${n.delta}`,
        "data-k": n.id,
        tabindex: "0",
        role: "button",
        "aria-label": `${c.name}, ${deltaLabel(n.delta, true)}`,
      },
      s("title", { text: c.name + (summaryOf[n.id] ? `\n${summaryOf[n.id]}` : c.desc ? `\n${c.desc}` : "") }),
      s("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 12, class: "box" }),
      s("text", { x: r.x + 14, y: r.y + 19, class: "tag", text: neighbor ? "" : deltaLabel(n.delta).toUpperCase() }),
      neighbor
        ? null
        : s(
            "text",
            { x: r.x + r.w - 12, y: r.y + 19, "text-anchor": "end", class: "delta" },
            s("tspan", { class: "add", text: `+${n.additions}` }),
            s("tspan", { class: "del", text: ` −${n.deletions}` }),
          ),
      s("text", {
        x: r.x + 14,
        y: r.y + 39,
        class: "name",
        text: fit(c.name, compact ? "650 13px" : "650 14px", r.w - 28),
      }),
      s("text", { x: r.x + 14, y: r.y + 56, class: "info", text: info }),
    );
    onNode?.(g, n.id);
    svg.appendChild(g);
  }
  svg.appendChild(labelLayer);
  V.expand = (set) => {
    const keys = Object.keys(set);
    const only = keys[0];
    if (keys.length === 1 && only !== undefined && vis.has(only)) {
      for (const e of edges) {
        if (e.from === only) set[e.to] = true;
        if (e.to === only) set[e.from] = true;
      }
    }
    return set;
  };
  V.focusBoxKeys = (ids) => ids.filter((x) => vis.has(x));
  return V;
}

// ── Data flow: a sequence over real components, steps travel in order ──
function buildFlow(fl: NFlow): View {
  const parts: string[] = [];
  for (const x of fl.steps) for (const p of [x.from, x.to]) if (!parts.includes(p)) parts.push(p);
  parts.sort(byCompRank);
  const hasData = fl.steps.some((x) => x.data);
  const COL = 220;
  const HEAD = 58;
  const ROW = hasData ? 66 : 50;
  const TOP = 20;
  const W = Math.max(720, parts.length * COL + 40);
  const H = TOP + HEAD + 26 + fl.steps.length * ROW + 16;
  const V = newView(`flow:${fl.id}`, W, H);
  const svg = V.svg;
  const x: Record<string, number> = {};
  const offset = (W - parts.length * COL) / 2;
  parts.forEach((p, i) => {
    x[p] = offset + i * COL + COL / 2;
  });
  markers(svg, `sq-${fl.id}-`, ["unchanged", "added", "changed", "removed"]);
  for (const p of parts) {
    const c = compById[p];
    const delta = changeComp[p]?.delta ?? "unchanged";
    const px = x[p] as number;
    const box = { x: px - COL / 2 + 12, y: TOP, w: COL - 24, h: HEAD - 8 };
    V.geo[`p:${p}`] = box;
    svg.appendChild(
      s("line", {
        x1: px,
        y1: TOP + HEAD - 8,
        x2: px,
        y2: H - 8,
        class: "lifeline",
        "data-a": `p:${p}`,
        "data-b": `p:${p}`,
      }),
    );
    svg.appendChild(
      s(
        "g",
        { class: `head st-${delta}`, "data-k": `p:${p}` },
        s("rect", { x: box.x, y: box.y, width: box.w, height: box.h, rx: 11 }),
        s("text", { x: px, y: TOP + 21, "text-anchor": "middle", class: "name", text: trunc(c ? c.name : p, 21) }),
        s("text", { x: px, y: TOP + 37, "text-anchor": "middle", class: "layer", text: trunc(layerName(p), 24) }),
      ),
    );
  }
  const n = fl.steps.length;
  const per = 0.9;
  const total = n * per + 1.2;
  fl.steps.forEach((stp, i) => {
    const y = TOP + HEAD + 30 + i * ROW;
    const x1 = x[stp.from] as number;
    const x2 = x[stp.to] as number;
    const key = `#${i + 1}`;
    const g = s("g", {
      class: `msg st-${stp.delta}${stp.verified ? "" : " unverified"}`,
      "data-k": key,
      "data-from": `p:${stp.from}`,
      "data-to": `p:${stp.to}`,
    });
    if (!stp.verified) g.appendChild(s("title", { text: T.unverified }));
    else if (stp.via) g.appendChild(s("title", { text: tf("viaPort", { x: compName(stp.via) }) }));
    const marker = `url(#sq-${fl.id}-${stp.delta})`;
    const pid = `fm-${fl.id}-${i}`;
    g.appendChild(
      s("rect", {
        x: Math.min(x1, x2) - 14,
        y: y - 24,
        width: Math.max(Math.abs(x2 - x1), 60) + 28,
        height: 36,
        rx: 8,
        class: "msg-bg",
      }),
    );
    if (stp.from === stp.to) {
      g.appendChild(s("path", { id: pid, d: `M${x1},${y - 6} h38 v16 h-34`, class: "msg-line", "marker-end": marker }));
      g.appendChild(
        s(
          "text",
          { x: x1 + 46, y: y + 4, class: "msg-label", text: trunc(stp.call, 40) },
          s("title", { text: stp.call }),
        ),
      );
      V.geo[key] = { x: x1 - 10, y: y - 24, w: 220, h: 36 };
    } else {
      const dir = x2 > x1 ? 1 : -1;
      g.appendChild(
        s("path", {
          id: pid,
          d: `M${x1 + dir * 4},${y} L${x2 - dir * 6},${y}`,
          class: "msg-line",
          "marker-end": marker,
        }),
      );
      // The label fits between the 2 lifelines (about 6.5 px a character); the full call is its tooltip.
      const fits = Math.max(12, Math.floor(Math.abs(x2 - x1) / 6.5));
      g.appendChild(
        s(
          "text",
          {
            x: (x1 + x2) / 2,
            y: y - 8,
            "text-anchor": "middle",
            class: "msg-label",
            text: trunc(stp.call, fits) + (stp.verified ? "" : "  ?"),
          },
          s("title", { text: stp.call }),
        ),
      );
      if (stp.data) g.appendChild(dataChip(stp.data, (x1 + x2) / 2, y + 17));
      V.geo[key] = { x: Math.min(x1, x2), y: y - 24, w: Math.abs(x2 - x1), h: 36 };
    }
    const bx = x1 - (x2 >= x1 ? 1 : -1) * 16;
    g.appendChild(
      s(
        "g",
        { class: "step-badge" },
        s("circle", { cx: bx, cy: y, r: 9 }),
        s("text", { x: bx, y: y + 3.5, "text-anchor": "middle", text: String(i + 1) }),
      ),
    );
    if (stp.delta !== "removed") {
      // One dot per step, each starting when the previous one lands: the sequence plays in call order, then loops.
      const a = r1((i * per) / total);
      const b = r1((i * per + per * 0.8) / total);
      g.appendChild(
        s(
          "circle",
          { r: 4, class: "pulse", opacity: "0" },
          s(
            "animateMotion",
            {
              dur: `${r1(total)}s`,
              repeatCount: "indefinite",
              calcMode: "linear",
              keyPoints: "0;0;1;1",
              keyTimes: `0;${a};${b};1`,
            },
            s("mpath", { href: `#${pid}` }),
          ),
          s("animate", {
            attributeName: "opacity",
            dur: `${r1(total)}s`,
            repeatCount: "indefinite",
            calcMode: "discrete",
            values: "0;1;0",
            keyTimes: `0;${a};${b}`,
          }),
        ),
      );
    }
    svg.appendChild(g);
  });
  V.keyOf = (id) => (/^#\d+$/.test(id) ? id : `p:${id}`);
  V.expand = (set) => {
    const msgs = Object.keys(set).filter((k) => k.charAt(0) === "#");
    const heads = Object.keys(set).filter((k) => k.slice(0, 2) === "p:");
    fl.steps.forEach((stp, i) => {
      if (!msgs.length && (set[`p:${stp.from}`] || set[`p:${stp.to}`]) && heads.length) set[`#${i + 1}`] = true;
    });
    fl.steps.forEach((stp, i) => {
      if (set[`#${i + 1}`]) {
        set[`p:${stp.from}`] = true;
        set[`p:${stp.to}`] = true;
      }
    });
    return set;
  };
  return V;
}

/** The kind of change a field line describes: "+email" added, "-fax" removed, "~total" changed, "id" unchanged. */
function fieldDelta(f: string): Delta {
  const c = f.trim().charAt(0);
  return c === "+" ? "added" : c === "-" || c === "−" ? "removed" : c === "~" ? "changed" : "unchanged";
}
const fieldText = (f: string) => (/^[+\-−~]/.test(f.trim()) ? f.trim().slice(1).trim() : f.trim());
const FIELD_MARK: Record<Delta, string> = { added: "+", removed: "−", changed: "~", unchanged: "" };

// What travels on a step: "Order { +email ~total −fax }", colored per field change.
function dataChip(data: NonNullable<NStep["data"]>, cx: number, y: number): SVGElement {
  const fields = data.fields ?? [];
  let shown = fields.filter((f) => fieldDelta(f) !== "unchanged");
  if (!shown.length) shown = fields.slice(0, 3);
  const parts: { t: string; k: string }[] = [
    { t: data.type, k: "type" },
    ...(shown.length ? [{ t: " {", k: "p" }] : []),
    ...shown.slice(0, 4).map((f, i) => {
      const k = fieldDelta(f);
      return { t: (i ? "  " : " ") + FIELD_MARK[k] + (fieldText(f).split(":")[0] as string).trim(), k };
    }),
    ...(shown.length > 4 ? [{ t: " …", k: "p" }] : []),
    ...(shown.length ? [{ t: " }", k: "p" }] : []),
  ];
  const w = Math.ceil(textWidth(parts.map((p) => p.t).join(""), "11px", MONO)) + 20;
  const g = s(
    "g",
    { class: "data-chip" },
    s("title", { text: `${data.type}\n${fields.join("\n")}` }),
    s("rect", { x: r1(cx - w / 2), y: y - 13, width: r1(w), height: 20, rx: 6 }),
  );
  const text = s("text", { x: r1(cx), y: y + 1, "text-anchor": "middle" });
  for (const p of parts) text.appendChild(s("tspan", { class: `dk-${p.k}`, text: p.t }));
  g.appendChild(text);
  return g;
}

// ── Data: the entities the change touches (agent, with evidence) and the migrations in the diff (computed) ──
const DM = ex?.dataModel.entities.length ? ex.dataModel : null;
const entById: Record<string, Entity> = {};
if (DM) for (const e of DM.entities) entById[e.id] = e;

function buildData(onNode?: (g: SVGElement, key: string) => void): View {
  const dm = DM as NormalizedExplanation["dataModel"];
  const EW = 250;
  const GX = 90;
  const GY = 70;
  const PER = 3;
  const order: Record<Delta, number> = { added: 0, changed: 1, removed: 2, unchanged: 3 };
  const ents = [...dm.entities].sort(
    (a, b) =>
      order[a.delta] - order[b.delta] || byCompRank(a.component ?? "", b.component ?? "") || (a.name < b.name ? -1 : 1),
  );
  const migrations = facts.files.filter((f) => f.category === "migration");
  const top = migrations.length ? 34 + Math.min(migrations.length, 4) * 20 + 30 : 10;
  const heights = ents.map((e) => 52 + Math.max(1, (e.fields ?? []).length) * 19 + 10);
  const rows = Math.ceil(ents.length / PER);
  const rowH: number[] = [];
  for (let r = 0; r < rows; r++) rowH.push(Math.max(...heights.slice(r * PER, r * PER + PER)));
  const cols = Math.min(PER, ents.length);
  const W = Math.max(cols * EW + (cols - 1) * GX, 600);
  const pos: Record<string, Box> = {};
  let y = top;
  ents.forEach((e, i) => {
    const r = Math.floor(i / PER);
    const c = i % PER;
    const inRow = Math.min(PER, ents.length - r * PER);
    const x0 = (W - (inRow * EW + (inRow - 1) * GX)) / 2;
    const ry = top + rowH.slice(0, r).reduce((a, v) => a + v + GY, 0);
    pos[e.id] = { x: x0 + c * (EW + GX), y: ry, w: EW, h: heights[i] as number };
    y = Math.max(y, ry + (heights[i] as number));
  });
  const V = newView("data", W, y + 10);
  const svg = V.svg;
  if (migrations.length) {
    const mg = s(
      "g",
      { class: "migrations" },
      s("text", { x: 0, y: 14, class: "col-label", text: T.migrations.toUpperCase() }),
    );
    migrations.slice(0, 4).forEach((f, i) => {
      const letter = gitLetter(f);
      const text = s(
        "text",
        { x: 0, y: 38 + i * 20, class: "mig" },
        s("tspan", { class: `gs-${letter}`, text: `${letter}  ` }),
        s("tspan", { text: trunc(f.path, 90) }),
      );
      mg.appendChild(onOpen(text, f.path));
    });
    if (migrations.length > 4)
      mg.appendChild(s("text", { x: 0, y: 38 + 4 * 20, class: "info", text: `+${migrations.length - 4}` }));
    svg.appendChild(mg);
  }
  const links = s("g", { class: "links" });
  svg.appendChild(links);
  V.links = [];
  for (const rl of dm.relations) {
    const a = pos[rl.from];
    const b = pos[rl.to];
    if (!a || !b) continue;
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    let d: string;
    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    if (Math.abs(ay - by) < 10 || Math.abs(bx - ax) > Math.abs(by - ay)) {
      x1 = bx > ax ? a.x + a.w : a.x;
      x2 = bx > ax ? b.x : b.x + b.w;
      y1 = a.y + 26;
      y2 = b.y + 26;
      const mx = (x1 + x2) / 2;
      d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    } else {
      x1 = ax;
      x2 = bx;
      y1 = by > ay ? a.y + a.h : a.y;
      y2 = by > ay ? b.y : b.y + b.h;
      const my = (y1 + y2) / 2;
      d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
    }
    links.appendChild(
      s("path", { d, class: `rel rc-${rl.delta}`, "data-a": `ent:${rl.from}`, "data-b": `ent:${rl.to}` }),
    );
    if (rl.label) {
      const lx = (x1 + x2) / 2;
      const ly = (y1 + y2) / 2;
      const lw = Math.ceil(textWidth(rl.label, "11px", MONO)) + 16;
      links.appendChild(
        s(
          "g",
          { class: `rel-label rc-${rl.delta}`, "data-a": `ent:${rl.from}`, "data-b": `ent:${rl.to}` },
          s("rect", { x: r1(lx - lw / 2), y: r1(ly - 10), width: r1(lw), height: 20, rx: 10 }),
          s("text", { x: r1(lx), y: r1(ly + 4), "text-anchor": "middle", text: rl.label }),
        ),
      );
    }
    V.links.push([`ent:${rl.from}`, `ent:${rl.to}`]);
  }
  for (const e of ents) {
    const b = pos[e.id] as Box;
    const key = `ent:${e.id}`;
    V.geo[key] = b;
    const fields = e.fields ?? [];
    const g = s(
      "g",
      { class: `entity st-${e.delta}`, "data-k": key, tabindex: "0", role: "button" },
      s("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 12, class: "box" }),
      s("rect", { x: b.x, y: b.y, width: b.w, height: 40, rx: 12, class: "head" }),
      s("rect", { x: b.x, y: b.y + 28, width: b.w, height: 12, class: "head" }),
      s("text", { x: b.x + 14, y: b.y + 25, class: "name", text: trunc(e.name, 24) }),
      s("text", {
        x: b.x + b.w - 12,
        y: b.y + 25,
        "text-anchor": "end",
        class: "tag",
        text: e.delta === "unchanged" ? "" : deltaLabel(e.delta).toUpperCase(),
      }),
    );
    if (!fields.length) {
      g.appendChild(
        s("text", { x: b.x + 14, y: b.y + 62, class: "info", text: e.component ? compName(e.component) : "" }),
      );
    }
    fields.forEach((f, i) => {
      const k = fieldDelta(f);
      g.appendChild(
        s(
          "text",
          { x: b.x + 14, y: b.y + 62 + i * 19, class: `field f-${k}` },
          s("tspan", { class: "fmark", text: `${FIELD_MARK[k] || " "} ` }),
          s("tspan", { text: trunc(fieldText(f), 28) }),
        ),
      );
    });
    onNode?.(g, key);
    svg.appendChild(g);
  }
  V.keyOf = (id) => (id.slice(0, 4) === "ent:" ? id : `ent:${id}`);
  V.expand = (set) => {
    const add: Record<string, boolean> = {};
    if (Object.keys(set).length === 1) {
      for (const l of V.links ?? []) {
        if (set[l[0]]) add[l[1]] = true;
        if (set[l[1]]) add[l[0]] = true;
      }
    }
    Object.assign(set, add);
    return set;
  };
  return V;
}

function artifactState(c: SpecChange, kind: string): { cls: string; text: string } {
  const list = c.artifacts.filter((a) => a.kind === kind);
  if (!list.length) return { cls: "absent", text: T.sAbsent };
  const changed = list.filter((a) => a.delta !== "unchanged" || a.moved);
  if (!changed.length) return { cls: "present", text: T.sUnchanged };
  if (c.deleted) return { cls: "removed", text: T.sDeleted };
  return { cls: "changed", text: changed.some((a) => a.delta === "added" || a.moved) ? T.sAdded : T.sModified };
}
interface PipelineStep {
  id: string;
  title: string;
  state: { cls: string; text: string };
  progress?: [number, number] | null;
}
function pipelineSteps(c: SpecChange): PipelineStep[] {
  const touched = facts.components.filter((x) => x.delta !== "unchanged");
  const tk = c.tasks;
  const add = touched.reduce((a, x) => a + x.additions, 0);
  const del = touched.reduce((a, x) => a + x.deletions, 0);
  return [
    { id: "proposal", title: T.proposal, state: artifactState(c, "proposal") },
    { id: "spec", title: T.specs, state: artifactState(c, "spec") },
    { id: "design", title: T.designDoc, state: artifactState(c, "design") },
    { id: "tasks", title: T.tasks, state: artifactState(c, "tasks"), progress: tk ? [tk.done, tk.total] : null },
    {
      id: "code",
      title: T.code,
      state: touched.length ? { cls: "changed", text: `+${add} −${del}` } : { cls: "absent", text: "—" },
    },
    {
      id: "archive",
      title: T.archive,
      state: c.archived
        ? { cls: c.movedToArchive ? "changed" : "present", text: c.movedToArchive ? T.phaseArchiving : T.phaseArchived }
        : { cls: "absent", text: tk && tk.done < tk.total ? tf("openTasksN", { n: tk.total - tk.done }) : T.pending },
    },
  ];
}

// ═════════════════════════════ map + story ═════════════════════════════
interface ViewTab {
  id: string;
  title: string;
  flow?: NFlow;
}
const VIEWS: ViewTab[] = [{ id: "architecture", title: T.architecture }];
for (const fl of ex?.flows ?? []) VIEWS.push({ id: `flow:${fl.id}`, title: fl.title, flow: fl });
if (DM) VIEWS.push({ id: "data", title: T.dataView });
const flowById: Record<string, NFlow> = {};
for (const fl of ex?.flows ?? []) flowById[fl.id] = fl;
/** The name of a view, as its tab shows it. */
function viewTitle(view: string): string {
  if (view === "requirements") return T.reqs;
  return VIEWS.find((v) => v.id === view)?.title ?? T.architecture;
}

/** The story without an agent: the facts told in order, so the map still guides the reader. */
function autoStory(): StoryStep[] {
  const steps: StoryStep[] = [];
  const touched = facts.components.filter((c) => c.delta !== "unchanged");
  const layers = new Set(touched.map((c) => compById[c.id]?.layer));
  steps.push({
    heading: tf("autoOverviewH", { n: touched.length, m: layers.size }),
    body: tf("autoOverviewB", { f: st.files, a: fmt(st.additions), d: fmt(st.deletions) }),
    view: "architecture",
    focus: [],
  });
  for (const e of facts.dependencies.filter((e) => e.violation && !e.violation.preexisting).slice(0, 2)) {
    steps.push({
      heading: tf("autoViolH", { a: compName(e.from), b: compName(e.to) }),
      body: e.violation?.rule ?? "",
      view: "architecture",
      focus: [e.from, e.to],
      code: e.examples[0],
    });
  }
  for (const c of touched.filter((c) => c.delta === "added").slice(0, 2)) {
    steps.push({
      heading: tf("autoNewH", { x: compName(c.id) }),
      body: tf("autoNewB", { l: layerName(c.id) }),
      view: "architecture",
      focus: [c.id],
    });
  }
  for (const c of touched.filter((c) => c.delta === "removed").slice(0, 1)) {
    steps.push({
      heading: tf("autoRemovedH", { x: compName(c.id) }),
      body: T.autoRemovedB,
      view: "architecture",
      focus: [c.id],
    });
  }
  touched
    .filter((c) => c.delta === "changed")
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions) || byCompRank(a.id, b.id))
    .slice(0, Math.max(0, 5 - steps.length))
    .forEach((c) => {
      steps.push({
        heading: tf("autoChangedH", { x: compName(c.id) }),
        body: tf("autoChangedB", { n: c.files, a: c.additions, d: c.deletions }),
        view: "architecture",
        focus: [c.id],
      });
    });
  if (OS && REQS.length) {
    for (const c of OS.changes) {
      if (c.requirements.length) {
        steps.push({
          heading: tf("autoSpecH", { n: c.requirements.length, id: c.id }),
          body: c.why || T.autoSpecB,
          view: "requirements",
          focus: c.requirements.map((r) => r.id),
        });
      }
    }
  }
  return steps;
}
const STORY: StoryStep[] = ex?.story.length ? ex.story : autoStory();
const storyIsAuto = !ex?.story.length;

/**
 * Untouched components worth drawing by default: the change adds or removes their link to it, breaks a rule with
 * it, or makes it the key dependency; or the story or the requirements point at them. The rest is context, one
 * click away. A link that only gains or loses references (116 → 117) is no reason: in the surveyed reports it drew
 * 12 of 13 neighbors. Nor is a rule the code broke before this change.
 */
const MEANINGFUL = new Set<string>();
const isNewViolation = (e: DependencyFacts) => Boolean(e.violation && !e.violation.preexisting);
for (const e of facts.dependencies) {
  if (
    e.delta === "added" ||
    e.delta === "removed" ||
    isNewViolation(e) ||
    keyPairs[`${e.from}>${e.to}`] !== undefined
  ) {
    MEANINGFUL.add(e.from);
    MEANINGFUL.add(e.to);
  }
}
for (const step of STORY)
  if ((step.view ?? "architecture") === "architecture") for (const id of step.focus ?? []) MEANINGFUL.add(id);
for (const m of Object.values(specMap)) for (const id of m.components ?? []) MEANINGFUL.add(id);
const isContext = (c: ComponentFacts) => c.delta === "unchanged" && !MEANINGFUL.has(c.id);
const CONTEXT_COUNT = facts.components.filter(isContext).length;

const mapApi: {
  inspect?: (id: string) => void;
  focus?: (view: string, ids: string[]) => void;
  showFlow?: (fid: string) => void;
} = {};

function renderMap(): HTMLElement {
  const compactQ = window.matchMedia ? window.matchMedia("(max-width: 720px)") : { matches: false };
  let archMode: ArchMode = store<ArchMode>("ec:arch-mode") ?? "delta";
  let motion = store<boolean>("ec:motion");
  if (motion === null) motion = !REDUCED;
  let current: View | null = null;
  let withContext = false;
  let stepIdx = 0;
  let inspecting: string | null = null;
  const cache: Record<string, View> = {};

  const viewport = h("div", { class: "viewport", tabindex: "0", "aria-label": T.canvas });
  const tabs = h("div", { class: "view-tabs", role: "tablist" });
  const seg = h("div", { class: "seg arch-only" });
  for (const m of ["delta", "after", "before"] as ArchMode[]) {
    seg.appendChild(
      h("button", {
        class: m === archMode ? "on" : "",
        "data-m": m,
        text: t(m),
        title: t(`mode${cap(m)}`),
        onclick: () => {
          archMode = m;
          store("ec:arch-mode", m);
          for (const b of Array.from(seg.children)) b.classList.toggle("on", b.getAttribute("data-m") === m);
          if (current && current.id === "architecture") show("architecture", lastFocus, false);
        },
      }),
    );
  }
  const motionBtn = h("button", {
    class: "icon-btn",
    title: T.motion,
    "aria-pressed": String(motion),
    onclick: () => setMotion(!motion),
  });
  // The bar holds what the diagram shows (the view, and before/after for the architecture); the zoom controls float
  // over the canvas, out of the way until needed.
  const contextBtn = CONTEXT_COUNT
    ? h("button", {
        class: "chip context-toggle",
        "aria-pressed": "false",
        title: T.contextHint,
        text: `${T.context} · ${CONTEXT_COUNT}`,
        onclick: () => setContext(!withContext),
      })
    : null;
  function setContext(on: boolean) {
    withContext = on;
    contextBtn?.classList.toggle("on", on);
    contextBtn?.setAttribute("aria-pressed", String(on));
    if (current && current.id === "architecture") show("architecture", lastFocus, false);
  }
  const archTools = h("div", { class: "arch-tools" }, contextBtn, seg);
  const tools = h("div", { class: "canvas-tools" }, archTools);
  const zoomTools = h(
    "div",
    { class: "zoom-tools" },
    h("button", { class: "icon-btn", title: T.zoomOut, text: "−", onclick: () => zoom(1.25) }),
    h("button", { class: "icon-btn wide", title: T.fit, text: T.fit, onclick: () => current && fly(fullBox(), true) }),
    h("button", { class: "icon-btn", title: T.zoomIn, text: "+", onclick: () => zoom(0.8) }),
    motionBtn,
  );
  // One tab per view: architecture │ flows │ data. A title is never cut while it fits; when the bar runs out of room
  // it ends in "…" and the tooltip shows it whole.
  let lastKind: string | null = null;
  for (const v of VIEWS) {
    const kind = v.flow ? "flow" : v.id;
    if (lastKind && kind !== lastKind) tabs.appendChild(h("span", { class: "view-sep", "aria-hidden": "true" }));
    lastKind = kind;
    const label = h("span", { class: "view-label", text: v.title });
    tabs.appendChild(
      h(
        "button",
        {
          role: "tab",
          class: `view-tab${v.flow ? " flow" : ""}`,
          "data-view": v.id,
          "aria-label": v.title,
          onmouseenter(this: HTMLElement) {
            const tip = (label.scrollWidth > label.clientWidth ? [v.title] : []).concat(
              v.flow?.trigger ? [v.flow.trigger] : [],
            );
            if (tip.length) this.title = tip.join("\n");
            else this.removeAttribute("title");
          },
          onclick: () => {
            closeInspector();
            show(v.id, [], true);
          },
        },
        label,
      ),
    );
  }
  const caption = h("div", { class: "view-caption" });
  const legend = h("div", { class: "diagram-legend" });

  // ── camera ──
  let vb: Box | null = null;
  let anim = 0;
  const ratio = () => (viewport.clientWidth || 1000) / (viewport.clientHeight || 560);
  function apply(v: Box) {
    vb = v;
    current?.svg.setAttribute("viewBox", [v.x, v.y, v.w, v.h].map(r1).join(" "));
  }
  function frame(box: Box, pad = 28, minW?: number): Box {
    let x = box.x - pad;
    let y = box.y - pad;
    let w = box.w + 2 * pad;
    let hh = box.h + 2 * pad;
    if (minW && w < minW) {
      x -= (minW - w) / 2;
      w = minW;
    }
    const r = ratio();
    if (w / hh > r) {
      const nh = w / r;
      y -= (nh - hh) / 2;
      hh = nh;
    } else {
      const nw = hh * r;
      x -= (nw - w) / 2;
      w = nw;
    }
    return { x, y, w, h: hh };
  }
  const fullBox = () => frame({ x: 0, y: 0, w: (current as View).W, h: (current as View).H }, 16);
  function fly(target: Box, animate: boolean) {
    cancelAnimationFrame(anim);
    if (!animate || !vb || REDUCED) return apply(target);
    const from: Box = vb;
    let t0 = 0;
    const D = 560;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / D);
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      apply({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      });
      if (p < 1) anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  }
  function zoom(f: number, cx?: number, cy?: number) {
    if (!vb || !current) return;
    const w = Math.max(160, Math.min(vb.w * f, Math.max(current.W, current.H) * 3));
    const k = w / vb.w;
    const x0 = cx ?? vb.x + vb.w / 2;
    const y0 = cy ?? vb.y + vb.h / 2;
    fly({ x: x0 - (x0 - vb.x) * k, y: y0 - (y0 - vb.y) * k, w, h: vb.h * k }, false);
  }
  let drag: { x: number; y: number; vb: Box } | null = null;
  let dragged = false;
  viewport.addEventListener("pointerdown", (ev: PointerEvent) => {
    if (ev.button !== 0 || !vb) return;
    drag = { x: ev.clientX, y: ev.clientY, vb };
    dragged = false;
  });
  viewport.addEventListener("pointermove", (ev: PointerEvent) => {
    if (!drag || !vb) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!dragged) {
      dragged = true;
      try {
        viewport.setPointerCapture(ev.pointerId);
      } catch {
        // not capturable: panning still works while the pointer stays inside
      }
      viewport.classList.add("grabbing");
    }
    const k = drag.vb.w / (viewport.clientWidth || 1);
    apply({ x: drag.vb.x - dx * k, y: drag.vb.y - dy * k, w: drag.vb.w, h: drag.vb.h });
  });
  const endDrag = () => {
    drag = null;
    viewport.classList.remove("grabbing");
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  viewport.addEventListener(
    "click",
    (ev) => {
      if (dragged) {
        ev.stopPropagation();
        ev.preventDefault();
        dragged = false;
      }
    },
    true,
  );
  viewport.addEventListener(
    "wheel",
    (ev: WheelEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || !vb) return;
      ev.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cx = vb.x + ((ev.clientX - rect.left) / rect.width) * vb.w;
      const cy = vb.y + ((ev.clientY - rect.top) / rect.height) * vb.h;
      zoom(ev.deltaY > 0 ? 1.12 : 0.89, cx, cy);
    },
    { passive: false },
  );

  // ── lighting ──
  let lastFocus: string[] = [];
  function light(ids: string[]): string[] {
    const view = current as View;
    let set: Record<string, boolean> = {};
    for (const id of ids) {
      const k = view.keyOf(id);
      if (k) set[k] = true;
    }
    const focused = Object.keys(set).length > 0;
    if (focused) set = view.expand(set);
    view.svg.classList.toggle("dim", focused);
    for (const el of Array.from(view.svg.querySelectorAll("[data-k]"))) {
      const k = el.getAttribute("data-k") as string;
      if (k.slice(0, 2) === "e:") continue;
      el.classList.toggle("on", Boolean(set[k]));
    }
    for (const el of Array.from(view.svg.querySelectorAll("[data-a]"))) {
      const a = el.getAttribute("data-a") as string;
      const b = el.getAttribute("data-b") as string;
      if (el.classList.contains("lifeline")) {
        el.classList.toggle("on", Boolean(set[a]));
        continue;
      }
      const ka = view.keyOf(a) || a;
      const kb = view.keyOf(b) || b;
      el.classList.toggle("on", Boolean((set[a] || set[ka]) && (set[b] || set[kb])));
    }
    return Object.keys(set);
  }
  function boxOf(keys: string[]): Box | null {
    const bs = keys.map((k) => current?.geo[k]).filter((b): b is Box => Boolean(b));
    if (!bs.length) return null;
    const x1 = Math.min(...bs.map((b) => b.x));
    const y1 = Math.min(...bs.map((b) => b.y));
    const x2 = Math.max(...bs.map((b) => b.x + b.w));
    const y2 = Math.max(...bs.map((b) => b.y + b.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  // ── views ──
  function viewFor(id: string): View {
    const compact = compactQ.matches;
    const key = `${id}|${compact}|${id === "architecture" ? `${archMode}|${withContext}` : ""}`;
    const hit = cache[key];
    if (hit) return hit;
    let V: View;
    if (id === "architecture") V = buildArchitecture(archMode, compact, withContext, wireNode);
    else if (id === "data") V = buildData(wireNode);
    else V = buildFlow(flowById[id.slice(5)] as NFlow);
    cache[key] = V;
    return V;
  }
  function wireNode(g: SVGElement, id: string) {
    g.addEventListener("mouseenter", () => {
      if (!inspecting) light([id]);
    });
    g.addEventListener("mouseleave", () => {
      if (!inspecting) light(lastFocus);
    });
    g.addEventListener("click", () => inspect(id));
    g.addEventListener("keydown", (ev) => {
      const key = (ev as KeyboardEvent).key;
      if (key === "Enter" || key === " ") {
        ev.preventDefault();
        inspect(id);
      }
    });
  }
  function show(viewId: string, focusIds: string[], animate: boolean) {
    // Requirements have no diagram of their own: a requirement lights the components that implement it.
    let id = viewId;
    let focus = focusIds;
    if (id === "requirements") {
      focus = specComponents(focus || []);
      id = "architecture";
    }
    const prev = current;
    current = viewFor(id);
    if (prev !== current) {
      viewport.textContent = "";
      if (current.empty) viewport.appendChild(h("p", { class: "empty canvas-empty", text: current.empty }));
      viewport.appendChild(current.svg);
      if (!motion) {
        try {
          (current.svg as SVGSVGElement).pauseAnimations();
        } catch {
          // no SMIL: nothing to pause
        }
      }
      apply(prev && prev.id === current.id && vb ? vb : fullBox());
    }
    for (const b of Array.from(tabs.querySelectorAll(".view-tab"))) {
      const on = b.getAttribute("data-view") === id;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
    archTools.style.display = id === "architecture" ? "" : "none";
    lastFocus = focus || [];
    const keys = light(lastFocus);
    // Narrow screens frame only what the step names; wide ones also keep what lights up with it in view.
    const view = current;
    const primary = lastFocus.map((x) => view.keyOf(x));
    const box = keys.length ? (compactQ.matches && boxOf(primary)) || boxOf(keys) : null;
    // Never zoom past ~1.4× of the fitted view: the reader keeps the lanes around the focus in sight.
    fly(
      box ? frame(box, 64, Math.min(view.W, compactQ.matches ? 340 : Math.max(760, view.W * 0.62))) : fullBox(),
      animate,
    );
    renderCaption(id);
  }
  function renderCaption(id: string) {
    caption.textContent = "";
    legend.textContent = "";
    // Only what the current diagram draws, grouped by what it is (boxes, arrows):
    // [kind, color, label, selector of an element that uses it, group].
    const keys: Record<string, [string, string, string, string, string?][]> = {
      architecture: [
        ["swatch", "var(--added)", T.lAdded, ".node.st-added", T.lgComponents],
        ["swatch", "var(--changed)", T.lChanged, ".node.st-changed"],
        ["swatch", "var(--removed)", T.lRemoved, ".node.st-removed"],
        ["swatch", "var(--unchanged)", T.lNeighbor, ".node.st-unchanged"],
        ["line dashed", "var(--added)", T.lAdded, ".edge.e-added", T.lgDependencies],
        ["line", "var(--changed)", T.lMoreRefs, ".edge.e-changed"],
        ["line", "var(--unchanged)", T.lUnchanged, ".edge.e-unchanged"],
        ["line dashed", "var(--removed)", T.lRemoved, ".edge.e-removed"],
        ["line", "var(--violation)", T.lViolation, ".edge.e-violation"],
        ["line", "var(--accent)", T.lKey, ".edge-g.key"],
      ],
      flow: [
        ["line", "var(--added)", T.lAdded, ".msg.st-added", T.lgSteps],
        ["line", "var(--changed)", T.lChanged, ".msg.st-changed"],
        ["line", "var(--muted)", T.lUnchanged, ".msg.st-unchanged"],
        ["line dashed", "var(--removed)", T.lRemoved, ".msg.st-removed"],
      ],
      data: [
        ["swatch", "var(--added)", T.lAdded, ".entity.st-added", T.lgEntities],
        ["swatch", "var(--changed)", T.lChanged, ".entity.st-changed"],
        ["swatch", "var(--removed)", T.lRemoved, ".entity.st-removed"],
        ["swatch", "var(--unchanged)", T.lUnchanged, ".entity.st-unchanged"],
      ],
    };
    const list = keys[id.slice(0, 5) === "flow:" ? "flow" : id] ?? [];
    let group: HTMLElement | null = null;
    let label = "";
    for (const k of list) {
      if (k[4]) label = k[4];
      if (!current?.svg.querySelector(k[3])) continue;
      if (!group || group.getAttribute("data-group") !== label) {
        group = h("span", { class: "legend-group", "data-group": label }, h("b", { text: label }));
        legend.appendChild(group);
      }
      group.appendChild(legendItem(k[0], k[1], k[2]));
    }
    if (id === "architecture") {
      const foot: string[] = [];
      if (st.unresolved) foot.push(`${st.unresolved} ${st.unresolved === 1 ? T.unresolved1 : T.unresolved}`);
      if (st.unmapped.length) foot.push(`${st.unmapped.length} ${st.unmapped.length === 1 ? T.unmapped1 : T.unmapped}`);
      if (foot.length) caption.appendChild(h("span", { class: "faint", text: foot.join(" · ") }));
    } else if (id.slice(0, 5) === "flow:") {
      for (const n of flowNotes(flowById[id.slice(5)] as NFlow)) caption.appendChild(n);
    }
  }

  // ── story panel ──
  const storyList = h("ol", { class: "story-steps" });
  const counter = h("span", { class: "story-count" });
  const storyPane = h(
    "div",
    { class: "story-pane" },
    h(
      "div",
      { class: "story-head" },
      h("b", { text: T.story }),
      counter,
      h(
        "div",
        { class: "story-nav" },
        h("button", { class: "icon-btn", title: T.prev, text: "←", onclick: () => step(stepIdx - 1) }),
        h("button", { class: "icon-btn", title: T.next, text: "→", onclick: () => step(stepIdx + 1) }),
      ),
    ),
    storyIsAuto ? h("p", { class: "story-auto faint", text: T.storyAuto }) : null,
    storyList,
  );
  const inspector = h("div", { class: "inspector", hidden: true });
  const side = h("aside", { class: "map-side" }, storyPane, inspector);
  const items = STORY.map((stp, i) => {
    const li = h(
      "li",
      { class: "story-step", tabindex: "0" },
      h(
        "button",
        { class: "step-head", onclick: () => step(i) },
        h("span", { class: "step-n", text: String(i + 1) }),
        h("span", { class: "step-h", text: stp.heading }),
      ),
      h(
        "div",
        { class: "step-body" },
        h("p", { text: stp.body }),
        h(
          "div",
          { class: "step-meta" },
          h("span", { class: "step-view", text: viewTitle(stp.view ?? "architecture") }),
          stp.view === "requirements"
            ? h("button", {
                class: "chip step-link",
                text: `${T.seeReqs} ↓`,
                onclick: () => sddApi.open((stp.focus ?? []).filter((x) => reqById[x])),
              })
            : null,
          h("button", {
            class: "chip step-next",
            text: i < STORY.length - 1 ? `${T.nextStep} →` : `↺ ${T.restart}`,
            onclick: () => step(i < STORY.length - 1 ? i + 1 : 0),
          }),
        ),
      ),
    );
    storyList.appendChild(li);
    return li;
  });
  /** A step the reader asked for: the workspace comes into view when it is not whole on screen. */
  function step(i: number) {
    go(i);
    const r = root.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight)
      root.scrollIntoView({ block: "start", behavior: REDUCED ? "auto" : "smooth" });
  }
  function go(i: number) {
    if (!STORY.length) return show("architecture", [], false);
    stepIdx = Math.max(0, Math.min(STORY.length - 1, i));
    closeInspector();
    const stp = STORY[stepIdx] as StoryStep;
    items.forEach((li, j) => {
      li.classList.toggle("active", j === stepIdx);
      li.classList.toggle("seen", j < stepIdx);
    });
    counter.textContent = `${stepIdx + 1} / ${STORY.length}`;
    showCode(stp.code);
    show(stp.view ?? "architecture", stp.focus ?? [], true);
    const li = items[stepIdx];
    if (li && storyList.scrollHeight > storyList.clientHeight) {
      storyList.scrollTo({ top: li.offsetTop - storyList.offsetTop - 8, behavior: REDUCED ? "auto" : "smooth" });
    }
  }

  // ── code of the active step, under the map in the same column: map, story and code fit one screen ──
  const codePane = h("div", { class: "map-code", hidden: true });
  function showCode(ref?: string | null) {
    codePane.textContent = "";
    const ex2 = ref ? codeExcerpt(ref) : null;
    if (ex2) codePane.appendChild(ex2);
    codePane.hidden = codeSplit.hidden = !ex2 || Boolean(inspecting);
  }
  const MIN_CODE = 96;
  /** The code takes at most 60% of the column: the map always keeps the larger part. */
  const maxCode = () => Math.round((mainCol.clientHeight || window.innerHeight) * 0.6);
  const clampCode = (px: number) => Math.round(Math.max(MIN_CODE, Math.min(maxCode(), px)));
  // Set by the reader, the code area is exactly that tall; by default it fits the excerpt, up to a third of the window.
  function setCodeHeight(px: number | null, save: boolean) {
    codePane.classList.toggle("sized", px !== null);
    if (px === null) codePane.style.removeProperty("--code-h");
    else codePane.style.setProperty("--code-h", `${clampCode(px)}px`);
    if (save) store("ec:code-h", px === null ? null : clampCode(px));
  }
  // A drag handle above the code: drag or arrow keys change its height, double-click or Home restores the default.
  function splitter(getH: () => number, setH: (px: number | null, save: boolean) => void): HTMLElement {
    const el = h(
      "div",
      {
        class: "splitter",
        role: "separator",
        tabindex: "0",
        "aria-orientation": "horizontal",
        "aria-label": T.resize,
        title: T.resize,
      },
      h("span", { class: "grip" }),
    );
    let start: { y: number; h: number } | null = null;
    el.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button) return;
      ev.preventDefault();
      start = { y: ev.clientY, h: getH() };
      el.classList.add("dragging");
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        // not capturable: dragging still works while the pointer stays on the handle
      }
    });
    // The handle sits above the code: dragging it down makes the code shorter.
    el.addEventListener("pointermove", (ev: PointerEvent) => {
      if (start) setH(start.h - (ev.clientY - start.y), false);
    });
    const end = () => {
      if (start) {
        start = null;
        el.classList.remove("dragging");
        setH(getH(), true);
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("dblclick", () => setH(null, true));
    el.addEventListener("keydown", (ev: KeyboardEvent) => {
      const d = ({ ArrowUp: 40, ArrowDown: -40, PageUp: 160, PageDown: -160 } as Record<string, number>)[ev.key];
      if (ev.key === "Home") {
        ev.preventDefault();
        setH(null, true);
      } else if (d) {
        ev.preventDefault();
        ev.stopPropagation();
        setH(getH() + d, true);
      }
    });
    return el;
  }
  const codeSplit = splitter(() => codePane.offsetHeight, setCodeHeight);
  codeSplit.hidden = true;

  // ── inspector ──
  function inspect(key: string) {
    if (key.slice(0, 4) === "req:") return sddApi.open([key.slice(4)]);
    if (key.slice(0, 4) === "ent:") return inspectEntity(key.slice(4));
    const id = key.replace(/^comp:/, "");
    const hidden = changeComp[id];
    if (hidden && isContext(hidden) && !withContext) setContext(true);
    inspecting = id;
    const c = compById[id];
    const n = changeComp[id] ?? { id, delta: "unchanged" as Delta, files: 0, additions: 0, deletions: 0 };
    const files = facts.files.filter((f) => f.component === id);
    const syms = facts.symbols.filter((sy) => files.some((f) => f.path === sy.file));
    const outE = facts.dependencies.filter((e) => e.from === id);
    const inE = facts.dependencies.filter((e) => e.to === id);
    const reqs = reqsOfComp(id);
    inspector.textContent = "";
    append(inspector, [
      h("button", { class: "back", text: `← ${T.back}`, onclick: () => go(stepIdx) }),
      h(
        "div",
        { class: "insp-title" },
        h("span", { class: `badge ${n.delta}`, text: deltaLabel(n.delta, true) }),
        h("h3", { text: c ? c.name : id }),
      ),
      h("div", {
        class: "faint",
        text:
          layerName(id) +
          (n.delta !== "unchanged"
            ? ` · ${n.files} ${n.files === 1 ? T.file : T.kFiles} · +${n.additions} −${n.deletions}`
            : ""),
      }),
      summaryOf[id]
        ? h("p", { class: "insp-summary", text: summaryOf[id] })
        : c?.desc
          ? h("p", { class: "insp-summary muted", text: c.desc })
          : null,
      files.length
        ? inspList(
            T.files,
            files.map((f) =>
              h(
                "div",
                { class: "insp-row" },
                h("span", { class: `gs gs-${gitLetter(f)}`, text: gitLetter(f) }),
                fileLink(f.path, f.path.split("/").pop()),
                h(
                  "span",
                  { class: "nums" },
                  h("span", { class: "add", text: `+${f.additions}` }),
                  " ",
                  h("span", { class: "del", text: `−${f.deletions}` }),
                ),
              ),
            ),
          )
        : null,
      syms.length
        ? inspList(
            T.symbols,
            syms.slice(0, 12).map((sy) =>
              h(
                "div",
                { class: "insp-row" },
                h("span", {
                  class: `badge ${sy.delta}`,
                  text: sy.delta === "added" ? "+" : sy.delta === "removed" ? "−" : "~",
                }),
                fileLink(`${sy.file}:${sy.line}`, sy.name),
              ),
            ),
          )
        : null,
      outE.length ? inspList(T.dependsOn, outE.map(edgeRow((e) => e.to))) : null,
      inE.length ? inspList(T.usedBy, inE.map(edgeRow((e) => e.from))) : null,
      reqs.length ? inspList(T.reqs, reqs.map(reqRow)) : null,
    ]);
    storyPane.hidden = true;
    codePane.hidden = codeSplit.hidden = true;
    inspector.hidden = false;
    let viewId = current?.id ?? "architecture";
    if (viewId.slice(0, 5) === "flow:" && !current?.geo[`p:${id}`]) viewId = "architecture";
    show(viewId, [id], true);
    inspecting = id;
  }
  function inspectEntity(eid: string) {
    const e = entById[eid] as Entity;
    const dm = DM as NormalizedExplanation["dataModel"];
    const rels = dm.relations.filter((r) => r.from === eid || r.to === eid);
    const fields = e.fields ?? [];
    inspector.textContent = "";
    append(inspector, [
      h("button", { class: "back", text: `← ${T.back}`, onclick: () => go(stepIdx) }),
      h(
        "div",
        { class: "insp-title" },
        h("span", { class: `badge ${e.delta}`, text: deltaLabel(e.delta) }),
        h("h3", { text: e.name }),
      ),
      e.component
        ? h(
            "div",
            null,
            h("a", {
              href: "#",
              class: "faint",
              text: compName(e.component),
              onclick: (ev: Event) => {
                ev.preventDefault();
                inspect(e.component as string);
              },
            }),
          )
        : null,
      fields.length
        ? inspList(
            T.fields,
            fields.map((f) => {
              const k = fieldDelta(f);
              return h(
                "div",
                { class: `insp-row field-row f-${k}` },
                h("span", { class: "fmark", text: FIELD_MARK[k] || "·" }),
                h("code", { text: fieldText(f) }),
              );
            }),
          )
        : null,
      rels.length
        ? inspList(
            T.relations,
            rels.map((r) => {
              const other = r.from === eid ? r.to : r.from;
              return h(
                "div",
                { class: "insp-row" },
                h("span", { class: `badge ${r.delta}`, text: r.label || "—" }),
                h("a", {
                  href: "#",
                  text: entById[other]?.name ?? other,
                  onclick: (ev: Event) => {
                    ev.preventDefault();
                    inspectEntity(other);
                  },
                }),
              );
            }),
          )
        : null,
      e.evidence ? h("div", { class: "insp-list" }, h("h4", { text: T.evidence }), codeExcerpt(e.evidence)) : null,
    ]);
    storyPane.hidden = true;
    codePane.hidden = codeSplit.hidden = true;
    inspector.hidden = false;
    show("data", [eid], true);
    inspecting = eid;
  }
  function closeInspector() {
    inspecting = null;
    inspector.hidden = true;
    storyPane.hidden = false;
    codePane.hidden = codeSplit.hidden = !codePane.firstChild;
  }
  function edgeRow(other: (e: DependencyFacts) => string) {
    return (e: DependencyFacts) => {
      const k = isNewViolation(e) ? "violation" : e.delta;
      const mark: Record<string, string> = { added: "+", removed: "−", changed: "~", unchanged: "=", violation: "!" };
      return h(
        "div",
        { class: "insp-row" },
        h("span", { class: `badge ${k}`, text: mark[k] }),
        h("a", {
          href: "#",
          text: compName(other(e)),
          onclick: (ev: Event) => {
            ev.preventDefault();
            inspect(other(e));
          },
        }),
        e.examples[0] ? fileLink(e.examples[0], e.examples[0].split("/").pop()) : null,
      );
    };
  }

  function setMotion(on: boolean) {
    motion = on;
    store("ec:motion", on);
    root.classList.toggle("still", !on);
    motionBtn.textContent = on ? "❚❚" : "▶";
    motionBtn.setAttribute("aria-pressed", String(on));
    for (const k of Object.keys(cache)) {
      try {
        const svg = (cache[k] as View).svg as SVGSVGElement;
        if (on) svg.unpauseAnimations();
        else svg.pauseAnimations();
      } catch {
        // no SMIL: nothing to pause
      }
    }
  }

  // The workspace: the map and the step's code on the left, the story on the right, as tall as the window.
  const mainCol = h(
    "div",
    { class: "map-main" },
    h(
      "div",
      { class: "map-canvas" },
      h("div", { class: "view-wrap" }, viewport, zoomTools),
      h("div", { class: "map-foot" }, legend, caption, h("span", { class: "hint faint", text: T.canvasHint })),
    ),
    codeSplit,
    codePane,
  );
  const root = h(
    "section",
    { class: "map", id: "map" },
    h("div", { class: "map-bar" }, tabs, tools),
    h("div", { class: "map-body" }, mainCol, side),
  );
  setMotion(motion);
  const savedCode = store<number>("ec:code-h");
  if (savedCode) setCodeHeight(savedCode, false);

  document.addEventListener("keydown", (ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target && /input|textarea|select/i.test(target.tagName ?? "")) return;
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      const r = root.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      ev.preventDefault();
      step(stepIdx + (ev.key === "ArrowRight" ? 1 : -1));
    } else if (ev.key === "Escape" && inspecting) go(stepIdx);
  });
  function relayout() {
    if (!current) return;
    const want = viewFor(current.id);
    if (want !== current) {
      current = null;
      return go(stepIdx);
    }
    apply(vb ? frame(vb, 0) : fullBox());
  }
  if ("ResizeObserver" in window) {
    let last = { w: 0, h: 0 };
    new ResizeObserver(() => {
      const w = viewport.clientWidth;
      const hh = viewport.clientHeight;
      // Same zoom, more or less of the view around the center: resizing never rescales the diagram.
      if (current && vb && last.w && last.h && w && hh) {
        const nw = (vb.w * w) / last.w;
        const nh = (vb.h * hh) / last.h;
        apply({ x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - nh) / 2, w: nw, h: nh });
      }
      last = { w, h: hh };
    }).observe(viewport);
  }
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 120) as unknown as number;
  });
  document.addEventListener("ec:mounted", () => {
    current = null;
    go(0);
  });
  mapApi.inspect = (id) => {
    root.scrollIntoView({ block: "start" });
    inspect(id);
  };
  mapApi.focus = (view, ids) => {
    root.scrollIntoView({ block: "start" });
    closeInspector();
    show(view, ids, true);
  };
  mapApi.showFlow = (fid) => {
    root.scrollIntoView({ block: "start" });
    closeInspector();
    show(`flow:${fid}`, [], true);
  };
  return root;
}

function codeExcerpt(ref: string): HTMLElement | null {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(ref || "");
  if (!m || fileIndex[m[1] as string] === undefined) return null;
  const f = facts.files[fileIndex[m[1] as string] as number] as FileFacts;
  const lines = m[3] ? `${m[2]}-${m[3]}` : (m[2] as string);
  return h(
    "div",
    { class: "step-code" },
    h("div", { class: "step-code-head" }, fileLink(ref, `${(m[1] as string).split("/").slice(-2).join("/")}:${lines}`)),
    h("div", { class: "excerpt diff-wrap" }, excerpt(f, lines, 1)),
  );
}

function flowNotes(fl: NFlow): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (fl.trigger)
    out.push(h("span", { class: "flow-trigger" }, h("b", { text: `${T.startsAt} ` }), h("code", { text: fl.trigger })));
  const ref = cfg.referenceFlows.find((f) => f.id === fl.id);
  if (fl.scenario) {
    const [rid, sid] = fl.scenario.split("#");
    const r = reqById[rid as string];
    const sc = r?.scenarios.find((x) => x.id === sid);
    if (r && sc) out.push(scenarioStrip(r, sc, true));
  }
  if (ref) {
    const diff = (a: { from: string; to: string }[], b: { from: string; to: string }[]) => {
      const pool = b.map((x) => `${x.from}>${x.to}`);
      return a.filter((x) => {
        const i = pool.indexOf(`${x.from}>${x.to}`);
        if (i < 0) return true;
        pool.splice(i, 1);
        return false;
      });
    };
    const extra = diff(fl.steps, ref.steps);
    const missing = diff(ref.steps, fl.steps) as typeof ref.steps;
    out.push(
      h(
        "span",
        { class: "muted" },
        h("b", { text: `${T.vsReference} “${ref.title || ref.id}”: ` }),
        !extra.length && !missing.length
          ? T.matchesReference
          : [
              extra.length ? `${extra.length} ${T.extraSteps}` : "",
              extra.length && missing.length ? " · " : "",
              missing.length
                ? `${missing.length} ${T.missingSteps} (${missing
                    .map((x) => `${compName(x.from)}→${compName(x.to)}${x.message ? `: ${x.message}` : ""}`)
                    .join("; ")})`
                : "",
            ],
      ),
    );
  }
  const unverified = fl.steps.filter((x) => !x.verified);
  if (unverified.length) {
    out.push(
      h(
        "span",
        { class: "warn-text" },
        `? ${T.unverifiedNote} ${unverified.map((x) => `${compName(x.from)} → ${compName(x.to)}`).join(", ")}`,
      ),
    );
  }
  return out;
}

// ── scenarios: GIVEN → WHEN → THEN as panels; AND/BUT belong to the panel above them ──
const GWT = ["GIVEN", "WHEN", "THEN"] as const;
type Gwt = (typeof GWT)[number];
type GwtGroups = Record<Gwt, { but: boolean; t: string }[]>;
function gwtGroups(sc: Scenario): GwtGroups {
  const g: GwtGroups = { GIVEN: [], WHEN: [], THEN: [] };
  let cur: Gwt = "GIVEN";
  for (const x of sc.steps) {
    const k = String(x.keyword).toUpperCase();
    if ((GWT as readonly string[]).includes(k)) cur = k as Gwt;
    g[cur].push({ but: k === "BUT", t: x.text });
  }
  return g;
}
function flowButtons(r: Requirement, sc: Scenario): HTMLElement[] {
  return (ex?.flows ?? [])
    .filter((f) => f.scenario === `${r.id}#${sc.id}`)
    .map((f) =>
      h("button", {
        class: "chip flow-chip",
        title: f.title,
        text: `▶ ${T.showFlow}`,
        onclick: () => mapApi.showFlow?.(f.id),
      }),
    );
}
// A scenario drawn as a flow: the state it starts from → the action → each outcome. Every AND/BUT line is a node of its
// column; several preconditions join into the arrow and several outcomes branch out of it.
const GWT_ICON: Record<Gwt, string> = { GIVEN: "●", WHEN: "▶", THEN: "✓" };
const GWT_FR: Record<Gwt, string> = { GIVEN: "1fr", WHEN: ".85fr", THEN: "1.15fr" };
function gwtFlow(
  g: GwtGroups,
  keys: Gwt[],
  opts: { labels?: boolean; compact?: boolean; same?: Record<string, boolean> },
): HTMLElement {
  const cells: HTMLElement[] = [];
  keys.forEach((k, i) => {
    if (i) cells.push(h("span", { class: "gf-arrow", "aria-hidden": "true" }));
    const lines = g[k];
    cells.push(
      h(
        "div",
        {
          class: `gf-col k-${k.toLowerCase()}${opts.same?.[k] ? " same" : ""}${lines.length ? "" : " empty"}`,
          role: "group",
          "aria-label": t(`k${k}`),
        },
        h("span", { class: "gf-k" }, h("i", { class: "gf-ico", text: GWT_ICON[k] }), t(`k${k}`)),
        h(
          "div",
          { class: `gf-nodes${lines.length > 1 ? " multi" : ""}` },
          lines.length
            ? lines.map((l) =>
                h("div", { class: "gf-node" }, l.but ? h("b", { class: "gwt-but", text: `${T.but} ` }) : null, l.t),
              )
            : h("div", { class: "gf-node empty", text: "—" }),
        ),
      ),
    );
  });
  return h(
    "div",
    {
      class: `gwt-flow${opts.labels ? "" : " no-labels"}${opts.compact ? " compact" : ""}`,
      style: `grid-template-columns:${keys.map((k) => `minmax(0,${GWT_FR[k]})`).join(" 34px ")}`,
    },
    cells,
  );
}
const gwtKeys = (gs: GwtGroups[]) => GWT.filter((k) => gs.some((g) => g[k].length));
/** One scenario; compact is the flow caption's version. */
function scenarioStrip(r: Requirement, sc: Scenario, compact = false): HTMLElement {
  const g = gwtGroups(sc);
  return h(
    "div",
    { class: `scn-card${compact ? " compact" : ""}` },
    h(
      "div",
      { class: "scn-head" },
      h("b", { text: (compact ? `${T.scenario}: ` : "") + sc.name }),
      compact ? h("span", { class: "faint", text: `· ${r.name}` }) : flowButtons(r, sc),
    ),
    gwtFlow(g, gwtKeys([g]), { labels: true, compact }),
  );
}
/** Several scenarios: one flow each on the same columns, labels once; a column equal to the one above fades. */
function scenarioTable(r: Requirement): HTMLElement {
  const gs = r.scenarios.map(gwtGroups);
  const keys = gwtKeys(gs);
  return h(
    "div",
    { class: "scn-list" },
    r.scenarios.map((sc, i) => {
      const same: Record<string, boolean> = {};
      for (const k of keys) {
        const cur = (gs[i] as GwtGroups)[k];
        same[k] = i > 0 && cur.length > 0 && JSON.stringify(cur) === JSON.stringify((gs[i - 1] as GwtGroups)[k]);
      }
      return h(
        "div",
        { class: "scn-card" },
        h("div", { class: "scn-head" }, h("b", { text: sc.name }), flowButtons(r, sc)),
        gwtFlow(gs[i] as GwtGroups, keys, { labels: i === 0, same }),
      );
    }),
  );
}
const scenarioView = (r: Requirement) =>
  r.scenarios.length > 1 ? scenarioTable(r) : scenarioStrip(r, r.scenarios[0] as Scenario);
function reqRow(r: Requirement): HTMLElement {
  const v = reqStatus(r);
  return h(
    "div",
    { class: "insp-row" },
    h("span", { class: `rs-dot rs-${v}` }),
    h("a", {
      href: "#sdd",
      text: trunc(r.name, 48),
      onclick: (ev: Event) => {
        ev.preventDefault();
        sddApi.open([r.id]);
      },
    }),
  );
}

// ═════════════════════════════ SDD · OpenSpec ═════════════════════════════
// Each change as its pipeline, then one matrix for all requirements: requirement × component, tests and status. A
// row opens to its scenarios and evidence. The map does not draw the spec; it lights the components it names.
const sddApi: { open: (ids: string[]) => void } = { open: () => {} };
function inspList(title: string, rows: Child): HTMLElement {
  return h("div", { class: "insp-list" }, h("h4", { text: title }), rows);
}
function artifactBody(c: SpecChange, kind: string): HTMLElement[] | null {
  const body: HTMLElement[] = [];
  if (kind === "proposal") {
    if (c.why) body.push(inspList(T.why, [h("p", { class: "insp-summary", text: c.why })]));
    if (c.what.length)
      body.push(
        inspList(T.whatChanges, [
          h(
            "ul",
            { class: "tight" },
            c.what.map((x) => h("li", { text: x })),
          ),
        ]),
      );
    if (c.impact.length)
      body.push(
        inspList(T.impact, [
          h(
            "ul",
            { class: "tight" },
            c.impact.map((x) => h("li", { text: x })),
          ),
        ]),
      );
  } else if (kind === "design") {
    if (c.decisions.length)
      body.push(
        inspList(T.decisionsDoc, [
          h(
            "ul",
            { class: "tight" },
            c.decisions.map((x) => h("li", { text: x })),
          ),
        ]),
      );
  } else if (kind === "tasks" && c.tasks) {
    const tasks = c.tasks;
    tasks.groups.forEach((g, gi) => {
      body.push(
        inspList(
          `${g.title} · ${g.done}/${g.total}`,
          tasks.items
            .filter((x) => x.group === gi)
            .map((x) =>
              h(
                "div",
                { class: `insp-row task${x.done ? " done" : ""}` },
                h("span", { class: "task-box", text: x.done ? "✓" : "" }),
                h("span", { text: x.text }),
              ),
            ),
        ),
      );
    });
  } else if (kind === "spec") {
    if (c.requirements.length) body.push(inspList(T.reqs, c.requirements.map(reqRow)));
  } else if (kind === "code") {
    const touched = facts.components.filter((x) => x.delta !== "unchanged");
    if (touched.length) {
      body.push(
        inspList(
          T.kComponents,
          touched.map((x) =>
            h(
              "div",
              { class: "insp-row" },
              h("span", { class: `badge ${x.delta}`, text: deltaLabel(x.delta, true) }),
              h("a", {
                href: "#map",
                text: compName(x.id),
                onclick: (ev: Event) => {
                  ev.preventDefault();
                  mapApi.inspect?.(x.id);
                },
              }),
            ),
          ),
        ),
      );
    }
  }
  const art = c.artifacts.filter((a) => a.kind === kind);
  if (art.length) {
    body.push(
      h(
        "div",
        { class: "insp-list" },
        art.map((a) => h("div", { class: "insp-row" }, fileLink(a.path, a.path.split("/").slice(-3).join("/")))),
      ),
    );
  }
  return body.length ? body : null;
}

/** The pipeline as a stepper; a step opens its document right below it. */
function sddPipeline(c: SpecChange): HTMLElement[] {
  const panel = h("div", { class: "sdd-doc", hidden: true });
  let open: HTMLElement | null = null;
  const list = h(
    "ol",
    { class: "sdd-pipe" },
    pipelineSteps(c).map((stp, i) => {
      const body = artifactBody(c, stp.id);
      const p = stp.progress;
      const btn = h(
        "button",
        {
          class: `pstep ps-${stp.state.cls}`,
          disabled: !body,
          "aria-expanded": body ? "false" : null,
          title: `${stp.title} · ${stp.state.text}`,
        },
        h("span", {
          class: "pdot",
          text: ({ present: "✓", removed: "✗" } as Record<string, string>)[stp.state.cls] ?? String(i + 1),
        }),
        h("span", { class: "pname", text: stp.title }),
        h("span", { class: "pstate", text: p ? `${p[0]}/${p[1]}` : stp.state.text }),
        p
          ? h(
              "span",
              { class: "pbar" },
              h("i", {
                class: p[0] === p[1] ? "full" : "",
                style: `width:${p[1] ? Math.round((100 * p[0]) / p[1]) : 0}%`,
              }),
            )
          : null,
      );
      if (body) {
        btn.addEventListener("click", () => {
          const again = open === btn;
          if (open) {
            open.classList.remove("on");
            open.setAttribute("aria-expanded", "false");
          }
          panel.textContent = "";
          panel.hidden = true;
          open = null;
          if (again) return;
          open = btn;
          btn.classList.add("on");
          btn.setAttribute("aria-expanded", "true");
          append(panel, body);
          panel.hidden = false;
        });
      }
      return h("li", null, btn);
    }),
  );
  return [h("div", { class: "sdd-pipe-wrap" }, list), panel];
}

/** How many requirements are met, as one bar. */
function sddCoverage(): HTMLElement | null {
  const n: Partial<Record<ReqStatus, number>> = {};
  for (const r of REQS) {
    const k = reqStatus(r);
    n[k] = (n[k] ?? 0) + 1;
  }
  const shown = (["implemented", "partial", "missing", "not-applicable", "pending"] as ReqStatus[]).filter((k) => n[k]);
  if (!shown.length) return null;
  return h(
    "div",
    { class: "sdd-cov" },
    h(
      "div",
      { class: "cov-bar", role: "img", "aria-label": shown.map((k) => `${n[k]} ${rsLabel(k)}`).join(", ") },
      shown.map((k) => h("span", { class: `rs-${k}`, style: `flex:${n[k]}`, title: `${n[k]} ${rsLabel(k)}` })),
    ),
    h(
      "div",
      { class: "cov-legend" },
      shown.map((k) =>
        h("span", null, h("i", { class: `rs-dot rs-${k}` }), h("b", { text: String(n[k]) }), rsLabel(k)),
      ),
    ),
  );
}

function sddMatrix(): HTMLElement {
  const comps: string[] = [];
  for (const r of REQS) for (const c of specMap[r.id]?.components ?? []) if (!comps.includes(c)) comps.push(c);
  comps.sort(byCompRank);
  const heads: Record<string, HTMLElement> = {};
  const reqs: (HTMLDetailsElement & { comps: string[]; rid: string })[] = [];
  // Hovering a row lights its components' columns; hovering a column lights the rows that use it.
  const lightRow = (det: { comps: string[] }, on: boolean) => {
    for (const c of det.comps) heads[c]?.classList.toggle("lit", on);
  };
  const lightCol = (c: string, on: boolean) => {
    heads[c]?.classList.toggle("lit", on);
    for (const det of reqs) if (det.comps.includes(c)) det.classList.toggle("lit", on);
  };
  const grid = h(
    "div",
    {
      class: "sdd-grid",
      style: `--cols:minmax(240px, 520px) 136px 56px${comps.length ? ` repeat(${comps.length}, 46px)` : ""}`,
    },
    h(
      "div",
      { class: "sdd-row sdd-head" },
      h("span", { text: T.reqs }),
      h("span", { text: T.status }),
      h("span", { class: "num", text: T.tests }),
      comps.map((c) => {
        const delta = changeComp[c]?.delta ?? "unchanged";
        const btn = h(
          "button",
          {
            class: `sdd-comp st-${delta}`,
            title: `${compName(c)} · ${layerName(c)} · ${deltaLabel(delta, true)}`,
            onclick: () => mapApi.inspect?.(c),
            onmouseenter: () => lightCol(c, true),
            onmouseleave: () => lightCol(c, false),
          },
          h("span", { class: "vtext", text: trunc(compName(c), 28) }),
        );
        heads[c] = btn;
        return btn;
      }),
    ),
  );
  let lastCap: string | null = null;
  for (const r of REQS) {
    const capKey = r.capability + (r.change ? "" : ` · ${T.mainSpec}`);
    if (capKey !== lastCap) {
      grid.appendChild(h("div", { class: "sdd-cap", text: capKey }));
      lastCap = capKey;
    }
    const m = specMap[r.id];
    const v = reqStatus(r);
    const tests = m ? (m.tests ?? []).filter((x, i, a) => a.indexOf(x) === i) : [];
    const mComps = m?.components ?? [];
    const det = h(
      "details",
      { class: `sdd-req op-${r.op} rs-${v}`, open: v === "partial" || v === "missing" || REQS.length <= 3 },
      h(
        "summary",
        { class: "sdd-row" },
        h(
          "span",
          { class: "sdd-name" },
          h("span", { class: `op-tag op-${r.op}`, text: t(`op${r.op}`) + (r.merged ? ` · ${T.merged}` : "") }),
          h("b", { text: r.name }),
          r.scenarios.length
            ? h("span", {
                class: "faint scn-count",
                text: `${r.scenarios.length} ${(r.scenarios.length === 1 ? T.scenario : T.scenarios).toLowerCase()}`,
              })
            : null,
        ),
        h("span", { class: `rs-pill rs-${v}`, text: `${RS_ICON[v]} ${rsLabel(v)}` }),
        h("span", {
          class: `sdd-cell num${tests.length ? "" : " faint"}`,
          title: tests.join("\n") || null,
          text: tests.length ? `⚗ ${tests.length}` : "—",
        }),
        comps.map((c) => {
          const on = mComps.includes(c);
          return h(
            "span",
            { class: "sdd-cell", title: on ? compName(c) : null },
            on ? h("i", { class: `cell-dot rs-${v}` }) : null,
          );
        }),
      ),
      h(
        "div",
        { class: "sdd-detail" },
        r.text ? h("p", { class: "sdd-text", text: r.text }) : null,
        m?.note
          ? h("div", { class: `sdd-note rs-${v}` }, h("b", { text: `${RS_ICON[v]} ${cap(rsLabel(v))}` }), ` ${m.note}`)
          : null,
        mComps.length
          ? h(
              "div",
              { class: "sdd-comps-m" },
              mComps.map((c) =>
                h("span", { class: `badge ${changeComp[c]?.delta ?? "unchanged"}`, text: compName(c) }),
              ),
            )
          : null,
        r.scenarios.length ? scenarioView(r) : null,
        h(
          "div",
          { class: "sdd-foot" },
          tests.map((x) => h("span", { class: "test-ref" }, "⚗ ", fileLink(x, x.split("/").pop()))),
          h(
            "span",
            { class: "faint" },
            "spec ",
            fileLink(`${r.file}:${r.line}`, r.file.split("/").slice(-3).join("/")),
          ),
          mComps.length
            ? h("button", {
                class: "chip",
                text: `◇ ${T.showOnMap}`,
                onclick: () => mapApi.focus?.("architecture", mComps),
              })
            : null,
        ),
      ),
    ) as HTMLDetailsElement & { comps: string[]; rid: string };
    det.comps = mComps;
    det.rid = r.id;
    det.addEventListener("mouseenter", () => lightRow(det, true));
    det.addEventListener("mouseleave", () => lightRow(det, false));
    reqs.push(det);
    grid.appendChild(det);
  }
  sddApi.open = (ids) => {
    const hit = reqs.filter((d) => ids.includes(d.rid));
    for (const d of hit) {
      d.open = true;
      d.classList.remove("flash");
      void d.offsetWidth;
      d.classList.add("flash");
    }
    const target = hit[0] ?? document.getElementById("sdd");
    target?.scrollIntoView({ block: hit[0] ? "center" : "start", behavior: REDUCED ? "auto" : "smooth" });
  };
  return h(
    "div",
    { class: "sdd-matrix" },
    grid,
    !ex?.requirements.length ? h("p", { class: "empty sdd-pending", text: T.pendingMap }) : null,
  );
}

function renderSpec(): HTMLElement | null {
  if (!OS || !REQS.length) return null;
  return sectionShell(
    "sdd",
    `${T.spec} · ${T.openspec}`,
    [
      OS.changes.map((c) => {
        const phase = c.movedToArchive ? T.phaseArchiving : c.archived ? T.phaseArchived : T.phaseActive;
        return h(
          "div",
          { class: "card sdd-change" },
          h(
            "div",
            { class: "sdd-change-head" },
            h("code", { class: "sdd-id", text: `openspec/${c.id}` }),
            h("span", { class: `badge ${c.archived || c.movedToArchive ? "unchanged" : "changed"}`, text: phase }),
          ),
          c.why ? h("p", { class: "sdd-why", text: c.why }) : null,
          sddPipeline(c),
        );
      }),
      h("div", { class: "card sdd-reqs" }, h("h3", { text: T.reqs }), sddCoverage(), sddMatrix()),
    ],
    tf("leadSpec", { n: REQS.length, i: REQS.filter((r) => reqStatus(r) === "implemented").length }),
  );
}

// ═════════════════════════════ sections below the map ═════════════════════════════
// Order of reading: why it is built this way (decisions) → what the spec asks (SDD) → where it changed (files).

/** Why the change is built this way: the agent's design decisions, each with its main alternative. */
function renderDecisions(): HTMLElement | null {
  if (!ex?.decisions.length) return null;
  return sectionShell(
    "decisions",
    T.decisions,
    [
      h(
        "div",
        { class: "decisions" },
        ex.decisions.map((d) =>
          h(
            "div",
            { class: "card decision" },
            h("h3", { text: d.title }),
            h("p", { text: d.why }),
            d.alternative ? h("p", { class: "alt" }, h("b", { text: `${T.alternative}: ` }), d.alternative) : null,
            d.evidence ? fileLink(d.evidence) : null,
          ),
        ),
      ),
    ],
    ex.decisions.length === 1 ? T.leadDecision1 : tf("leadDecisions", { n: ex.decisions.length }),
  );
}

/** Where it changed: one row per changed component (delta, summary, files), then tests and files outside the map. */
function renderChanges(): HTMLElement | null {
  const comps = facts.components
    .filter((c) => c.delta !== "unchanged")
    .map((c) => c.id)
    .sort(byCompRank);
  const byComp: Record<string, FileFacts[]> = {};
  const tests: FileFacts[] = [];
  const outside: FileFacts[] = [];
  for (const f of facts.files) {
    if (f.category === "ignored") continue;
    if (f.category === "test") tests.push(f);
    else if (f.component && comps.includes(f.component)) listAt(byComp, f.component).push(f);
    else outside.push(f);
  }
  const nFiles = facts.files.filter((f) => f.category !== "ignored").length;
  if (!nFiles) return null;
  const open = nFiles <= 24; // rows are open when the change is small enough to read whole
  const nums = (add: number, del: number) =>
    h(
      "span",
      { class: "nums" },
      h("span", { class: "add", text: `+${fmt(add)}` }),
      " ",
      h("span", { class: "del", text: `−${fmt(del)}` }),
    );
  const sum = (fs: FileFacts[], k: "additions" | "deletions") => fs.reduce((a, f) => a + f[k], 0);
  const fileRows = (fs: FileFacts[]) =>
    h(
      "div",
      { class: "chg-files" },
      fs.map((f) =>
        h(
          "div",
          { class: "insp-row" },
          h("span", { class: `gs gs-${gitLetter(f)}`, text: gitLetter(f) }),
          fileLink(f.path),
          nums(f.additions, f.deletions),
        ),
      ),
    );
  function group(
    badge: HTMLElement | null,
    name: string,
    meta: string | null,
    summary: string | null,
    fs: FileFacts[],
    onMap?: () => void,
  ) {
    return h(
      "details",
      { class: "chg", open },
      h(
        "summary",
        { class: "chg-head" },
        h(
          "span",
          { class: "chg-line" },
          badge,
          h("b", { class: "chg-name", text: name }),
          meta ? h("span", { class: "faint", text: meta }) : null,
          h("span", { class: "chg-count faint", text: `${fs.length} ${fs.length === 1 ? T.file : T.kFiles}` }),
          nums(sum(fs, "additions"), sum(fs, "deletions")),
        ),
        summary ? h("span", { class: "chg-summary", text: summary }) : null,
      ),
      fileRows(fs),
      onMap ? h("button", { class: "chip", text: T.showOnMap, onclick: onMap }) : null,
    );
  }
  return sectionShell(
    "changes",
    T.changesTitle,
    h("div", { class: "card chg-list" }, [
      comps
        .filter((id) => byComp[id])
        .map((id) => {
          const n = changeComp[id] as ComponentFacts;
          const c = compById[id];
          return group(
            h("span", { class: `badge ${n.delta}`, text: deltaLabel(n.delta, true) }),
            compName(id),
            layerName(id),
            summaryOf[id] ?? (c?.desc || null),
            byComp[id] as FileFacts[],
            () => mapApi.inspect?.(id),
          );
        }),
      tests.length ? group(null, T.testFiles, null, null, tests) : null,
      outside.length ? group(null, T.outsideMap, null, null, outside) : null,
    ]),
    tf("leadChanges", { c: comps.length, f: nFiles }),
  );
}

function excerpt(f: FileFacts, lines: string, ctxLines = 3): HTMLElement {
  const m = /^(\d+)(?:-(\d+))?$/.exec(lines) as RegExpExecArray;
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  const removed = f.delta === "removed";
  const table = h("table", { class: "diff" });
  for (const hk of f.hunks) {
    const lo = removed ? hk.oldStart : hk.newStart;
    const hi = lo + Math.max(removed ? hk.oldLines : hk.newLines, 1) - 1;
    if (a > hi || b < lo) continue;
    table.appendChild(diffRows(hk, (n) => n >= a - ctxLines && n <= b + ctxLines, removed, a, b));
  }
  return table;
}

function diffRows(
  hk: Hunk,
  keep: (n: number) => boolean,
  oldSide: boolean,
  hlA: number,
  hlB: number,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.appendChild(
    h(
      "tr",
      { class: "hh" },
      h("td", {
        colspan: "4",
        text: `@@ −${hk.oldStart},${hk.oldLines} +${hk.newStart},${hk.newLines} @@ ${hk.header || ""}`,
      }),
    ),
  );
  let o = hk.oldStart;
  let n = hk.newStart;
  for (const [mark, body] of hk.lines) {
    const ref = oldSide ? o : n;
    const show = keep(mark === "+" ? n : mark === "-" ? (oldSide ? o : n) : ref);
    if (show) {
      const inRange = ref >= hlA && ref <= hlB && mark !== (oldSide ? "+" : "-");
      frag.appendChild(
        h(
          "tr",
          {
            class: (mark === "+" ? "a" : mark === "-" ? "d" : "") + (inRange ? " hl" : ""),
            "data-n": mark === "-" ? null : n,
          },
          h("td", { class: "ln", text: mark === "+" ? "" : o }),
          h("td", { class: "ln", text: mark === "-" ? "" : n }),
          h("td", { class: "sg", text: mark === " " ? "" : mark }),
          h("td", { class: "code", text: body }),
        ),
      );
    }
    if (mark !== "+") o++;
    if (mark !== "-") n++;
  }
  return frag;
}

// ═════════════════════════════ shell ═════════════════════════════
function themeButton(): HTMLElement {
  const modes = ["auto", "light", "dark"];
  let cur = store<string>("ec:theme") ?? "auto";
  const btn = h("button", {
    class: "theme-btn",
    onclick: () => {
      cur = modes[(modes.indexOf(cur) + 1) % 3] as string;
      store("ec:theme", cur);
      paint();
    },
  });
  function paint() {
    if (cur === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", cur);
    btn.textContent = `◐ ${t(`theme${cap(cur)}`)}`;
    btn.title = T.theme;
  }
  paint();
  return btn;
}

const app = document.getElementById("app") as HTMLElement;
const main = h("main");
main.appendChild(renderHeader());
main.appendChild(renderMap());
const below = [
  { id: "decisions", title: T.decisions, n: ex ? ex.decisions.length : 0, el: renderDecisions() },
  { id: "sdd", title: T.spec, n: REQS.length, el: renderSpec() },
  { id: "changes", title: T.delta, n: facts.files.filter((f) => f.category !== "ignored").length, el: renderChanges() },
].filter((x) => x.el);
for (const x of below) main.appendChild(x.el as HTMLElement);
const navList = h(
  "nav",
  { class: "topnav" },
  h("a", { href: "#map", "data-sec": "map", text: T.canvas }),
  below.map((x) =>
    h("a", { href: `#${x.id}`, "data-sec": x.id }, x.title, h("span", { class: "nav-n", text: String(x.n) })),
  ),
);
/** The mark, report/bulb.svg: a lit bulb drawn in the accent color. */
function brandMark(): HTMLElement {
  const mark = h("span", { class: "brand-mark", "aria-hidden": "true" });
  mark.innerHTML = BULB;
  return mark;
}

app.appendChild(
  h(
    "div",
    { class: "topbar" },
    h(
      "a",
      { class: "brand", href: "#summary" },
      brandMark(),
      h("span", { class: "brand-name", text: "explain-change" }),
    ),
    navList,
    themeButton(),
  ),
);
app.appendChild(main);
app.appendChild(h("footer", { class: "foot faint", text: `explain-change ${DATA.tool || ""} · key ${facts.key}` }));
document.dispatchEvent(new CustomEvent("ec:mounted"));

if ("IntersectionObserver" in window) {
  const links = Array.from(navList.querySelectorAll("a[data-sec]"));
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        for (const a of links) a.classList.toggle("active", a.getAttribute("data-sec") === en.target.id);
      }
    },
    { rootMargin: "-30% 0px -60% 0px" },
  );
  for (const sct of Array.from(main.querySelectorAll("section[id]"))) io.observe(sct);
}
