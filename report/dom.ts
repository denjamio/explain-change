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
export const measure = document.createElement("canvas").getContext("2d");
/**
 * Breaks a label into the lines it needs to fit maxW pixels: at spaces, else after a code separator
 * (`Orders::Refund.call`, `snake_case`, `a/b`), else mid-word. Only past maxLines does the last line end in "…".
 * `spacing` adds the CSS letter-spacing per character; `upper` measures it as text-transform: uppercase shows it.
 */
export function wrap(
  text: string,
  font: string,
  maxW: number,
  opts: { lines?: number; family?: string; spacing?: number; upper?: boolean } = {},
): string[] {
  const { lines: maxLines = 2, family, spacing = 0, upper = false } = opts;
  const width = (v: string) => {
    const t = v.trimEnd();
    return textWidth(upper ? t.toUpperCase() : t, font, family) + t.length * spacing;
  };
  const src = String(text ?? "");
  const pieces = src.match(/[^\s.:_/\-(,]*(?:::|[.:_/\-(,])?\s*/g) ?? [];
  const out: string[] = [];
  const starts: number[] = [];
  let line = "";
  let at = 0;
  const push = (v: string, start: number) => {
    out.push(v.trimEnd());
    starts.push(start);
  };
  let lineStart = 0;
  for (let p of pieces) {
    if (!p) continue;
    if (width(line + p) <= maxW) {
      line += p;
      at += p.length;
      continue;
    }
    if (line) push(line, lineStart);
    lineStart = at;
    // A piece wider than a whole line breaks between characters.
    while (width(p) > maxW && p.length > 1) {
      let n = p.length - 1;
      while (n > 1 && width(p.slice(0, n)) > maxW) n--;
      push(p.slice(0, n), lineStart);
      p = p.slice(n);
      at += n;
      lineStart = at;
    }
    line = p;
    at += p.length;
  }
  if (line.trim()) push(line, lineStart);
  if (out.length <= maxLines) return out.length ? out : [""];
  const kept = out.slice(0, maxLines);
  let last = src.slice(starts[maxLines - 1]).trimEnd();
  while (last.length > 1 && width(`${last}…`) > maxW) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}
/** An SVG text of several lines, one tspan each, the first on attrs.y and each next one lineH lower. */
export function textLines(
  attrs: Record<string, unknown> & { x: number; y: number },
  lines: string[],
  lineH: number,
): SVGElement {
  return s("text", attrs, ...lines.map((l, i) => s("tspan", { x: attrs.x, ...(i ? { dy: lineH } : {}), text: l })));
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
