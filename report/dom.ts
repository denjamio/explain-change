/** DOM and text helpers: no data, no state beyond the canvas that measures labels. */
export type Child = Node | string | number | null | undefined | false | Child[];
export type Attrs = Record<string, unknown> | null;
export const SVGNS = "http://www.w3.org/2000/svg";

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const c of children) append(el, c);
  return el;
}
export function s(tag: string, attrs?: Attrs, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVGNS, tag) as SVGElement;
  setAttrs(el, attrs);
  for (const c of children) append(el, c);
  return el;
}
export function setAttrs(el: Element, attrs?: Attrs) {
  if (!attrs) return;
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.setAttribute("class", String(v));
    else if (k === "text") el.textContent = String(v);
    else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
}
export function append(el: Node, child: Child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(el, c);
    return;
  }
  el.appendChild(
    typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child,
  );
}
/** Per-viewer conveniences in localStorage (remembered heights, theme, motion); the page works without them. */
export function store<V>(key: string, value?: V | null): V | null {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
  return null;
}
export const fmt = (n: number) => Number(n).toLocaleString("en-US");
export function trunc(text: unknown, n: number): string {
  const v = String(text ?? "");
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}
// Shortens a label to the pixels it has (character counts misjudge wide letters and bold faces).
export const measure = document.createElement("canvas").getContext("2d");
export function fit(text: string, font: string, maxW: number): string {
  let v = String(text || "");
  if (!measure) return v;
  measure.font = `${font} ${getComputedStyle(document.body).fontFamily}`;
  if (measure.measureText(v).width <= maxW) return v;
  while (v.length > 1 && measure.measureText(`${v}…`).width > maxW) v = v.slice(0, -1);
  return `${v.trimEnd()}…`;
}
/** The list stored under `key`, created on first use. */
export function listAt<T>(o: Record<string, T[]>, key: string): T[] {
  let list = o[key];
  if (!list) {
    list = [];
    o[key] = list;
  }
  return list;
}
/** A label's width in pixels, measured when the browser can (estimated per character otherwise). */
export const MONO = 'ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, Consolas, monospace';
export function textWidth(text: string, font: string, family?: string): number {
  if (!measure) return text.length * 7;
  measure.font = `${font} ${family ?? getComputedStyle(document.body).fontFamily}`;
  return measure.measureText(text).width;
}
export const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
export const r1 = (n: number) => Math.round(n * 10) / 10;
