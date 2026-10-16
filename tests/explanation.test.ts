import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Explanation } from "../src/contract/explanation.ts";
import type { Facts } from "../src/contract/facts.ts";
import { CONTRACT_VERSION } from "../src/core/constants.ts";
import { normalizeExplanation } from "../src/explanation/normalize.ts";
import { compactWords, proseRules, REFUSED } from "../src/explanation/prose.ts";
import { loadExplanation, prepareExplanation } from "../src/explanation/store.ts";
import { formatIssue, validateExplanation } from "../src/explanation/validate.ts";
import { tempDir } from "./helpers.ts";

/** A change with two components: `a` changed (file f.rb, hunk at lines 10-14) and `b` drawn as a neighbor. */
function makeFacts(over: Partial<Facts> = {}, lang: "en" | "es" = "en"): Facts {
  return {
    version: CONTRACT_VERSION,
    tool: "test",
    analysis: 0,
    key: "k1",
    source: {
      kind: "local",
      host: null,
      title: "t",
      description: "",
      branch: "b",
      baseRef: "main",
      headRef: "HEAD",
      headSha: "0",
      mergeBase: "0",
      headDate: "",
      commits: 1,
      prId: null,
      url: null,
      includeUncommitted: false,
    },
    config: {
      inferred: false,
      name: "x",
      direction: "",
      lang,
      layers: [{ id: "x", name: "X" }],
      components: [
        { id: "a", name: "A", layer: "x", desc: "" },
        { id: "b", name: "B", layer: "x", desc: "" },
      ],
      rules: { allow: [], forbid: [] },
      referenceFlows: [],
      glossary: [],
    },
    files: [
      {
        path: "f.rb",
        previousPath: null,
        delta: "changed",
        binary: false,
        additions: 1,
        deletions: 0,
        component: "a",
        category: "code",
        truncated: false,
        hunks: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 5, header: "", lines: [] }],
      },
    ],
    components: [
      { id: "a", delta: "changed", files: 1, additions: 1, deletions: 0 },
      { id: "b", delta: "unchanged", files: 0, additions: 0, deletions: 0 },
    ],
    dependencies: [
      { from: "b", to: "a", delta: "unchanged", baseCount: 1, headCount: 1, examples: [], violation: null },
    ],
    dependencyGraph: [["b", "a"]],
    ports: [],
    symbols: [],
    stats: {
      files: 1,
      additions: 1,
      deletions: 0,
      testAdditions: 0,
      testDeletions: 0,
      unmapped: [],
      unresolved: 0,
      newViolations: 0,
      codeLines: 1,
      mappedLines: 1,
    },
    notes: [],
    openspec: null,
    outline: { story: [], flows: [], keyDependencyCandidates: [], dataFiles: [] },
    ...over,
  };
}

function valid(over: Record<string, unknown> = {}, lang = "en") {
  return {
    version: CONTRACT_VERSION,
    key: "k1",
    lang,
    tldr: "t",
    goal: "g",
    components: [{ id: "a", summary: "s" }],
    story: [
      { heading: "a now does x", body: "b", focus: ["a"] },
      { heading: "overview", body: "b", view: "architecture", code: "f.rb:11" },
    ],
    ...over,
  };
}

const messages = (value: unknown, facts = makeFacts()) => validateExplanation(value, facts, null).map(formatIssue);
const joined = (value: unknown, facts = makeFacts()) => messages(value, facts).join("\n");

