/** Pieces every section draws with: file links, section shells, legend items, figures, and the map's handle. */

import type { Delta } from "../src/contract/facts.ts";
import { type Child, h } from "./dom.ts";
import { icon } from "./icons.ts";
import { prFileUrl } from "./model.ts";
import { T } from "./words.ts";
export function onOpen<E extends Element>(el: E, path: string): E {
  const url = prFileUrl(path);
  if (url) {
    el.classList.add("linked");
    el.addEventListener("click", () => window.open(url, "_blank", "noopener"));
  }
  return el;
}
/** A "file" or "file:line[-last]" reference; `old` when its line is on the base side (a removed symbol). */
export function fileLink(ref: string, label?: string, old?: boolean): HTMLElement {
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(ref || "");
  const path = m?.[1] ?? ref;
  const url = prFileUrl(path, m ? { start: Number(m[2]), end: Number(m[3] ?? m[2]), old } : undefined);
  return url
    ? h("a", {
        href: url,
        target: "_blank",
        rel: "noopener",
        class: "ref",
        text: label || ref,
        // Azure DevOps opens a line outside the PR: say so before the click.
        title: url.includes("_a=contents") ? T.lineOutsidePr : null,
      })
    : h("code", { class: "ref", text: label || ref });
}
/** A section: its title, one line with its figures, then the body. */
export function sectionShell(id: string, title: string, body: Child, lead?: string): HTMLElement {
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
export function legendItem(kind: string, color: string, label: string): HTMLElement {
  if (kind === "swatch") return h("span", null, h("i", { class: "swatch", style: `background:${color}` }), label);
  if (kind === "spec") return h("span", null, icon("spec"), label);
  if (kind === "ring") return h("span", { class: "since-only" }, h("i", { class: "legend-ring" }), label);
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

export function chip(v: number, label: string, cls?: string): HTMLElement {
  return h("span", { class: `stat-chip ${cls || ""}` }, h("b", { text: String(v) }), h("span", { text: label }));
}

/** Filled by the map once it is drawn: the other sections move it through these. */
export const mapApi: {
  inspect?: (id: string) => void;
  focus?: (view: string, ids: string[]) => void;
  showFlow?: (fid: string) => void;
} = {};

export function fieldDelta(f: string): Delta {
  const c = f.trim().charAt(0);
  return c === "+" ? "added" : c === "-" || c === "−" ? "removed" : c === "~" ? "changed" : "unchanged";
}
export const fieldText = (f: string) => (/^[+\-−~]/.test(f.trim()) ? f.trim().slice(1).trim() : f.trim());
export const FIELD_MARK: Record<Delta, string> = { added: "+", removed: "−", changed: "~", unchanged: "" };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface View {
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
