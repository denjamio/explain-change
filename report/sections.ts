/*
 * The sections below the map, in reading order: why it is built this way (decisions), then where it changed (files).
 */

import type { ComponentFacts, FileFacts } from "../src/contract/facts.ts";
import { fmt, h, listAt } from "./dom.ts";
import {
  byCompRank,
  changeComp,
  compById,
  compName,
  deltaLabel,
  ex,
  facts,
  gitLetter,
  layerName,
  summaryOf,
} from "./model.ts";
import { fileLink, mapApi, sectionShell } from "./ui.ts";
import { T, tf } from "./words.ts";

// Order of reading: why it is built this way (decisions) → what the spec asks (SDD) → where it changed (files).

/** Why the change is built this way: the agent's design decisions, each with its main alternative. */
export function renderDecisions(): HTMLElement | null {
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
            h("span", { class: `badge basis basis-${d.basis}`, title: T.basisHint, text: T[`basis_${d.basis}`] }),
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
export function renderChanges(): HTMLElement | null {
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
