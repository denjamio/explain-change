/*
 * explain-change report. Pure and deterministic: same data → same DOM and SVG. No dependencies.
 * Layout: a map (architecture lanes · data flows · data model) driven by a story whose steps move the camera and
 * light what changed; below it the design decisions, the SDD section (OpenSpec pipeline, requirement × component
 * matrix, scenarios) and the changes by component.
 */

import type { NormalizedExplanation } from "../src/contract/explanation.ts";
import type { ComponentFacts, Delta, DependencyFacts, FileFacts } from "../src/contract/facts.ts";
import BULB from "./bulb.svg" with { type: "text" };
import { createCamera } from "./camera.ts";
import { codeExcerpt } from "./code.ts";
import { append, type Child, cap, fit, fmt, h, listAt, MONO, r1, s, store, textWidth, trunc } from "./dom.ts";
import { componentDetails, entityDetails, type InspectorNav } from "./inspector.ts";
import {
  byCompRank,
  cfg,
  changeComp,
  compById,
  compName,
  DATA,
  DM,
  deltaLabel,
  ex,
  facts,
  gitLetter,
  isNewViolation,
  layerName,
  type NFlow,
  type NStep,
  OS,
  REDUCED,
  REQS,
  reqById,
  reqsOfComp,
  type StoryStep,
  specComponents,
  specMap,
  src,
  st,
  summaryOf,
} from "./model.ts";
import { renderSpec, scenarioStrip, sddApi } from "./sdd.ts";
import {
  type Box,
  chip,
  FIELD_MARK,
  fieldDelta,
  fieldText,
  fileLink,
  legendItem,
  mapApi,
  onOpen,
  sectionShell,
  type View,
} from "./ui.ts";
import { T, t, tf } from "./words.ts";

// ── helpers ──

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

// ═════════════════════════════ views ═════════════════════════════
// Every view draws into one SVG and registers its focusable elements: geo[key] (box), data-k on the element, and
// edges carrying data-a / data-b. `expand(set)` says what else lights up with a focus set.

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
    else if (stp.via) g.appendChild(s("title", { text: tf("viaPort", { x: stp.via }) }));
    else if (stp.port) g.appendChild(s("title", { text: T.viaSomePort }));
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
  const { apply, frame, fly, zoom, fullBox, box: viewBox } = createCamera(viewport, () => current);

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
      const shown = viewBox();
      apply(prev && prev.id === current.id && shown ? shown : fullBox());
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
  const nav: InspectorNav = {
    back: () => go(stepIdx),
    inspect: (id) => inspect(id),
    entity: (eid) => inspectEntity(eid),
  };
  function inspect(key: string) {
    if (key.slice(0, 4) === "req:") return sddApi.open([key.slice(4)]);
    if (key.slice(0, 4) === "ent:") return inspectEntity(key.slice(4));
    const id = key.replace(/^comp:/, "");
    const hidden = changeComp[id];
    if (hidden && isContext(hidden) && !withContext) setContext(true);
    inspecting = id;
    inspector.textContent = "";
    append(inspector, componentDetails(id, nav));
    storyPane.hidden = true;
    codePane.hidden = codeSplit.hidden = true;
    inspector.hidden = false;
    let viewId = current?.id ?? "architecture";
    if (viewId.slice(0, 5) === "flow:" && !current?.geo[`p:${id}`]) viewId = "architecture";
    show(viewId, [id], true);
    inspecting = id;
  }
  function inspectEntity(eid: string) {
    inspector.textContent = "";
    append(inspector, entityDetails(eid, nav));
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
    const shown = viewBox();
    apply(shown ? frame(shown, 0) : fullBox());
  }
  if ("ResizeObserver" in window) {
    let last = { w: 0, h: 0 };
    new ResizeObserver(() => {
      const w = viewport.clientWidth;
      const hh = viewport.clientHeight;
      // Same zoom, more or less of the view around the center: resizing never rescales the diagram.
      const vb = viewBox();
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
