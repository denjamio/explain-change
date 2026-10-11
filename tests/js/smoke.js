// Smoke test for template/app.js: runs a rendered report in a minimal DOM, plays the whole story with the arrow
// keys and clicks every element that listens for clicks. Any exception fails. No dependencies.
// Usage: node tests/js/smoke.js report.html  → prints {"elements", "text", "steps", "clicks"} as JSON.
"use strict";
const fs = require("fs");
const vm = require("vm");

class Node_ {
  constructor(tag, ns) {
    this.tagName = (tag || "").toUpperCase();
    this.namespaceURI = ns || null;
    this.attrs = {};
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.style = {};
    this._text = "";
    const self = this;
    this.classList = {
      _set() { return new Set((self.attrs.class || "").split(/\s+/).filter(Boolean)); },
      _put(set) { self.attrs.class = Array.from(set).join(" "); },
      add(...c) { const s = this._set(); c.forEach((x) => s.add(x)); this._put(s); },
      remove(...c) { const s = this._set(); c.forEach((x) => s.delete(x)); this._put(s); },
      contains(c) { return this._set().has(c); },
      toggle(c, force) {
        const s = this._set(); const on = force === undefined ? !s.has(c) : !!force;
        if (on) s.add(c); else s.delete(c); this._put(s); return on;
      },
    };
  }
  get children() { return this.childNodes.filter((n) => n.tagName); }
  get firstChild() { return this.childNodes[0] || null; }
  get id() { return this.attrs.id || ""; }
  set id(v) { this.attrs.id = v; }
  get className() { return this.attrs.class || ""; }
  set className(v) { this.attrs.class = v; }
  get textContent() { return this.tagName ? this.childNodes.map((n) => n.textContent).join("") : this._text; }
  set textContent(v) { this.childNodes = []; if (this.tagName) this.appendChild(new Text_(String(v))); else this._text = String(v); }
  set innerHTML(v) { this.childNodes = []; if (v) this.appendChild(new Text_(String(v))); }
  get innerHTML() { return this.textContent; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) {
    if (c instanceof Fragment_) { c.childNodes.slice().forEach((x) => this.appendChild(x)); c.childNodes = []; return c; }
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this; this.childNodes.push(c); return c;
  }
  insertBefore(c, ref) {
    if (!ref) return this.appendChild(c);
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); return c;
  }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...cs) { this.childNodes = []; cs.forEach((c) => this.appendChild(c)); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  dispatchEvent(ev) {
    ev.target = ev.target || this; ev.currentTarget = this;
    (this.listeners[ev.type] || []).slice().forEach((fn) => fn.call(this, ev));
    return true;
  }
  descendants() { const out = []; const walk = (n) => n.children.forEach((c) => { out.push(c); walk(c); }); walk(this); return out; }
  matches(sel) {  // one compound selector: tag, #id, .class and [attr], e.g. "a[data-sec]"
    const m = /^([a-zA-Z]*)((?:[#.][\w-]+|\[[\w-]+\])*)$/.exec(sel.trim());
    if (!m) throw new Error("smoke DOM: unsupported selector " + sel);
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    return (m[2].match(/[#.][\w-]+|\[[\w-]+\]/g) || []).every((p) =>
      p[0] === "#" ? this.id === p.slice(1) : p[0] === "." ? this.classList.contains(p.slice(1)) : p.slice(1, -1) in this.attrs);
  }
  querySelectorAll(sel) { return this.descendants().filter((n) => n.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let n = this; n && n.tagName; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, width: 1000, height: 600 }; }
  get clientWidth() { return 1000; }
  get clientHeight() { return 600; }
  scrollIntoView() {}
  focus() {}
  blur() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getContext() { return null; }
  pauseAnimations() {}
  unpauseAnimations() {}
}
class Text_ extends Node_ { constructor(t) { super(""); this._text = t; } }
class Fragment_ extends Node_ { constructor() { super("#fragment"); } }

function run(file) {
  const html = fs.readFileSync(file, "utf8");
  const data = /<script type="application\/json" id="ec-data">([\s\S]*?)<\/script>/.exec(html)[1];
  const scripts = html.match(/<script>([\s\S]*?)<\/script>/g);
  const js = scripts[scripts.length - 1].replace(/^<script>/, "").replace(/<\/script>$/, "");

  const documentElement = new Node_("html");
  const body = new Node_("body");
  documentElement.appendChild(body);
  const app = new Node_("div"); app.id = "app"; body.appendChild(app);
  const dataEl = new Node_("script"); dataEl.id = "ec-data"; dataEl.textContent = data; body.appendChild(dataEl);
  const docListeners = new Node_("#document");
  const document = {
    documentElement, body,
    createElement: (t) => new Node_(t),
    createElementNS: (ns, t) => new Node_(t, ns),
    createTextNode: (t) => new Text_(t),
    createDocumentFragment: () => new Fragment_(),
    getElementById: (id) => (documentElement.id === id ? documentElement : documentElement.querySelector("#" + id)),
    addEventListener: (t, fn) => docListeners.addEventListener(t, fn),
    dispatchEvent: (ev) => docListeners.dispatchEvent(ev),
  };
  const timers = [];
  const store = {};
  const win = {
    document, innerHeight: 800, innerWidth: 1200,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {},
    open() {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    getComputedStyle: () => ({ fontFamily: "sans-serif" }),
    requestAnimationFrame: (fn) => { timers.push(fn); return timers.length; },
    cancelAnimationFrame() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    console,
  };
  win.window = win;
  const context = vm.createContext(win);
  vm.runInContext(js, context, { filename: "app.js" });

  const flush = () => { for (let i = 0; i < 1000 && timers.length; i++) timers.shift()(performance.now() + 1e6); };
  flush();
  const ev = (type, extra) => Object.assign({ type, preventDefault() {}, stopPropagation() {} }, extra);
  const parsed = JSON.parse(data);
  const steps = Math.max(((parsed.insight || {}).story || []).length, 8);
  for (let i = 0; i < steps + 1; i++) { docListeners.dispatchEvent(ev("keydown", { key: "ArrowRight" })); flush(); }
  for (let i = 0; i < steps + 1; i++) { docListeners.dispatchEvent(ev("keydown", { key: "ArrowLeft" })); flush(); }
  let clicks = 0;
  for (const el of documentElement.descendants()) {
    if (!(el.listeners.click || []).length) continue;
    el.dispatchEvent(ev("click", { target: el, clientX: 10, clientY: 10, button: 0 }));
    flush();
    clicks++;
  }
  docListeners.dispatchEvent(ev("keydown", { key: "Escape" }));
  flush();
  return { elements: documentElement.descendants().length, text: app.textContent, steps, clicks };
}

process.stdout.write(JSON.stringify(run(process.argv[2])));
