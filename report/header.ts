/*
 * The page header: the change's title, its numbers, the TL;DR and goal, and the PR links.
 */

import { append, type Child, fmt, h } from "./dom.ts";
import { cfg, DATA, ex, facts, OS, REQS, src, st } from "./model.ts";
import { chip } from "./ui.ts";
import { T } from "./words.ts";

// ═════════════════════════════ header ═════════════════════════════
export function renderHeader(): HTMLElement {
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
