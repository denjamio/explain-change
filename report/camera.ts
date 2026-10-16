/**
 * The map's camera: the viewBox of the shown view, framed to a box, flown to it (eased, unless motion is reduced),
 * zoomed with ctrl/⌘ + wheel and panned by dragging. A drag swallows the click that ends it.
 */
import { r1 } from "./dom.ts";
import { REDUCED } from "./model.ts";
import type { Box, View } from "./ui.ts";

export function createCamera(viewport: HTMLElement, view: () => View | null) {
  let vb: Box | null = null;
  let anim = 0;
  const ratio = () => (viewport.clientWidth || 1000) / (viewport.clientHeight || 560);
  function apply(v: Box) {
    vb = v;
    view()?.svg.setAttribute("viewBox", [v.x, v.y, v.w, v.h].map(r1).join(" "));
  }
  function frame(box: Box, pad = 28, minW?: number): Box {
    let x = box.x - pad;
    let y = box.y - pad;
    let w = box.w + 2 * pad;
    let hh = box.h + 2 * pad;
    if (minW && w < minW) {
      x -= (minW - w) / 2;
      w = minW;
    }
    const r = ratio();
    if (w / hh > r) {
      const nh = w / r;
      y -= (nh - hh) / 2;
      hh = nh;
    } else {
      const nw = hh * r;
      x -= (nw - w) / 2;
      w = nw;
    }
    return { x, y, w, h: hh };
  }
  const fullBox = () => frame({ x: 0, y: 0, w: (view() as View).W, h: (view() as View).H }, 16);
  function fly(target: Box, animate: boolean) {
    cancelAnimationFrame(anim);
    if (!animate || !vb || REDUCED) return apply(target);
    const from: Box = vb;
    let t0 = 0;
    const D = 560;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const p = Math.min(1, (now - t0) / D);
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      apply({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      });
      if (p < 1) anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  }
  function zoom(f: number, cx?: number, cy?: number) {
    const cur = view();
    if (!vb || !cur) return;
    const w = Math.max(160, Math.min(vb.w * f, Math.max(cur.W, cur.H) * 3));
    const k = w / vb.w;
    const x0 = cx ?? vb.x + vb.w / 2;
    const y0 = cy ?? vb.y + vb.h / 2;
    fly({ x: x0 - (x0 - vb.x) * k, y: y0 - (y0 - vb.y) * k, w, h: vb.h * k }, false);
  }
  let drag: { x: number; y: number; vb: Box } | null = null;
  let dragged = false;
  viewport.addEventListener("pointerdown", (ev: PointerEvent) => {
    if (ev.button !== 0 || !vb) return;
    drag = { x: ev.clientX, y: ev.clientY, vb };
    dragged = false;
  });
  viewport.addEventListener("pointermove", (ev: PointerEvent) => {
    if (!drag || !vb) return;
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!dragged) {
      dragged = true;
      try {
        viewport.setPointerCapture(ev.pointerId);
      } catch {
        // not capturable: panning still works while the pointer stays inside
      }
      viewport.classList.add("grabbing");
    }
    const k = drag.vb.w / (viewport.clientWidth || 1);
    apply({ x: drag.vb.x - dx * k, y: drag.vb.y - dy * k, w: drag.vb.w, h: drag.vb.h });
  });
  const endDrag = () => {
    drag = null;
    viewport.classList.remove("grabbing");
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  viewport.addEventListener(
    "click",
    (ev) => {
      if (dragged) {
        ev.stopPropagation();
        ev.preventDefault();
        dragged = false;
      }
    },
    true,
  );
  viewport.addEventListener(
    "wheel",
    (ev: WheelEvent) => {
      if (!(ev.ctrlKey || ev.metaKey) || !vb) return;
      ev.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cx = vb.x + ((ev.clientX - rect.left) / rect.width) * vb.w;
      const cy = vb.y + ((ev.clientY - rect.top) / rect.height) * vb.h;
      zoom(ev.deltaY > 0 ? 1.12 : 0.89, cx, cy);
    },
    { passive: false },
  );
  /** The viewBox shown now; null before the first view. */
  const box = () => vb;
  return { apply, frame, fly, zoom, fullBox, box };
}
