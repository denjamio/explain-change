/** Code excerpts: the lines a story step, a decision or an entity points at, as a small diff. */
import type { FileFacts, Hunk } from "../src/contract/facts.ts";
import { h } from "./dom.ts";
import { facts, fileIndex } from "./model.ts";
import { fileLink } from "./ui.ts";
export function codeExcerpt(ref: string): HTMLElement | null {
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

export function excerpt(f: FileFacts, lines: string, ctxLines = 3): HTMLElement {
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

export function diffRows(
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
