/** The inspector's content: what a component or an entity of the map is, does and touches in this change. */
import type { NormalizedExplanation } from "../src/contract/explanation.ts";
import type { Delta, DependencyFacts } from "../src/contract/facts.ts";
import { codeExcerpt } from "./code.ts";
import { type Child, h } from "./dom.ts";
import {
  changeComp,
  compById,
  compName,
  DM,
  deltaLabel,
  type Entity,
  entById,
  facts,
  gitLetter,
  isNewViolation,
  layerName,
  reqsOfComp,
  summaryOf,
} from "./model.ts";
import { inspList, reqRow } from "./sdd.ts";
import { FIELD_MARK, fieldDelta, fieldText, fileLink } from "./ui.ts";
import { T } from "./words.ts";

/** Where the inspector's links lead: back to the story, or to another component or entity. */
export interface InspectorNav {
  back: () => void;
  inspect: (id: string) => void;
  entity: (eid: string) => void;
}

/** A component: its delta, layer and figures, summary, files, symbols, dependencies and requirements. */
export function componentDetails(id: string, nav: InspectorNav): Child[] {
  const c = compById[id];
  const n = changeComp[id] ?? { id, delta: "unchanged" as Delta, files: 0, additions: 0, deletions: 0 };
  const files = facts.files.filter((f) => f.component === id);
  const syms = facts.symbols.filter((sy) => files.some((f) => f.path === sy.file));
  const outE = facts.dependencies.filter((e) => e.from === id);
  const inE = facts.dependencies.filter((e) => e.to === id);
  const reqs = reqsOfComp(id);
  return [
    h("button", { class: "back", text: `← ${T.back}`, onclick: nav.back }),
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
              fileLink(`${sy.file}:${sy.line}`, sy.name, sy.delta === "removed"),
            ),
          ),
        )
      : null,
    outE.length ? inspList(T.dependsOn, outE.map(edgeRow((e) => e.to, nav))) : null,
    inE.length ? inspList(T.usedBy, inE.map(edgeRow((e) => e.from, nav))) : null,
    reqs.length ? inspList(T.reqs, reqs.map(reqRow)) : null,
  ];
}

/** An entity of the data model: its delta, component, fields, relations and evidence. */
export function entityDetails(eid: string, nav: InspectorNav): Child[] {
  const e = entById[eid] as Entity;
  const dm = DM as NormalizedExplanation["dataModel"];
  const rels = dm.relations.filter((r) => r.from === eid || r.to === eid);
  const fields = e.fields ?? [];
  return [
    h("button", { class: "back", text: `← ${T.back}`, onclick: nav.back }),
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
              nav.inspect(e.component as string);
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
                  nav.entity(other);
                },
              }),
            );
          }),
        )
      : null,
    e.evidence ? h("div", { class: "insp-list" }, h("h4", { text: T.evidence }), codeExcerpt(e.evidence)) : null,
  ];
}

function edgeRow(other: (e: DependencyFacts) => string, nav: InspectorNav) {
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
          nav.inspect(other(e));
        },
      }),
      e.examples[0] ? fileLink(e.examples[0], e.examples[0].split("/").pop()) : null,
    );
  };
}
