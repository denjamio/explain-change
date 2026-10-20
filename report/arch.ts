/*
 * The architecture view: lanes (layers, top = entry), components ordered to cut crossings, dependencies as routed edges.
 */

import type { ComponentFacts, DependencyFacts } from "../src/contract/facts.ts";
import { listAt, r1, s, textLines, textWidth, wrap } from "./dom.ts";
import { iconAt } from "./icons.ts";
import {
  byCompRank,
  cfg,
  compById,
  compName,
  deltaLabel,
  facts,
  isNewViolation,
  reqStatus,
  reqsOfComp,
  rsLabel,
  summaryOf,
} from "./model.ts";
import { isContext, keyPairs } from "./story.ts";
import { markers, newView } from "./svg-view.ts";
import { type Box, mapApi, type View } from "./ui.ts";
import { T, tf } from "./words.ts";

/**
 * How a component meets the requirements mapped to it: the spec icon and implemented / mapped ("2/3"), colored by
 * the worst status (partial amber, missing red). Its right end at x, on the baseline y. Opens the requirements view.
 */
function reqBadge(id: string, x: number, y: number): SVGElement | null {
  const reqs = reqsOfComp(id);
  const statuses = reqs.map(reqStatus).filter((v) => v !== "not-applicable" && v !== "none");
  if (!statuses.length) return null;
  const count = (v: string) => statuses.filter((x) => x === v).length;
  const worst = count("missing") ? "missing" : count("partial") ? "partial" : "implemented";
  const label = `${count("implemented")}/${statuses.length}`;
  const tip = [tf("reqBadgeTip", { d: count("implemented"), n: statuses.length })]
    .concat((["partial", "missing"] as const).filter((v) => count(v)).map((v) => `${count(v)} ${rsLabel(v)}`))
    .join(" · ");
  const w = textWidth(label, "600 11.5px");
  return s(
    "g",
    {
      class: `req-badge rs-${worst}`,
      onclick: (ev: Event) => {
        ev.stopPropagation();
        mapApi.focus?.(
          "requirements",
          reqs.map((r) => r.id),
        );
      },
    },
    s("title", { text: tip }),
    iconAt("spec", x - w - 15, y - 10, 12),
    s("text", { x, y, "text-anchor": "end", text: label }),
  );
}

// ── Architecture: lanes (layers, top = entry), components ordered to cut crossings ──

export interface ArchLayout {
  W: number;
  H: number;
  bands: { layer: (typeof cfg.layers)[number]; y: number; h: number; n: number }[];
  pos: Record<string, Box>;
  compact: boolean;
  GX: number;
  /** Each component's name, in the lines its box shows. */
  names: Record<string, string[]>;
}

const NAME_LINE = 17;
/** The lane's label column, left of its components. */
const LABEL_W = 156;
/** The font of a component's name on the map (as .node .name sets it). */
const nameFont = (compact: boolean) => (compact ? "650 13px" : "650 14px");

export function layoutArch(nodes: ComponentFacts[], edges: DependencyFacts[], compact: boolean): ArchLayout {
  const W = compact ? 380 : 1160;
  const LABEL = compact ? 0 : LABEL_W;
  const NW = compact ? 168 : 200;
  // A name is never cut while 2 lines hold it: every box grows by the lines the longest name needs.
  const names: Record<string, string[]> = {};
  for (const n of nodes) names[n.id] = wrap(compById[n.id]?.name ?? n.id, nameFont(compact), NW - 28);
  const NH = 66 + (Math.max(1, ...Object.values(names).map((l) => l.length)) - 1) * NAME_LINE;
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
  return { W, H: Math.max(y - 12, 60), bands, pos, compact, GX, names };
}

export function edgePaths(edges: DependencyFacts[], pos: Record<string, Box>, L: ArchLayout) {
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

export type ArchMode = "delta" | "after" | "before";

export function buildArchitecture(
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
    // .band-label: 650 12px, uppercase, letter-spacing .05em.
    const band = { spacing: 0.6, upper: true };
    if (L.compact) {
      const [label] = wrap(b.layer.name, "650 12px", L.W - 28, { ...band, lines: 1 });
      svg.appendChild(s("text", { x: 14, y: b.y + 20, class: "band-label", text: label }));
    } else {
      // The label column is narrow: a layer name takes up to 3 lines there, centered on the lane with its count.
      const lines = wrap(b.layer.name, "650 12px", LABEL_W - 30, { ...band, lines: 3 });
      const top = b.y + b.h / 2 - 2 - ((lines.length - 1) * 15) / 2;
      const label = textLines({ x: 18, y: top, class: "band-label" }, lines, 15);
      label.appendChild(s("title", { text: b.layer.name }));
      svg.appendChild(label);
      svg.appendChild(
        s("text", {
          x: 18,
          y: top + (lines.length - 1) * 15 + 16,
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
    const label = keyPairs[`${e.from}>${e.to}`];
    if (isKey && label) {
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
    const neighbor = n.delta === "unchanged";
    const info = neighbor ? T.lNeighbor : `${n.files} ${n.files === 1 ? T.file : T.kFiles}`;
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
      textLines({ x: r.x + 14, y: r.y + 39, class: "name" }, L.names[n.id] ?? [c.name], NAME_LINE),
      s("text", { x: r.x + 14, y: r.y + r.h - 10, class: "info", text: info }),
      neighbor ? null : reqBadge(n.id, r.x + r.w - 12, r.y + r.h - 10),
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