describe("validation", () => {
  test("a valid explanation has no issues", () => {
    expect(messages(valid())).toEqual([]);
  });

  test("version, key and language", () => {
    const es = makeFacts({}, "es");
    expect(messages(valid({}, "es"), es)).toEqual([]);
    const errs = joined(valid({ version: 7, lang: "en", key: "k0" }), es);
    expect(errs).toContain(`version: '7' must be ${CONTRACT_VERSION}`);
    expect(errs).toContain("lang: 'en' must be 'es'");
    expect(errs).toContain("key: 'k0' is not this change's key 'k1'");
  });

  test("items that are not objects are reported at their exact index", () => {
    const errs = messages(
      valid({
        components: ["a", { id: "a", summary: "s" }],
        decisions: [{ title: "t", why: "w" }, 3],
        flows: [{ id: "f", title: "Run it", steps: ["x", { from: "a", to: "b", call: "m", delta: "added" }] }],
      }),
    );
    for (const needle of [
      "components[0]: must be an object",
      "decisions[1]: must be an object",
      "flows[0].steps[0]: must be an object",
    ]) {
      expect(errs).toContain(needle);
    }
    expect(errs.some((e) => e.startsWith("components[1]"))).toBe(false);
  });

  test("issues name the field and what is allowed", () => {
    const errs = joined(
      valid({
        tldr: "x".repeat(300),
        principles: [],
        flows: [{ id: "Bad Id", title: "Run it", steps: [{ from: "a", to: "zz", call: "m", delta: "added" }] }],
        decisions: [{ title: "t", why: "w", evidence: "f.rb:50-60" }],
      }),
    );
    for (const needle of [
      "tldr: 300 chars, max 280",
      "principles: unknown field",
      "flows[0].id",
      "steps[0].to: 'zz' is not a component of this change (use: a, b)",
      "50-60 is outside the hunks of f.rb (10-14)",
    ]) {
      expect(errs).toContain(needle);
    }
  });

  test("every changed component is described", () => {
    const errs = joined(valid({ components: [{ id: "b", summary: "s" }] }));
    expect(errs).toContain("components[0].id: 'b' is not a changed component (use: a)");
    expect(errs).toContain("missing a one-line summary for a");
  });

  test("story views, focus and key dependencies", () => {
    let errs = joined(
      valid({
        story: [
          { heading: "h", body: "b", focus: ["zz"] },
          { heading: "h", body: "b", view: "flow:nope" },
        ],
        keyDependencies: [{ from: "a", to: "b" }],
      }),
    );
    expect(errs).toContain("story[0].focus: 'zz' is not on view 'architecture'");
    expect(errs).toContain("story[1].view: 'flow:nope' names no flow");
    expect(errs).toContain("keyDependencies[0]: a -> b is not a dependency drawn");
    const ok = valid({
      keyDependencies: [{ from: "b", to: "a", label: "uses" }],
      flows: [{ id: "f", title: "Run it", steps: [{ from: "b", to: "a", call: "m", delta: "added" }] }],
      story: [
        { heading: "h", body: "b", view: "flow:f", focus: ["#1", "b"] },
        { heading: "h", body: "b" },
      ],
    });
    expect(messages(ok)).toEqual([]);
    errs = joined(valid({ story: [{ heading: "h", body: "b" }] }));
    expect(errs).toContain("story: 1 steps");
  });

  test("requirement traceability", () => {
    const req = {
      id: "orders/confirm-email",
      capability: "orders",
      name: "Confirm email",
      op: "ADDED" as const,
      text: "",
      scenarios: [{ id: "smtp-down", name: "SMTP down", steps: [], line: 5 }],
      file: "openspec/x.md",
      line: 3,
      change: "c1",
      merged: false,
      renamedFrom: null,
    };
    const change = {
      id: "c1",
      dir: "openspec/changes/c1",
      archived: false,
      deleted: false,
      movedToArchive: false,
      artifacts: [],
      why: "",
      what: [],
      impact: [],
      decisions: [],
      tasks: null,
      requirements: [req],
    };
    const facts = makeFacts({ openspec: { changes: [change], specs: [] } });
    expect(joined(valid(), facts)).toContain(
      "map every ADDED or MODIFIED requirement to its implementation; missing orders/confirm-email",
    );
    const ok = valid({
      requirements: [{ id: "orders/confirm-email", status: "implemented", components: ["a"], tests: ["f.rb:11"] }],
      flows: [
        {
          id: "f",
          title: "Run it",
          scenario: "orders/confirm-email#smtp-down",
          steps: [{ from: "a", to: "b", call: "m", delta: "added" }],
        },
      ],
      story: [
        { heading: "h", body: "b", view: "requirements", focus: ["orders/confirm-email"] },
        { heading: "h", body: "b" },
      ],
    });
    expect(messages(ok, facts)).toEqual([]);
    expect(joined(valid({ requirements: [{ id: "orders/confirm-email", status: "missing" }] }), facts)).toContain(
      "requirements[0].note: required",
    );
  });

  test("data model and the data that travels on a flow step", () => {
    const dataModel = {
      entities: [
        { id: "order", name: "Order", delta: "changed", fields: ["+email: string"], evidence: "f.rb:11" },
        { id: "customer", name: "Customer", delta: "unchanged" },
      ],
      relations: [{ from: "order", to: "customer", label: "n..1", delta: "unchanged" }],
    };
    const ok = valid({
      dataModel,
      flows: [
        {
          id: "f",
          title: "Run it",
          steps: [{ from: "a", to: "b", call: "m", delta: "added", data: { type: "Order", fields: ["+email"] } }],
        },
      ],
      story: [
        { heading: "h", body: "b", view: "data", focus: ["order"] },
        { heading: "h", body: "b" },
      ],
    });
    expect(messages(ok)).toEqual([]);
    const errs = joined(
      valid({
        dataModel: {
          entities: [{ id: "Order", name: "O", delta: "added" }],
          relations: [{ from: "x", to: "y", delta: "added" }],
        },
      }),
    );
    expect(errs).toContain("dataModel.entities[0].id: 'Order' must be kebab-case");
    expect(errs).toContain("dataModel.entities[0].evidence: required");
    expect(errs).toContain("dataModel.relations[0].from: 'x' is not an entity");
  });

  test("prose: sentence length and refused words, by language", () => {
    let errs = joined(valid({ tldr: `${Array(30).fill("word").join(" ")}.`, goal: "We leverage the queue." }));
    expect(errs).toContain("tldr: a sentence has 30 words, max 25");
    expect(errs).toContain("goal: leverage: marketing words");
    expect(messages(valid({ tldr: "Short one. ".repeat(6) }))).toEqual([]);
    errs = joined(valid({ tldr: "It will retry two times.", goal: "Just better errors." }));
    expect(errs).toContain("tldr: two: a number in words; write digits");
    expect(errs).toContain("tldr: will: future or modal");
    expect(errs).toContain("goal: just: filler");
    expect(errs).toContain("goal: better: a judgement");
    const es = makeFacts({}, "es");
    errs = joined(valid({ tldr: "Podría reintentar tres veces." }, "es"), es);
    expect(errs).toContain("tldr: podría: futuro o condicional");
    expect(errs).toContain("tldr: tres: un número en letras");
    expect(messages(valid({ tldr: "Will reintenta 3 veces." }, "es"), es)).toEqual([]); // English words pass
  });

  test("the digest lists every refused word, folded by stem", () => {
    const rules = proseRules("en");
    for (const group of REFUSED.en) {
      const folded = compactWords(group.words);
      expect(rules).toContain(folded);
      for (const w of group.words)
        expect(folded.split(", ").some((x) => w.startsWith(x.replace(/\*$/, "")))).toBe(true);
    }
  });

  test("code names must exist in the change", () => {
    const facts = makeFacts({
      symbols: [{ file: "f.rb", line: 11, kind: "def", name: "refund_order", delta: "added" }],
      files: [
        {
          ...makeFacts().files[0]!,
          hunks: [
            {
              oldStart: 10,
              oldLines: 3,
              newStart: 10,
              newLines: 5,
              header: "",
              lines: [["+", "  Order.place(total)"]],
            },
          ],
        },
      ],
    });
    expect(messages(valid({ tldr: "refund_order calls Order.place and Order.total on GitHub." }), facts)).toEqual([]);
    const errs = messages(
      valid({
        tldr: "refund_order calls ghost_method and RefundService.",
        decisions: [{ title: "t", why: "w", alternative: "a SidekiqJob with retries" }],
        flows: [
          {
            id: "f",
            title: "Run it",
            steps: [{ from: "a", to: "b", call: "m", delta: "added", data: { type: "RefundParams" } }],
          },
        ],
      }),
      facts,
    );
    // the alternative and data.type may name code that is not in the change
    expect(errs).toEqual([
      "tldr: ghost_method, RefundService not found in the change; write code names exactly as in the code, or in plain words",
    ]);
  });

  test("flow titles name an action and triggers exist", () => {
    const facts = makeFacts({
      files: [
        {
          ...makeFacts().files[0]!,
          hunks: [
            { oldStart: 10, oldLines: 3, newStart: 10, newLines: 5, header: "", lines: [["+", "  def refund_order"]] },
          ],
        },
      ],
    });
    const step = { from: "a", to: "b", call: "m", delta: "added" };
    expect(
      messages(
        valid({ flows: [{ id: "f", title: "Refund an order", trigger: "POST refund_order", steps: [step] }] }),
        facts,
      ),
    ).toEqual([]);
    const errs = messages(
      valid({
        flows: [
          { id: "f", title: "a", steps: [step] },
          { id: "g", title: "Refund it.", trigger: "GhostController#create", steps: [step] },
          { id: "h", title: "Refund it.", steps: [step] },
        ],
      }),
      facts,
    );
    expect(errs.some((e) => e.startsWith("flows[0].title:") && e.includes("component's name"))).toBe(true);
    expect(errs.some((e) => e.startsWith("flows[1].title:") && e.includes("final '.'"))).toBe(true);
    expect(errs.some((e) => e.startsWith("flows[1].trigger: GhostController"))).toBe(true);
    expect(errs.some((e) => e.startsWith("flows[2].title:") && e.includes("another flow"))).toBe(true);
  });

  test("placeholders are reported once, and nothing else about them", () => {
    const issues = validateExplanation(
      valid({
        tldr: "<≤280 chars: what changes>",
        story: [
          { heading: "<≤60: x>", body: "b", view: "data", focus: ["<entity-id>"] },
          { heading: "h", body: "b" },
        ],
        dataModel: {
          entities: [{ id: "<kebab-id>", name: "Order", delta: "<added|changed>", evidence: "<file:line>" }],
          relations: [],
        },
      }),
      makeFacts(),
      null,
    );
    expect(issues.filter((i) => i.code !== "placeholder").map(formatIssue)).toEqual([]);
    expect(issues.map((i) => i.path)).toEqual([
      "tldr",
      "story[0].heading",
      "story[0].focus[0]",
      "dataModel.entities[0].id",
      "dataModel.entities[0].delta",
      "dataModel.entities[0].evidence",
    ]);
  });
});

