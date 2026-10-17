/** The SDD section: the OpenSpec pipeline, the requirement × component matrix and the scenarios. */

import type { Requirement, Scenario, SpecChange } from "../src/contract/facts.ts";
import { append, type Child, cap, h, trunc } from "./dom.ts";
import { icon } from "./icons.ts";
import {
  byCompRank,
  changeComp,
  compName,
  deltaLabel,
  ex,
  facts,
  layerName,
  OS,
  REDUCED,
  REQS,
  type ReqStatus,
  RS_ICON,
  reqStatus,
  rsLabel,
  specMap,
} from "./model.ts";
import { fileLink, mapApi, sectionShell } from "./ui.ts";
import { T, t, tf } from "./words.ts";
export function artifactState(c: SpecChange, kind: string): { cls: string; text: string } {
  const list = c.artifacts.filter((a) => a.kind === kind);
  if (!list.length) return { cls: "absent", text: T.sAbsent };
  const changed = list.filter((a) => a.delta !== "unchanged" || a.moved);
  if (!changed.length) return { cls: "present", text: T.sUnchanged };
  if (c.deleted) return { cls: "removed", text: T.sDeleted };
  return { cls: "changed", text: changed.some((a) => a.delta === "added" || a.moved) ? T.sAdded : T.sModified };
}
export interface PipelineStep {
  id: string;
  title: string;
  state: { cls: string; text: string };
  progress?: [number, number] | null;
}
export function pipelineSteps(c: SpecChange): PipelineStep[] {
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

// ── scenarios: GIVEN → WHEN → THEN as panels; AND/BUT belong to the panel above them ──
export const GWT = ["GIVEN", "WHEN", "THEN"] as const;
export type Gwt = (typeof GWT)[number];
export type GwtGroups = Record<Gwt, { but: boolean; t: string }[]>;
export function gwtGroups(sc: Scenario): GwtGroups {
  const g: GwtGroups = { GIVEN: [], WHEN: [], THEN: [] };
  let cur: Gwt = "GIVEN";
  for (const x of sc.steps) {
    const k = String(x.keyword).toUpperCase();
    if ((GWT as readonly string[]).includes(k)) cur = k as Gwt;
    g[cur].push({ but: k === "BUT", t: x.text });
  }
  return g;
}
export function flowButtons(r: Requirement, sc: Scenario): HTMLElement[] {
  return (ex?.flows ?? [])
    .filter((f) => f.scenario === `${r.id}#${sc.id}`)
    .map((f) =>
      h(
        "button",
        { class: "chip flow-chip", title: f.title, onclick: () => mapApi.showFlow?.(f.id) },
        icon("flow"),
        T.showFlow,
      ),
    );
}
// A scenario drawn as a flow: the state it starts from → the action → each outcome. Every AND/BUT line is a node of its
// column; several preconditions join into the arrow and several outcomes branch out of it.
export const GWT_ICON: Record<Gwt, string> = { GIVEN: "●", WHEN: "▶", THEN: "✓" };
export const GWT_FR: Record<Gwt, string> = { GIVEN: "1fr", WHEN: ".85fr", THEN: "1.15fr" };
export function gwtFlow(
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
export const gwtKeys = (gs: GwtGroups[]) => GWT.filter((k) => gs.some((g) => g[k].length));
/** One scenario; compact is the flow caption's version. */
export function scenarioStrip(r: Requirement, sc: Scenario, compact = false): HTMLElement {
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
export function scenarioTable(r: Requirement): HTMLElement {
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
export const scenarioView = (r: Requirement) =>
  r.scenarios.length > 1 ? scenarioTable(r) : scenarioStrip(r, r.scenarios[0] as Scenario);
export function reqRow(r: Requirement): HTMLElement {
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
export const sddApi: { open: (ids: string[]) => void } = { open: () => {} };
export function inspList(title: string, rows: Child): HTMLElement {
  return h("div", { class: "insp-list" }, h("h4", { text: title }), rows);
}
export function artifactBody(c: SpecChange, kind: string): HTMLElement[] | null {
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
export function sddPipeline(c: SpecChange): HTMLElement[] {
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
export function sddCoverage(): HTMLElement | null {
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

export function sddMatrix(): HTMLElement {
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
            ? h(
                "button",
                { class: "chip", onclick: () => mapApi.focus?.("architecture", mComps) },
                icon("locate"),
                T.showOnMap,
              )
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

export function renderSpec(): HTMLElement | null {
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
