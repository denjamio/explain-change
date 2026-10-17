/*
 * explain-change report. Pure and deterministic: same data → same DOM and SVG. No dependencies.
 * Layout: a map (architecture lanes · data flows · data model) driven by a story whose steps move the camera and
 * light what changed; below it the design decisions, the SDD section (OpenSpec pipeline, requirement × component
 * matrix, scenarios) and the changes by component.
 */

import BULB from "./bulb.svg" with { type: "text" };
import { cap, h, store } from "./dom.ts";
import { renderHeader } from "./header.ts";
import { renderMap } from "./map.ts";
import { DATA, ex, facts, REQS } from "./model.ts";
import { renderSpec } from "./sdd.ts";
import { renderChanges, renderDecisions } from "./sections.ts";
import { T, t } from "./words.ts";

// ═════════════════════════════ shell ═════════════════════════════
function themeButton(): HTMLElement {
  const modes = ["auto", "light", "dark"];
  let cur = store<string>("ec:theme") ?? "auto";
  const btn = h("button", {
    class: "theme-btn",
    onclick: () => {
      cur = modes[(modes.indexOf(cur) + 1) % 3] as string;
      store("ec:theme", cur);
      paint();
    },
  });
  function paint() {
    if (cur === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", cur);
    btn.textContent = `◐ ${t(`theme${cap(cur)}`)}`;
    btn.title = T.theme;
  }
  paint();
  return btn;
}

const app = document.getElementById("app") as HTMLElement;
const main = h("main");
main.appendChild(renderHeader());
main.appendChild(renderMap());
const below = [
  { id: "decisions", title: T.decisions, n: ex ? ex.decisions.length : 0, el: renderDecisions() },
  { id: "sdd", title: T.spec, n: REQS.length, el: renderSpec() },
  { id: "changes", title: T.delta, n: facts.files.filter((f) => f.category !== "ignored").length, el: renderChanges() },
].filter((x) => x.el);
for (const x of below) main.appendChild(x.el as HTMLElement);
const navList = h(
  "nav",
  { class: "topnav" },
  h("a", { href: "#map", "data-sec": "map", text: T.canvas }),
  below.map((x) =>
    h("a", { href: `#${x.id}`, "data-sec": x.id }, x.title, h("span", { class: "nav-n", text: String(x.n) })),
  ),
);
/** The mark, report/bulb.svg: a lit bulb drawn in the accent color. */
function brandMark(): HTMLElement {
  const mark = h("span", { class: "brand-mark", "aria-hidden": "true" });
  mark.innerHTML = BULB;
  return mark;
}

app.appendChild(
  h(
    "div",
    { class: "topbar" },
    h(
      "a",
      { class: "brand", href: "#summary" },
      brandMark(),
      h("span", { class: "brand-name", text: "explain-change" }),
    ),
    navList,
    themeButton(),
  ),
);
app.appendChild(main);
app.appendChild(h("footer", { class: "foot faint", text: `explain-change ${DATA.tool || ""} · key ${facts.key}` }));
document.dispatchEvent(new CustomEvent("ec:mounted"));

if ("IntersectionObserver" in window) {
  const links = Array.from(navList.querySelectorAll("a[data-sec]"));
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        for (const a of links) a.classList.toggle("active", a.getAttribute("data-sec") === en.target.id);
      }
    },
    { rootMargin: "-30% 0px -60% 0px" },
  );
  for (const sct of Array.from(main.querySelectorAll("section[id]"))) io.observe(sct);
}