describe("normalization", () => {
  test("flow steps are verified against the code's dependencies", () => {
    const e = valid({
      flows: [
        {
          id: "f",
          title: "Run it",
          steps: [
            { from: "a", to: "b", call: "m", delta: "unchanged" },
            { from: "a", to: "a", call: "m", delta: "unchanged" },
          ],
        },
      ],
    }) as unknown as Explanation;
    expect(messages(e)).toEqual([]);
    expect(normalizeExplanation(e, makeFacts()).flows[0]?.steps.map((s) => s.verified)).toEqual([true, true]);
    expect(normalizeExplanation(e, makeFacts({ dependencyGraph: [] })).flows[0]?.steps[0]?.verified).toBe(false);
    // a port b implements, though neither imports the other
    const viaPort = makeFacts({
      dependencyGraph: [],
      ports: [{ from: "a", to: "b", interfaces: ["IAuditLog", "IThing"] }],
    });
    expect(normalizeExplanation(e, viaPort).flows[0]?.steps[0]).toMatchObject({ verified: true, via: "IAuditLog" });
    // the port the call names, when the pair has several
    const named = {
      ...e,
      flows: [{ id: "f", title: "Run it", steps: [{ from: "a", to: "b", call: "IThing.Save", delta: "unchanged" }] }],
    };
    expect(normalizeExplanation(named as Explanation, viaPort).flows[0]?.steps[0]).toMatchObject({ via: "IThing" });
    // a third component both use is no evidence
    const shared = makeFacts({
      dependencyGraph: [
        ["a", "kernel"],
        ["b", "kernel"],
      ],
    });
    expect(normalizeExplanation(e, shared).flows[0]?.steps[0]).toMatchObject({ verified: false, via: null });
  });
});

