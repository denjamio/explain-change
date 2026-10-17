/*
 * The data view: the entities the change touches (agent, with evidence) and the migrations in the diff (computed).
 */

import type { NormalizedExplanation } from "../src/contract/explanation.ts";
import type { Delta } from "../src/contract/facts.ts";
import { MONO, r1, s, textWidth, trunc } from "./dom.ts";
import { byCompRank, compName, DM, deltaLabel, facts, gitLetter } from "./model.ts";
import { newView } from "./svg-view.ts";
import { type Box, FIELD_MARK, fieldDelta, fieldText, onOpen, type View } from "./ui.ts";
import { T } from "./words.ts";

// ── Data: the entities the change touches (agent, with evidence) and the migrations in the diff (computed) ──

export function buildData(onNode?: (g: SVGElement, key: string) => void): View {
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
