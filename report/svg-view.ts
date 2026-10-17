/*
 * A view of the map: one SVG with its focusable elements, and the arrow markers every view draws with.
 */

import { s } from "./dom.ts";
import type { View } from "./ui.ts";

// Every view draws into one SVG and registers its focusable elements: geo[key] (box), data-k on the element, and
// edges carrying data-a / data-b. `expand(set)` says what else lights up with a focus set.

export function newView(id: string, W: number, H: number): View {
  const svg = s("svg", {
    class: `view-svg view-${id.split(":")[0]}`,
    role: "img",
    preserveAspectRatio: "xMidYMid meet",
  });
  return { id, svg, W, H, geo: {}, keyOf: (x) => x, expand: (set) => set };
}
export function markers(svg: SVGElement, prefix: string, kinds: string[]) {
  const defs = s("defs");
  for (const k of kinds) {
    defs.appendChild(
      s(
        "marker",
        {
          id: prefix + k,
          viewBox: "0 0 10 10",
          refX: "8",
          refY: "5",
          markerWidth: "10",
          markerHeight: "10",
          markerUnits: "userSpaceOnUse",
          orient: "auto-start-reverse",
        },
        s("path", { d: "M0,0 L10,5 L0,10 z", class: `arrow arrow-${k}` }),
      ),
    );
  }
  svg.appendChild(defs);
}
