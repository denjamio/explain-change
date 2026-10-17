/*
 * The page's own line icons, 16 × 16, drawn in currentColor: no font or file to load. One meaning each, the same
 * in the map, the story and the sections: spec = OpenSpec requirements, locate = show it on the map, and 1 per view.
 */

import { s } from "./dom.ts";

export type IconName = "spec" | "locate" | "architecture" | "flow" | "data";

const PATHS: Record<IconName, string> = {
  // a page with a folded corner and a check
  spec: "M4 1.5h5.5l3 3v10H4Z M9.5 1.5v3h3 M6.2 9.6l1.5 1.5 2.8-3",
  // a crosshair
  locate: "M8 1.5v3 M8 11.5v3 M1.5 8h3 M11.5 8h3 M4.5 8a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0",
  // 3 boxes on 2 lanes
  architecture: "M1.5 2.5h5v4h-5Z M9.5 2.5h5v4h-5Z M5.5 9.5h5v4h-5Z M4 6.5v1.5h8V6.5 M8 8v1.5",
  // a call and its answer
  flow: "M2 5h10 M9.5 2.5 12 5 9.5 7.5 M14 11H4 M6.5 8.5 4 11l2.5 2.5",
  // a table: a database cylinder
  data: "M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2Z M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4 M3 8c0 1.1 2.2 2 5 2s5-.9 5-2",
};

/** An icon for HTML: an inline <svg> that sits on the text baseline. */
export function icon(name: IconName): SVGElement {
  return s(
    "svg",
    { class: `icon icon-${name}`, viewBox: "0 0 16 16", width: "14", height: "14", "aria-hidden": "true" },
    s("path", { d: PATHS[name] }),
  );
}

/** An icon inside a diagram: `size` pixels wide, its top left corner at x, y. */
export function iconAt(name: IconName, x: number, y: number, size: number): SVGElement {
  return s("path", {
    class: `icon-path icon-${name}`,
    d: PATHS[name],
    transform: `translate(${x} ${y}) scale(${size / 16})`,
  });
}

/** The icon of a view: what a story step or a tab moves the map to. */
export const viewIcon = (view: string): IconName =>
  view === "requirements" ? "spec" : view === "data" ? "data" : view.startsWith("flow:") ? "flow" : "architecture";
