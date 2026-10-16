/**
 * A minimal DOM, enough to run a rendered report end to end without a browser: render it, play the whole story with
 * the arrow keys and click every element that listens for clicks. Any exception fails the test.
 */
import { runInNewContext } from "node:vm";

type Listener = (this: FakeNode, ev: FakeEvent) => void;
interface FakeEvent {
  type: string;
  target?: FakeNode;
  currentTarget?: FakeNode;
  [k: string]: unknown;
}

class FakeNode {
  tagName: string;
  attrs: Record<string, string> = {};
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  listeners: Record<string, Listener[]> = {};
  style: Record<string, string> & { setProperty(k: string, v: string): void; removeProperty(k: string): void };
  hidden = false;
  open = false;
  disabled = false;
  title = "";
  protected text = "";
  classList: {
    add(...c: string[]): void;
    remove(...c: string[]): void;
    contains(c: string): boolean;
    toggle(c: string, force?: boolean): boolean;
  };

  constructor(
    tag = "",
    readonly namespaceURI: string | null = null,
  ) {
    this.tagName = tag.toUpperCase();
    const style: Record<string, string> = {};
    this.style = Object.assign(style, {
      setProperty: (k: string, v: string) => {
        style[k] = v;
      },
      removeProperty: (k: string) => {
        delete style[k];
      },
    });
    const set = () => new Set((this.attrs.class ?? "").split(/\s+/).filter(Boolean));
    const put = (s: Set<string>) => {
      this.attrs.class = [...s].join(" ");
    };
    this.classList = {
      add: (...c) => put(new Set([...set(), ...c])),
      remove: (...c) => put(new Set([...set()].filter((x) => !c.includes(x)))),
      contains: (c) => set().has(c),
      toggle: (c, force) => {
        const s = set();
        const on = force === undefined ? !s.has(c) : Boolean(force);
        if (on) s.add(c);
        else s.delete(c);
        put(s);
        return on;
      },
    };
  }
  get children(): FakeNode[] {
    return this.childNodes.filter((n) => n.tagName);
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get id() {
    return this.attrs.id ?? "";
  }
  get textContent(): string {
    return this.tagName ? this.childNodes.map((n) => n.textContent).join("") : this.text;
  }
  set textContent(v: string) {
    this.childNodes = [];
    if (this.tagName) this.appendChild(new FakeText(String(v)));
    else this.text = String(v);
  }
  setAttribute(k: string, v: unknown) {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string) {
    return k in this.attrs ? (this.attrs[k] as string) : null;
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  appendChild(c: FakeNode): FakeNode {
    if (c instanceof FakeFragment) {
      for (const x of [...c.childNodes]) this.appendChild(x);
      c.childNodes = [];
      return c;
    }
    c.parentNode?.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c: FakeNode) {
    this.childNodes = this.childNodes.filter((x) => x !== c);
    c.parentNode = null;
    return c;
  }
  addEventListener(t: string, fn: Listener) {
    this.listeners[t] = [...(this.listeners[t] ?? []), fn];
  }
  removeEventListener(t: string, fn: Listener) {
    this.listeners[t] = (this.listeners[t] ?? []).filter((f) => f !== fn);
  }
  dispatchEvent(ev: FakeEvent) {
    ev.target ??= this;
    ev.currentTarget = this;
    for (const fn of [...(this.listeners[ev.type] ?? [])]) fn.call(this, ev);
    return true;
  }
  descendants(): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => {
      for (const c of n.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  /** One compound selector: tag, #id, .class and [attr], e.g. "a[data-sec]". */
  matches(sel: string): boolean {
    const m = /^([a-zA-Z]*)((?:[#.][\w-]+|\[[\w-]+\])*)$/.exec(sel.trim());
    if (!m) throw new Error(`fake DOM: unsupported selector ${sel}`);
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    return (m[2]?.match(/[#.][\w-]+|\[[\w-]+\]/g) ?? []).every((p) =>
      p[0] === "#"
        ? this.id === p.slice(1)
        : p[0] === "."
          ? this.classList.contains(p.slice(1))
          : p.slice(1, -1) in this.attrs,
    );
  }
  querySelectorAll(sel: string) {
    const parts = sel.split(/\s+/);
    const last = parts.pop() as string;
    return this.descendants().filter((n) => n.matches(last) && parts.every((p) => ancestorMatches(n, p)));
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600 };
  }
  get clientWidth() {
    return 1000;
  }
  get clientHeight() {
    return 600;
  }
  get scrollWidth() {
    return 1000;
  }
  get scrollHeight() {
    return 600;
  }
  get offsetTop() {
    return 0;
  }
  get offsetWidth() {
    return 100;
  }
  get offsetHeight() {
    return 100;
  }
  scrollIntoView() {}
  scrollTo() {}
  focus() {}
  setPointerCapture() {}
  pauseAnimations() {}
  unpauseAnimations() {}
  getContext() {
    return null;
  }
}
function ancestorMatches(n: FakeNode, sel: string): boolean {
  for (let p = n.parentNode; p; p = p.parentNode) if (p.tagName && p.matches(sel)) return true;
  return false;
}
class FakeText extends FakeNode {
  constructor(t: string) {
    super("");
    this.text = t;
  }
}
class FakeFragment extends FakeNode {
  constructor() {
    super("#fragment");
  }
}

export interface SmokeResult {
  elements: number;
  text: string;
  clicks: number;
}

/** Runs the report's script against its embedded data in the fake DOM. */
export function smoke(html: string): SmokeResult {
  const data = /<script type="application\/json" id="ec-data">([\s\S]*?)<\/script>/.exec(html)?.[1] as string;
  const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) as string[];
  const js = (scripts[scripts.length - 1] as string).replace(/^<script>/, "").replace(/<\/script>$/, "");
  const html_ = new FakeNode("html");
  const body = new FakeNode("body");
  html_.appendChild(body);
  const app = new FakeNode("div");
  app.setAttribute("id", "app");
  body.appendChild(app);
  const dataEl = new FakeNode("script");
  dataEl.setAttribute("id", "ec-data");
  dataEl.textContent = data;
  body.appendChild(dataEl);
  const docListeners = new FakeNode("#document");
  const timers: ((t: number) => void)[] = [];
  const store: Record<string, string> = {};
  const document = {
    documentElement: html_,
    body,
    createElement: (t: string) => new FakeNode(t),
    createElementNS: (ns: string, t: string) => new FakeNode(t, ns),
    createTextNode: (t: string) => new FakeText(t),
    createDocumentFragment: () => new FakeFragment(),
    getElementById: (id: string) => html_.querySelector(`#${id}`),
    addEventListener: (t: string, fn: Listener) => docListeners.addEventListener(t, fn),
    dispatchEvent: (ev: FakeEvent) => docListeners.dispatchEvent(ev),
  };
  const win: Record<string, unknown> = {
    document,
    innerHeight: 800,
    innerWidth: 1200,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {},
    open() {},
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => (store[k] = String(v)),
    },
    getComputedStyle: () => ({ fontFamily: "sans-serif" }),
    requestAnimationFrame: (fn: (t: number) => void) => timers.push(fn),
    cancelAnimationFrame() {},
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout() {},
    CustomEvent: class {
      detail: unknown;
      constructor(
        readonly type: string,
        init?: { detail?: unknown },
      ) {
        this.detail = init?.detail;
      }
    },
    console,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    RegExp,
    Error,
    encodeURIComponent,
  };
  win.window = win;
  runInNewContext(js, win, { filename: "report.js" });
  const flush = () => {
    for (let i = 0; i < 1000 && timers.length; i++) (timers.shift() as (t: number) => void)(1e9);
  };
  flush();
  const ev = (type: string, extra: Record<string, unknown> = {}): FakeEvent => ({
    type,
    preventDefault() {},
    stopPropagation() {},
    ...extra,
  });
  for (let i = 0; i < 10; i++) {
    docListeners.dispatchEvent(ev("keydown", { key: "ArrowRight" }));
    flush();
  }
  for (let i = 0; i < 10; i++) {
    docListeners.dispatchEvent(ev("keydown", { key: "ArrowLeft" }));
    flush();
  }
  let clicks = 0;
  for (const el of html_.descendants()) {
    if (!el.listeners.click?.length) continue;
    el.dispatchEvent(ev("click", { target: el, clientX: 10, clientY: 10, button: 0 }));
    flush();
    clicks++;
  }
  docListeners.dispatchEvent(ev("keydown", { key: "Escape" }));
  flush();
  return { elements: html_.descendants().length, text: app.textContent, clicks };
}