describe("explanation store", () => {
  const facts = (key: string) => makeFacts({ key });
  const write = (work: string, value: unknown) =>
    writeFileSync(join(work, "explanation.json"), typeof value === "string" ? value : JSON.stringify(value));
  const read = (work: string) => JSON.parse(readFileSync(join(work, "explanation.json"), "utf8"));

  test("a new change gets a draft; going back to an explained change restores it", () => {
    const work = tempDir();
    expect(prepareExplanation(work, facts("a"))).toBe("drafted");
    expect(loadExplanation(work, facts("a"), null).state).toBe("draft");
    write(work, valid({ key: "a" }));
    expect(loadExplanation(work, facts("a"), null).state).toBe("valid");
    expect(prepareExplanation(work, facts("b"))).toBe("drafted"); // another change
    expect(read(work).key).toBe("b");
    write(work, valid({ key: "b", tldr: "B" }));
    expect(loadExplanation(work, facts("b"), null).state).toBe("valid");
    expect(prepareExplanation(work, facts("a"))).toBe("restored"); // back to A: no agent needed
    expect(read(work).tldr).toBe("t");
    expect(loadExplanation(work, facts("a"), null).state).toBe("valid");
  });

  test("work in progress for another change is kept under its key", () => {
    const work = tempDir();
    write(work, { ...valid({ key: "b" }), tldr: "draft" });
    expect(prepareExplanation(work, facts("a"))).toBe("drafted");
    expect(JSON.parse(readFileSync(join(work, "explanations/b.json"), "utf8")).tldr).toBe("draft");
  });

  test("a file being written is left alone", () => {
    const work = tempDir();
    write(work, "{ half written");
    expect(prepareExplanation(work, facts("a"))).toBe("kept");
    expect(readFileSync(join(work, "explanation.json"), "utf8")).toBe("{ half written");
    expect(loadExplanation(work, facts("a"), null).issues[0]?.code).toBe("invalid-json");
  });

  test("an explanation for another change is stale, with that single issue", () => {
    const work = tempDir();
    write(work, valid({ key: "zz" }));
    const status = loadExplanation(work, facts("a"), null);
    expect(status.state).toBe("stale");
    expect(status.issues.map((i) => i.code)).toEqual(["stale"]);
    expect(existsSync(join(work, "explanations/a.json"))).toBe(false);
  });
});
