/*
 * The map and its story: view tabs, the camera, the step cards, the inspector and the legend.
 */

import { type ArchMode, buildArchitecture } from "./arch.ts";
import { createCamera } from "./camera.ts";
import { codeExcerpt } from "./code.ts";
import { buildData } from "./data-view.ts";
import { append, cap, h, store } from "./dom.ts";
import { buildFlow, flowNotes } from "./flow.ts";
import { icon, viewIcon } from "./icons.ts";
import { componentDetails, entityDetails, type InspectorNav } from "./inspector.ts";
import { changeComp, type NFlow, REDUCED, reqById, type StoryStep, specComponents, st } from "./model.ts";
import { sddApi } from "./sdd.ts";
import { CONTEXT_COUNT, flowById, isContext, STORY, storyIsAuto, VIEWS, viewTitle } from "./story.ts";
import { type Box, legendItem, mapApi, type View } from "./ui.ts";
import { T, t } from "./words.ts";

export function renderMap(): HTMLElement {
  const compactQ = window.matchMedia ? window.matchMedia("(max-width: 720px)") : { matches: false };
  let archMode: ArchMode = store<ArchMode>("ec:arch-mode") ?? "delta";
  let motion = store<boolean>("ec:motion");
  if (motion === null) motion = !REDUCED;
  let current: View | null = null;
  let withContext = false;
  let stepIdx = 0;
  let inspecting: string | null = null;
  const cache: Record<string, View> = {};

  const viewport = h("div", { class: "viewport", tabindex: "0", "aria-label": T.canvas });
  const tabs = h("div", { class: "view-tabs", role: "tablist" });
  const seg = h("div", { class: "seg arch-only" });
  for (const m of ["delta", "after", "before"] as ArchMode[]) {
    seg.appendChild(
      h("button", {
        class: m === archMode ? "on" : "",
        "data-m": m,
        text: t(m),
        title: t(`mode${cap(m)}`),
        onclick: () => {
          archMode = m;
          store("ec:arch-mode", m);
          for (const b of Array.from(seg.children)) b.classList.toggle("on", b.getAttribute("data-m") === m);
          if (current && current.id === "architecture") show("architecture", lastFocus, false);
        },
      }),
    );
  }
  const motionBtn = h("button", {
    class: "icon-btn",
    title: T.motion,
    "aria-pressed": String(motion),
    onclick: () => setMotion(!motion),
  });
  // The bar holds what the diagram shows (the view, and before/after for the architecture); the zoom controls float
  // over the canvas, out of the way until needed.
  const contextBtn = CONTEXT_COUNT
    ? h("button", {
        class: "chip context-toggle",
        "aria-pressed": "false",
        title: T.contextHint,
        text: `${T.context} · ${CONTEXT_COUNT}`,
        onclick: () => setContext(!withContext),
      })
    : null;
  function setContext(on: boolean) {
    withContext = on;
    contextBtn?.classList.toggle("on", on);
    contextBtn?.setAttribute("aria-pressed", String(on));
    if (current && current.id === "architecture") show("architecture", lastFocus, false);
  }
  const archTools = h("div", { class: "arch-tools" }, contextBtn, seg);
  const tools = h("div", { class: "canvas-tools" }, archTools);
  const zoomTools = h(
    "div",
    { class: "zoom-tools" },
    h("button", { class: "icon-btn", title: T.zoomOut, text: "−", onclick: () => zoom(1.25) }),
    h("button", { class: "icon-btn wide", title: T.fit, text: T.fit, onclick: () => current && fly(fullBox(), true) }),
    h("button", { class: "icon-btn", title: T.zoomIn, text: "+", onclick: () => zoom(0.8) }),
    motionBtn,
  );
  // One tab per view: architecture │ flows │ data. A title is never cut while it fits; when the bar runs out of room
  // it ends in "…" and the tooltip shows it whole.
  let lastKind: string | null = null;
  for (const v of VIEWS) {
    const kind = v.flow ? "flow" : v.id;
    if (lastKind && kind !== lastKind) tabs.appendChild(h("span", { class: "view-sep", "aria-hidden": "true" }));
    lastKind = kind;
    const label = h("span", { class: "view-label", text: v.title });
    tabs.appendChild(
      h(
        "button",
        {
          role: "tab",
          class: `view-tab${v.flow ? " flow" : ""}`,
          "data-view": v.id,
          "aria-label": v.title,
          onmouseenter(this: HTMLElement) {
            const tip = (label.scrollWidth > label.clientWidth ? [v.title] : []).concat(
              v.flow?.trigger ? [v.flow.trigger] : [],
            );
            if (tip.length) this.title = tip.join("\n");
            else this.removeAttribute("title");
          },
          onclick: () => {
            closeInspector();
            show(v.id, [], true);
          },
        },
        label,
      ),
    );
  }
  const caption = h("div", { class: "view-caption" });
  const legend = h("div", { class: "diagram-legend" });

  // ── camera ──
  const { apply, frame, fly, zoom, fullBox, box: viewBox } = createCamera(viewport, () => current);

  // ── lighting ──
  let lastFocus: string[] = [];
  function light(ids: string[]): string[] {
    const view = current as View;
    let set: Record<string, boolean> = {};
    for (const id of ids) {
      const k = view.keyOf(id);
      if (k) set[k] = true;
    }
    const focused = Object.keys(set).length > 0;
    if (focused) set = view.expand(set);
    view.svg.classList.toggle("dim", focused);
    for (const el of Array.from(view.svg.querySelectorAll("[data-k]"))) {
      const k = el.getAttribute("data-k") as string;
      if (k.slice(0, 2) === "e:") continue;
      el.classList.toggle("on", Boolean(set[k]));
    }
    for (const el of Array.from(view.svg.querySelectorAll("[data-a]"))) {
      const a = el.getAttribute("data-a") as string;
      const b = el.getAttribute("data-b") as string;
      if (el.classList.contains("lifeline")) {
        el.classList.toggle("on", Boolean(set[a]));
        continue;
      }
      const ka = view.keyOf(a) || a;
      const kb = view.keyOf(b) || b;
      el.classList.toggle("on", Boolean((set[a] || set[ka]) && (set[b] || set[kb])));
    }
    return Object.keys(set);
  }
  function boxOf(keys: string[]): Box | null {
    const bs = keys.map((k) => current?.geo[k]).filter((b): b is Box => Boolean(b));
    if (!bs.length) return null;
    const x1 = Math.min(...bs.map((b) => b.x));
    const y1 = Math.min(...bs.map((b) => b.y));
    const x2 = Math.max(...bs.map((b) => b.x + b.w));
    const y2 = Math.max(...bs.map((b) => b.y + b.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  // ── views ──
  function viewFor(id: string): View {
    const compact = compactQ.matches;
    const key = `${id}|${compact}|${id === "architecture" ? `${archMode}|${withContext}` : ""}`;
    const hit = cache[key];
    if (hit) return hit;
    let V: View;
    if (id === "architecture") V = buildArchitecture(archMode, compact, withContext, wireNode);
    else if (id === "data") V = buildData(wireNode);
    else V = buildFlow(flowById[id.slice(5)] as NFlow);
    cache[key] = V;
    return V;
  }
  function wireNode(g: SVGElement, id: string) {
    g.addEventListener("mouseenter", () => {
      if (!inspecting) light([id]);
    });
    g.addEventListener("mouseleave", () => {
      if (!inspecting) light(lastFocus);
    });
    g.addEventListener("click", () => inspect(id));
    g.addEventListener("keydown", (ev) => {
      const key = (ev as KeyboardEvent).key;
      if (key === "Enter" || key === " ") {
        ev.preventDefault();
        inspect(id);
      }
    });
  }
  function show(viewId: string, focusIds: string[], animate: boolean) {
    // Requirements have no diagram of their own: a requirement lights the components that implement it.
    let id = viewId;
    let focus = focusIds;
    if (id === "requirements") {
      focus = specComponents(focus || []);
      id = "architecture";
    }
    const prev = current;
    current = viewFor(id);
    if (prev !== current) {
      viewport.textContent = "";
      if (current.empty) viewport.appendChild(h("p", { class: "empty canvas-empty", text: current.empty }));
      viewport.appendChild(current.svg);
      if (!motion) {
        try {
          (current.svg as SVGSVGElement).pauseAnimations();
        } catch {
          // no SMIL: nothing to pause
        }
      }
      const shown = viewBox();
      apply(prev && prev.id === current.id && shown ? shown : fullBox());
    }
    for (const b of Array.from(tabs.querySelectorAll(".view-tab"))) {
      const on = b.getAttribute("data-view") === id;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
    archTools.style.display = id === "architecture" ? "" : "none";
    lastFocus = focus || [];
    const keys = light(lastFocus);
    // Narrow screens frame only what the step names; wide ones also keep what lights up with it in view.
    const view = current;
    const primary = lastFocus.map((x) => view.keyOf(x));
    const box = keys.length ? (compactQ.matches && boxOf(primary)) || boxOf(keys) : null;
    // Never zoom past ~1.4× of the fitted view: the reader keeps the lanes around the focus in sight.
    fly(
      box ? frame(box, 64, Math.min(view.W, compactQ.matches ? 340 : Math.max(760, view.W * 0.62))) : fullBox(),
      animate,
    );
    renderCaption(id);
  }
  function renderCaption(id: string) {
    caption.textContent = "";
    legend.textContent = "";
    // Only what the current diagram draws, grouped by what it is (boxes, arrows):
    // [kind, color, label, selector of an element that uses it, group].
    const keys: Record<string, [string, string, string, string, string?][]> = {
      architecture: [
        ["swatch", "var(--added)", T.lAdded, ".node.st-added", T.lgComponents],
        ["swatch", "var(--changed)", T.lChanged, ".node.st-changed"],
        ["swatch", "var(--removed)", T.lRemoved, ".node.st-removed"],
        ["swatch", "var(--unchanged)", T.lNeighbor, ".node.st-unchanged"],
        ["line dashed", "var(--added)", T.lAdded, ".edge.e-added", T.lgDependencies],
        ["line", "var(--changed)", T.lMoreRefs, ".edge.e-changed"],
        ["line", "var(--unchanged)", T.lUnchanged, ".edge.e-unchanged"],
        ["line dashed", "var(--removed)", T.lRemoved, ".edge.e-removed"],
        ["line", "var(--violation)", T.lViolation, ".edge.e-violation"],
        ["line", "var(--accent)", T.lKey, ".edge-g.key"],
        ["spec", "", T.lReqBadge, ".req-badge", T.lgRequirements],
      ],
      flow: [
        ["line", "var(--added)", T.lAdded, ".msg.st-added", T.lgSteps],
        ["line", "var(--changed)", T.lChanged, ".msg.st-changed"],
        ["line", "var(--muted)", T.lUnchanged, ".msg.st-unchanged"],
        ["line dashed", "var(--removed)", T.lRemoved, ".msg.st-removed"],
      ],
      data: [
        ["swatch", "var(--added)", T.lAdded, ".entity.st-added", T.lgEntities],
        ["swatch", "var(--changed)", T.lChanged, ".entity.st-changed"],
        ["swatch", "var(--removed)", T.lRemoved, ".entity.st-removed"],
        ["swatch", "var(--unchanged)", T.lUnchanged, ".entity.st-unchanged"],
      ],
    };
    const list = keys[id.slice(0, 5) === "flow:" ? "flow" : id] ?? [];
    let group: HTMLElement | null = null;
    let label = "";
    for (const k of list) {
      if (k[4]) label = k[4];
      if (!current?.svg.querySelector(k[3])) continue;
      if (!group || group.getAttribute("data-group") !== label) {
        group = h("span", { class: "legend-group", "data-group": label }, h("b", { text: label }));
        legend.appendChild(group);
      }
      group.appendChild(legendItem(k[0], k[1], k[2]));
    }
    if (id === "architecture") {
      const foot: string[] = [];
      if (st.unresolved) foot.push(`${st.unresolved} ${st.unresolved === 1 ? T.unresolved1 : T.unresolved}`);
      if (st.unmapped.length) foot.push(`${st.unmapped.length} ${st.unmapped.length === 1 ? T.unmapped1 : T.unmapped}`);
      if (foot.length) caption.appendChild(h("span", { class: "faint", text: foot.join(" · ") }));
    } else if (id.slice(0, 5) === "flow:") {
      for (const n of flowNotes(flowById[id.slice(5)] as NFlow)) caption.appendChild(n);
    }
  }

  // ── story panel ──
  const storyList = h("ol", { class: "story-steps" });
  const counter = h("span", { class: "story-count" });
  const storyPane = h(
    "div",
    { class: "story-pane" },
    h(
      "div",
      { class: "story-head" },
      h("b", { text: T.story }),
      counter,
      h(
        "div",
        { class: "story-nav" },
        h("button", { class: "icon-btn", title: T.prev, text: "←", onclick: () => step(stepIdx - 1) }),
        h("button", { class: "icon-btn", title: T.next, text: "→", onclick: () => step(stepIdx + 1) }),
      ),
    ),
    storyIsAuto ? h("p", { class: "story-auto faint", text: T.storyAuto }) : null,
    storyList,
  );
  const inspector = h("div", { class: "inspector", hidden: true });
  const side = h("aside", { class: "map-side" }, storyPane, inspector);
  const items = STORY.map((stp, i) => {
    const li = h(
      "li",
      { class: "story-step", tabindex: "0" },
      h(
        "button",
        { class: "step-head", onclick: () => step(i) },
        h("span", { class: "step-n", text: String(i + 1) }),
        h("span", { class: "step-h", text: stp.heading }),
      ),
      h(
        "div",
        { class: "step-body" },
        h("p", { text: stp.body }),
        h(
          "div",
          { class: "step-meta" },
          h(
            "span",
            { class: "step-view" },
            icon(viewIcon(stp.view ?? "architecture")),
            viewTitle(stp.view ?? "architecture"),
          ),
          stp.view === "requirements"
            ? h("button", {
                class: "chip step-link",
                text: `${T.seeReqs} ↓`,
                onclick: () => sddApi.open((stp.focus ?? []).filter((x) => reqById[x])),
              })
            : null,
          h("button", {
            class: "chip step-next",
            text: i < STORY.length - 1 ? `${T.nextStep} →` : `↺ ${T.restart}`,
            onclick: () => step(i < STORY.length - 1 ? i + 1 : 0),
          }),
        ),
      ),
    );
    storyList.appendChild(li);
    return li;
  });
  /** A step the reader asked for: the workspace comes into view when it is not whole on screen. */
  function step(i: number) {
    go(i);
    const r = root.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight)
      root.scrollIntoView({ block: "start", behavior: REDUCED ? "auto" : "smooth" });
  }
  function go(i: number) {
    if (!STORY.length) return show("architecture", [], false);
    stepIdx = Math.max(0, Math.min(STORY.length - 1, i));
    closeInspector();
    const stp = STORY[stepIdx] as StoryStep;
    items.forEach((li, j) => {
      li.classList.toggle("active", j === stepIdx);
      li.classList.toggle("seen", j < stepIdx);
    });
    counter.textContent = `${stepIdx + 1} / ${STORY.length}`;
    showCode(stp.code);
    show(stp.view ?? "architecture", stp.focus ?? [], true);
    const li = items[stepIdx];
    if (li && storyList.scrollHeight > storyList.clientHeight) {
      storyList.scrollTo({ top: li.offsetTop - storyList.offsetTop - 8, behavior: REDUCED ? "auto" : "smooth" });
    }
  }

  // ── code of the active step, under the map in the same column: map, story and code fit one screen ──
  const codePane = h("div", { class: "map-code", hidden: true });
  function showCode(ref?: string | null) {
    codePane.textContent = "";
    const ex2 = ref ? codeExcerpt(ref) : null;
    if (ex2) codePane.appendChild(ex2);
    codePane.hidden = codeSplit.hidden = !ex2 || Boolean(inspecting);
  }
  const MIN_CODE = 96;
  /** The code takes at most 60% of the column: the map always keeps the larger part. */
  const maxCode = () => Math.round((mainCol.clientHeight || window.innerHeight) * 0.6);
  const clampCode = (px: number) => Math.round(Math.max(MIN_CODE, Math.min(maxCode(), px)));
  // Set by the reader, the code area is exactly that tall; by default it fits the excerpt, up to a third of the window.
  function setCodeHeight(px: number | null, save: boolean) {
    codePane.classList.toggle("sized", px !== null);
    if (px === null) codePane.style.removeProperty("--code-h");
    else codePane.style.setProperty("--code-h", `${clampCode(px)}px`);
    if (save) store("ec:code-h", px === null ? null : clampCode(px));
  }
  // A drag handle above the code: drag or arrow keys change its height, double-click or Home restores the default.
  function splitter(getH: () => number, setH: (px: number | null, save: boolean) => void): HTMLElement {
    const el = h(
      "div",
      {
        class: "splitter",
        role: "separator",
        tabindex: "0",
        "aria-orientation": "horizontal",
        "aria-label": T.resize,
        title: T.resize,
      },
      h("span", { class: "grip" }),
    );
    let start: { y: number; h: number } | null = null;
    el.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.button) return;
      ev.preventDefault();
      start = { y: ev.clientY, h: getH() };
      el.classList.add("dragging");
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        // not capturable: dragging still works while the pointer stays on the handle
      }
    });
    // The handle sits above the code: dragging it down makes the code shorter.
    el.addEventListener("pointermove", (ev: PointerEvent) => {
      if (start) setH(start.h - (ev.clientY - start.y), false);
    });
    const end = () => {
      if (start) {
        start = null;
        el.classList.remove("dragging");
        setH(getH(), true);
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("dblclick", () => setH(null, true));
    el.addEventListener("keydown", (ev: KeyboardEvent) => {
      const d = ({ ArrowUp: 40, ArrowDown: -40, PageUp: 160, PageDown: -160 } as Record<string, number>)[ev.key];
      if (ev.key === "Home") {
        ev.preventDefault();
        setH(null, true);
      } else if (d) {
        ev.preventDefault();
        ev.stopPropagation();
        setH(getH() + d, true);
      }
    });
    return el;
  }
  const codeSplit = splitter(() => codePane.offsetHeight, setCodeHeight);
  codeSplit.hidden = true;

  // ── inspector ──
  const nav: InspectorNav = {
    back: () => go(stepIdx),
    inspect: (id) => inspect(id),
    entity: (eid) => inspectEntity(eid),
  };
  function inspect(key: string) {
    if (key.slice(0, 4) === "req:") return sddApi.open([key.slice(4)]);
    if (key.slice(0, 4) === "ent:") return inspectEntity(key.slice(4));
    const id = key.replace(/^comp:/, "");
    const hidden = changeComp[id];
    if (hidden && isContext(hidden) && !withContext) setContext(true);
    inspecting = id;
    inspector.textContent = "";
    append(inspector, componentDetails(id, nav));
    storyPane.hidden = true;
    codePane.hidden = codeSplit.hidden = true;
    inspector.hidden = false;
    let viewId = current?.id ?? "architecture";
    if (viewId.slice(0, 5) === "flow:" && !current?.geo[`p:${id}`]) viewId = "architecture";
    show(viewId, [id], true);
    inspecting = id;
  }
  function inspectEntity(eid: string) {
    inspector.textContent = "";
    append(inspector, entityDetails(eid, nav));
    storyPane.hidden = true;
    codePane.hidden = codeSplit.hidden = true;
    inspector.hidden = false;
    show("data", [eid], true);
    inspecting = eid;
  }
  function closeInspector() {
    inspecting = null;
    inspector.hidden = true;
    storyPane.hidden = false;
    codePane.hidden = codeSplit.hidden = !codePane.firstChild;
  }

  function setMotion(on: boolean) {
    motion = on;
    store("ec:motion", on);
    root.classList.toggle("still", !on);
    motionBtn.textContent = on ? "❚❚" : "▶";
    motionBtn.setAttribute("aria-pressed", String(on));
    for (const k of Object.keys(cache)) {
      try {
        const svg = (cache[k] as View).svg as SVGSVGElement;
        if (on) svg.unpauseAnimations();
        else svg.pauseAnimations();
      } catch {
        // no SMIL: nothing to pause
      }
    }
  }

  // The workspace: the map and the step's code on the left, the story on the right, as tall as the window.
  const mainCol = h(
    "div",
    { class: "map-main" },
    h(
      "div",
      { class: "map-canvas" },
      h("div", { class: "view-wrap" }, viewport, zoomTools),
      h("div", { class: "map-foot" }, legend, caption, h("span", { class: "hint faint", text: T.canvasHint })),
    ),
    codeSplit,
    codePane,
  );
  const root = h(
    "section",
    { class: "map", id: "map" },
    h("div", { class: "map-bar" }, tabs, tools),
    h("div", { class: "map-body" }, mainCol, side),
  );
  setMotion(motion);
  const savedCode = store<number>("ec:code-h");
  if (savedCode) setCodeHeight(savedCode, false);

  document.addEventListener("keydown", (ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target && /input|textarea|select/i.test(target.tagName ?? "")) return;
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      const r = root.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      ev.preventDefault();
      step(stepIdx + (ev.key === "ArrowRight" ? 1 : -1));
    } else if (ev.key === "Escape" && inspecting) go(stepIdx);
  });
  function relayout() {
    if (!current) return;
    const want = viewFor(current.id);
    if (want !== current) {
      current = null;
      return go(stepIdx);
    }
    const shown = viewBox();
    apply(shown ? frame(shown, 0) : fullBox());
  }
  if ("ResizeObserver" in window) {
    let last = { w: 0, h: 0 };
    new ResizeObserver(() => {
      const w = viewport.clientWidth;
      const hh = viewport.clientHeight;
      // Same zoom, more or less of the view around the center: resizing never rescales the diagram.
      const vb = viewBox();
      if (current && vb && last.w && last.h && w && hh) {
        const nw = (vb.w * w) / last.w;
        const nh = (vb.h * hh) / last.h;
        apply({ x: vb.x + (vb.w - nw) / 2, y: vb.y + (vb.h - nh) / 2, w: nw, h: nh });
      }
      last = { w, h: hh };
    }).observe(viewport);
  }
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 120) as unknown as number;
  });
  document.addEventListener("ec:mounted", () => {
    current = null;
    go(0);
  });
  mapApi.inspect = (id) => {
    root.scrollIntoView({ block: "start" });
    inspect(id);
  };
  mapApi.focus = (view, ids) => {
    root.scrollIntoView({ block: "start" });
    closeInspector();
    show(view, ids, true);
  };
  mapApi.showFlow = (fid) => {
    root.scrollIntoView({ block: "start" });
    closeInspector();
    show(`flow:${fid}`, [], true);
  };
  return root;
}
