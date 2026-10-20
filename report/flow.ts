/*
 * The flow view: a sequence over real components whose steps travel in order, the data on each step, and the notes below it.
 */

import { h, MONO, r1, s, textLines, textWidth, wrap } from "./dom.ts";
import {
  byCompRank,
  cfg,
  changeComp,
  compById,
  compName,
  layerName,
  type NFlow,
  type NStep,
  reqById,
} from "./model.ts";
import { scenarioStrip } from "./sdd.ts";
import { markers, newView } from "./svg-view.ts";
import { FIELD_MARK, fieldDelta, fieldText, type View } from "./ui.ts";
import { T, tf } from "./words.ts";

// ── Data flow: a sequence over real components, steps travel in order ──
/** How far right of its lifeline a call to itself writes its label. */
const SELF_X = 46;
export function buildFlow(fl: NFlow): View {
  const parts: string[] = [];
  for (const x of fl.steps) for (const p of [x.from, x.to]) if (!parts.includes(p)) parts.push(p);
  parts.sort(byCompRank);
  const hasData = fl.steps.some((x) => x.data);
  const COL = 220;
  const TOP = 20;
  // A participant's name takes up to 2 lines in its head; every head grows by the lines the longest name needs.
  const names: Record<string, string[]> = {};
  for (const p of parts) names[p] = wrap(compById[p]?.name ?? p, "650 13px", COL - 24 - 16);
  const extra = (Math.max(1, ...Object.values(names).map((l) => l.length)) - 1) * 16;
  const HEAD = 58 + extra;
  // A call is never cut. It takes 2 lines when 1 does not fit between its lifelines, broken after a code
  // separator (`Folders.` / `DeleteMany()`); only when 2 lines do not fit either do the lifelines move apart.
  const at = (p: string) => parts.indexOf(p);
  const calls = fl.steps.map((stp) => {
    const a = Math.min(at(stp.from), at(stp.to));
    const b = Math.max(at(stp.from), at(stp.to));
    const font = `${stp.delta === "unchanged" ? 400 : 650} 12.5px`;
    const text = stp.call + (stp.verified ? "" : "  ?");
    // A call to itself is written right of its lifeline, toward the next one.
    let room = a === b ? COL - SELF_X - 16 : (b - a) * COL - 48;
    const breaks = (maxW: number) => wrap(text, font, maxW, { lines: 99, whole: true });
    let lines = breaks(room);
    if (lines.length > 2) room = Math.max(room, textWidth(text, font) / 2);
    while (lines.length > 2) {
      lines = breaks(room);
      room += 8;
    }
    const w = Math.max(...lines.map((l) => textWidth(l, font)), stp.data ? chipWidth(stp.data) : 0);
    return { a, b, lines, w };
  });
  const gaps = parts.slice(1).map(() => COL);
  let rightPad = 0;
  for (const { a, b, w } of [...calls].sort((p, q) => p.b - p.a - (q.b - q.a))) {
    if (a === b) {
      const need = SELF_X + w + 16;
      if (a < gaps.length) gaps[a] = Math.max(gaps[a] as number, need);
      else rightPad = Math.max(rightPad, need - COL / 2);
      continue;
    }
    const need = w + 48;
    const have = gaps.slice(a, b).reduce((v, g) => v + g, 0);
    if (have < need) for (let i = a; i < b; i++) gaps[i] = (gaps[i] as number) + (need - have) / (b - a);
  }
  // A second line of a call needs its own room above the arrow, in every row so the steps keep one rhythm.
  const LINE = 15;
  const twoLines = calls.some((c) => c.lines.length > 1);
  const ROW = (hasData ? 66 : 50) + (twoLines ? LINE : 0);
  const span = gaps.reduce((v, g) => v + g, 0) + COL + rightPad;
  const W = Math.max(720, span + 40);
  const H = TOP + HEAD + 26 + fl.steps.length * ROW + 16;
  const V = newView(`flow:${fl.id}`, W, H);
  const svg = V.svg;
  const x: Record<string, number> = {};
  let cx = (W - span) / 2 + COL / 2;
  parts.forEach((p, i) => {
    x[p] = cx;
    cx += gaps[i] ?? 0;
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
        textLines({ x: px, y: TOP + 21, "text-anchor": "middle", class: "name" }, names[p] ?? [c ? c.name : p], 16),
        s("text", {
          x: px,
          y: TOP + 37 + extra,
          "text-anchor": "middle",
          class: "layer",
          // .layer: 10px, uppercase, letter-spacing .06em.
          text: wrap(layerName(p), "10px", box.w - 16, { lines: 1, spacing: 0.6, upper: true })[0],
        }),
      ),
    );
  }
  const n = fl.steps.length;
  const per = 0.9;
  const total = n * per + 1.2;
  fl.steps.forEach((stp, i) => {
    const y = TOP + HEAD + 30 + (twoLines ? LINE : 0) + i * ROW;
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
    const { lines, w } = calls[i] as (typeof calls)[number];
    const more = (lines.length - 1) * LINE;
    const self = stp.from === stp.to;
    // A label grows up from the arrow; a call to itself writes it down beside its loop.
    const top = self ? y - 24 : y - 24 - more;
    g.appendChild(
      s("rect", {
        x: Math.min(x1, x2) - 14,
        y: top,
        width: Math.max(Math.abs(x2 - x1), 60) + 28,
        height: 36 + more,
        rx: 8,
        class: "msg-bg",
      }),
    );
    if (self) {
      g.appendChild(s("path", { id: pid, d: `M${x1},${y - 6} h38 v16 h-34`, class: "msg-line", "marker-end": marker }));
      const text = textLines({ x: x1 + SELF_X, y: y + 4, class: "msg-label" }, lines, LINE);
      text.appendChild(s("title", { text: stp.call }));
      g.appendChild(text);
      V.geo[key] = { x: x1 - 10, y: top, w: SELF_X + w + 20, h: 36 + more };
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
      const text = textLines(
        { x: (x1 + x2) / 2, y: y - 8 - more, "text-anchor": "middle", class: "msg-label" },
        lines,
        LINE,
      );
      text.appendChild(s("title", { text: stp.call }));
      g.appendChild(text);
      if (stp.data) g.appendChild(dataChip(stp.data, (x1 + x2) / 2, y + 17));
      V.geo[key] = { x: Math.min(x1, x2), y: top, w: Math.abs(x2 - x1), h: 36 + more };
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
function chipParts(data: NonNullable<NStep["data"]>): { t: string; k: string }[] {
  const fields = data.fields ?? [];
  let shown = fields.filter((f) => fieldDelta(f) !== "unchanged");
  if (!shown.length) shown = fields.slice(0, 3);
  return [
    { t: data.type, k: "type" },
    ...(shown.length ? [{ t: " {", k: "p" }] : []),
    ...shown.slice(0, 4).map((f, i) => {
      const k = fieldDelta(f);
      return { t: (i ? "  " : " ") + FIELD_MARK[k] + (fieldText(f).split(":")[0] as string).trim(), k };
    }),
    ...(shown.length > 4 ? [{ t: `  +${shown.length - 4}`, k: "p" }] : []),
    ...(shown.length ? [{ t: " }", k: "p" }] : []),
  ];
}
const chipWidth = (data: NonNullable<NStep["data"]>) =>
  Math.ceil(
    textWidth(
      chipParts(data)
        .map((p) => p.t)
        .join(""),
      "11px",
      MONO,
    ),
  ) + 20;

export function dataChip(data: NonNullable<NStep["data"]>, cx: number, y: number): SVGElement {
  const fields = data.fields ?? [];
  const parts = chipParts(data);
  const w = chipWidth(data);
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

export function flowNotes(fl: NFlow): HTMLElement[] {
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
