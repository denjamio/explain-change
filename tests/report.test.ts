import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NormalizedExplanation } from "../src/contract/explanation.ts";
import type { Facts } from "../src/contract/facts.ts";
import { readReportData } from "../src/report/data.ts";
import { excerptRanges, pruneHunks, renderHtml } from "../src/report/render.ts";
import { smoke } from "./dom.ts";
import { ROOT } from "./helpers.ts";

const REPORTS = readdirSync(join(ROOT, "examples"))
  .filter((f) => f.endsWith(".html") && f !== "index.html")
  .map((f) => join(ROOT, "examples", f));

describe("example reports", () => {
  test("there are reports to check", () => {
    expect(REPORTS.length).toBeGreaterThan(2);
  });

  for (const report of REPORTS) {
    test(`${report.split("/").pop()} renders, plays its story and handles every click`, () => {
      const html = readFileSync(report, "utf8");
      const out = smoke(html);
      expect(out.elements).toBeGreaterThan(100);
      expect(out.clicks).toBeGreaterThan(5);
      for (const step of readReportData(html).explanation?.story ?? []) expect(out.text).toContain(step.heading);
    });
  }
});

describe("what the map draws by default", () => {
  const html = readFileSync(join(ROOT, "examples/real-maybe-rails-data-exports.html"), "utf8");
  const drawn = (page: string) => {
    let nodes: string[] = [];
    let violations = 0;
    smoke(page, (app) => {
      nodes = app.querySelectorAll(".node").map((n) => n.getAttribute("data-k") ?? "");
      violations = app.querySelectorAll(".edge.e-violation").length;
    });
    return { nodes, violations };
  };

  test("no neighbor only because a link gained references", () => {
    const data = readReportData(html);
    const countOnly = data.facts.dependencies.find(
      (e) => e.delta === "changed" && data.facts.components.find((c) => c.id === e.to)?.delta === "unchanged",
    );
    expect(countOnly).toBeDefined(); // web-endpoints -> shared-kernel: 1 more reference
    // Rendered by this script, not the one the committed example embeds.
    const page = renderHtml(data.facts, { state: data.state, issues: data.issues, explanation: data.explanation });
    expect(drawn(page).nodes.length).toBeGreaterThan(0);
    expect(drawn(page).nodes.some((k) => k.includes(countOnly?.to as string))).toBe(false);
  });

  test("a rule broken before the change is not red by default", () => {
    const data = readReportData(html);
    const facts = structuredClone(data.facts);
    const edge = facts.dependencies.find((e) => e.from === "web-endpoints" && e.to === "background-jobs");
    if (!edge) throw new Error("the example lost its web-endpoints -> background-jobs link");
    edge.violation = { rule: "forbidden: web -> async", preexisting: true };
    const page = renderHtml(facts, { state: data.state, issues: data.issues, explanation: data.explanation });
    expect(drawn(page).violations).toBe(0);
    edge.violation.preexisting = false;
    const fresh = renderHtml(facts, { state: data.state, issues: data.issues, explanation: data.explanation });
    expect(drawn(fresh).violations).toBe(1);
  });
});

describe("embedded data", () => {
  test("code with </script> or <!-- cannot break the page", () => {
    const data = readReportData(readFileSync(REPORTS[0] as string, "utf8"));
    const hostile = "<!-- </script><script>alert(1)</script> -->";
    const facts = structuredClone(data.facts);
    facts.source.title = hostile;
    facts.notes = [hostile];
    const html = renderHtml(facts, { state: data.state, issues: data.issues, explanation: data.explanation });
    expect(html.match(/<\/script>/g)?.length).toBe(2); // the data's and the script's
    expect(readReportData(html).facts.notes).toEqual([hostile]);
    expect(smoke(html).text).toContain(hostile);
  });
});

describe("styles", () => {
  const css = readFileSync(join(ROOT, "report/styles.css"), "utf8");
  const decls = (block: string) =>
    Object.fromEntries([...block.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2]]));

  test("both dark palettes define the same colors", () => {
    // The dark palette is written twice (system preference, and the theme button); the copies must not drift.
    const auto = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\}/.exec(
      css,
    )?.[1];
    const forced = /:root\[data-theme="dark"\] \{([\s\S]*?)\}/.exec(css)?.[1];
    expect(auto && forced).toBeTruthy();
    expect(decls(auto as string)).toEqual(decls(forced as string));
  });

  test("every color token has a dark value", () => {
    const light = /:root \{([\s\S]*?)\n\}/.exec(css)?.[1] as string;
    const dark = /:root\[data-theme="dark"\] \{([\s\S]*?)\}/.exec(css)?.[1] as string;
    const tokens = (b: string) => new Set([...b.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string));
    const missing = [...tokens(light)].filter((t) => !tokens(dark).has(t) && !/^--(s\d|radius|font|mono)/.test(t));
    expect(missing).toEqual([]);
  });

  test("every class the report sets for a delta has a style", () => {
    for (const delta of ["added", "changed", "removed", "unchanged"]) {
      expect(css).toContain(`.node.st-${delta}`);
      expect(css).toContain(`.badge.${delta}`);
    }
    for (const kind of ["added", "changed", "removed", "unchanged", "violation"])
      expect(css).toContain(`.edge.e-${kind}`);
  });
});

describe("excerpts", () => {
  test("only the referenced lines ship", () => {
    const lines = [
      [" ", "a"],
      ["-", "b"],
      ["+", "B"],
      [" ", "c"],
      ...Array.from({ length: 20 }, (_, i) => ["+", `x${i}`]),
      [" ", "z"],
    ] as Facts["files"][number]["hunks"][number]["lines"];
    const f = {
      delta: "changed" as const,
      hunks: [{ oldStart: 10, oldLines: 4, newStart: 10, newLines: 24, header: "class Order", lines }],
    };
    const got = pruneHunks(f, [[30, 31]]);
    expect(got.length).toBe(1);
    expect([got[0]?.newStart, got[0]?.newLines, got[0]?.oldLines]).toEqual([30, 2, 0]);
    expect(got[0]?.lines.map(([m]) => m)).toEqual(["+", "+"]);
    expect(pruneHunks(f, [])).toEqual([]);
  });

  test("ranges come from the story and the evidence", () => {
    const facts = { dependencies: [], openspec: null } as unknown as Facts;
    const explanation = {
      story: [{ code: "a.rb:5-6" }],
      decisions: [{ evidence: "b.py:9" }, {}],
      dataModel: { entities: [] },
    } as unknown as NormalizedExplanation;
    expect(Object.fromEntries(excerptRanges(facts, explanation))).toEqual({ "a.rb": [[2, 9]], "b.py": [[6, 12]] });
  });
});
