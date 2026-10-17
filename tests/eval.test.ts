import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleTargets } from "../scripts/build-examples.ts";
import {
  type Assertion,
  contentWords,
  graderChanges,
  graderStats,
  inChange,
  jaccard,
  mentionGraders,
  parseVerdicts,
  RUBRIC,
  reviewPrompt,
  scores,
  signTest,
  structureGraders,
  toVerdicts,
  type Verdict,
} from "../scripts/eval-graders.ts";
import { argv, compareRuns, f1, fidelity, items, lift, readTranscript, spread } from "../scripts/eval-metrics.ts";
import { caught, mutants } from "../scripts/eval-mutants.ts";
import type { Explanation } from "../src/contract/explanation.ts";
import type { Facts } from "../src/contract/facts.ts";
import { removeTree } from "../src/core/fs.ts";
import { draftExplanation } from "../src/explanation/draft.ts";
import { CLI, tempDir } from "./helpers.ts";

const explanation = (e: Partial<Explanation>) => ({ story: [], ...e }) as unknown as Explanation;

describe("eval metrics", () => {
  test("f1 rewards precision and recall together, and is null when both sides are empty", () => {
    expect(f1(["a", "b"], ["a", "b"])).toBe(1);
    expect(f1(["a", "b"], ["a"])).toBeCloseTo(2 / 3);
    expect(f1(["a"], ["a", "b", "c", "d"])).toBeCloseTo(0.4);
    expect(f1(["a"], ["b"])).toBe(0);
    expect(f1([], [])).toBeNull();
  });

  test("a value the draft leaves to the agent is never an item", () => {
    const e = explanation({
      flows: [
        {
          steps: [
            { from: "<component-id>", to: "orders" },
            { from: "web", to: "orders" },
          ],
        },
      ],
      decisions: [{ evidence: "<file:line inside a hunk, optional>" }, { evidence: "app/a.rb:3" }],
    } as Partial<Explanation>);
    expect(items(e, "flowEdges")).toEqual(["web->orders"]);
    expect(items(e, "decisionFiles")).toEqual(["app/a.rb"]);
  });

  test("lift is the agent's F1 minus the draft's, over the parts both measure", () => {
    const agent = { keyDeps: 1, flowEdges: 0.5, storyFocus: null, decisionFiles: 0.4 };
    const draft = { keyDeps: 1, flowEdges: 0.7, storyFocus: 0.8, decisionFiles: 0 };
    expect(lift(agent, draft)).toBe(0.07);
    expect(lift(agent, { keyDeps: null, flowEdges: null, storyFocus: null, decisionFiles: null })).toBeNull();
  });

  test("the transcript gives turns, tokens, renders, source reads and the skills loaded", () => {
    const tool = (name: string, input: Record<string, string>, id?: string) =>
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
    const issues = [
      { code: "sentence-too-long", path: "story[2].body", message: "…" },
      { code: "placeholder", path: "tldr", message: "…" },
    ];
    const result = (id: string, issues: unknown[]) =>
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: id, content: JSON.stringify({ explanation: { issues } }) }],
        },
      });
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init" }),
      tool("Skill", { skill: "explain-change" }),
      tool("Bash", { command: "explain-change pr https://github.com/o/r/pull/1 --json" }),
      tool("Read", { file_path: "/tmp/r/.explain-change/digest.md" }),
      tool("Read", { file_path: "/tmp/r/app/models/order.rb" }),
      tool("Bash", { command: "git show abc:app/models/order.rb | sed -n 1,40p" }),
      tool("Bash", { command: "explain-change render --json" }, "r1"),
      result("r1", issues),
      tool("Bash", { command: "cd /tmp/r && explain-change  render --json" }, "r2"),
      result("r2", []),
      "not json",
      JSON.stringify({
        type: "result",
        num_turns: 9,
        total_cost_usd: 0.02,
        usage: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, output_tokens: 300 },
      }),
    ].join("\n");
    expect(readTranscript(stdout)).toEqual({
      turns: 9,
      costUsd: 0.02,
      tokensIn: 1000,
      tokensOut: 300,
      renders: 2,
      sourceReads: 2,
      skills: ["explain-change"],
      firstIssues: ["sentence-too-long story[].body", "placeholder tldr"],
    });
    expect(readTranscript("")).toMatchObject({ turns: null, tokensIn: null, renders: 0, skills: [] });
  });

  test("spread and argv", () => {
    expect(spread([1, 3, "x", null])).toBe("2 ± 1");
    expect(spread([0.5])).toBe("0.5");
    expect(spread([1000, 2001])).toBe("1501 ± 501");
    expect(spread([])).toBeNull();
    expect(argv("  claude   -p ")).toEqual(["claude", "-p"]);
  });

  test("on a scenario, the reference scores 1 and the draft less: the agent's words are what lift measures", () => {
    const target = exampleTargets().find((t) => t.name === "01-marketplace-rails-refunds");
    if (!target) throw new Error("scenario 01 is missing");
    const tmp = tempDir();
    try {
      const repo = target.build(tmp);
      const p = spawnSync("bun", [CLI, ...target.args, "--no-open", "--json"], { cwd: repo, encoding: "utf8" });
      expect(p.status).toBe(0);
      const facts = JSON.parse(readFileSync(join(repo, ".explain-change/facts.json"), "utf8")) as Facts;
      const reference = JSON.parse(readFileSync(target.explanation, "utf8")) as Explanation;
      const draft = draftExplanation(facts) as unknown as Explanation;
      const self = fidelity(reference, reference);
      const fromDraft = fidelity(reference, draft);
      expect(self.fidelity).toBe(1);
      expect(fromDraft.fidelity).toBeLessThan(1);
      expect(fromDraft.decisionFiles).toBe(0); // the draft cites no file: only the agent does
      expect(lift(self, fromDraft)).toBeGreaterThan(0);
    } finally {
      removeTree(tmp);
    }
  });

  test("a baseline comparison fails a drop larger than the noise, never a drop inside it", () => {
    const run = (fidelity: number, state = "valid") => ({ state, fidelity, lift: fidelity - 0.5 });
    const before = [run(0.7), run(0.8)];
    const by = (rows: Record<string, unknown>[]) =>
      Object.fromEntries(compareRuns(before, rows).map((c) => [c.measure, c.regressed]));
    expect(by([run(0.72), run(0.76)])).toEqual({ valid: false, fidelity: false, lift: false });
    expect(by([run(0.69), run(0.69)]).fidelity).toBe(false); // -0.06: the noise of 2 evals of the same code
    expect(by([run(0.5), run(0.52)])).toEqual({ valid: false, fidelity: true, lift: true });
    expect(by([run(0.75), run(0.75, "invalid")]).valid).toBe(true);
  });
});

describe("eval graders", () => {
  /** Scenario 01 collected, with its committed explanation: a good explanation and the facts it explains. */
  function scenario(): { facts: Facts; good: Explanation } {
    const target = exampleTargets().find((t) => t.name === "01-marketplace-rails-refunds");
    if (!target) throw new Error("scenario 01 is missing");
    const tmp = tempDir();
    try {
      const repo = target.build(tmp);
      spawnSync("bun", [CLI, ...target.args, "--no-open", "--json"], { cwd: repo, encoding: "utf8" });
      return {
        facts: JSON.parse(readFileSync(join(repo, ".explain-change/facts.json"), "utf8")) as Facts,
        good: JSON.parse(readFileSync(target.explanation, "utf8")) as Explanation,
      };
    } finally {
      removeTree(tmp);
    }
  }

  test("a good explanation passes the structure graders, and each structural mutant fails its own", () => {
    const { facts, good } = scenario();
    const clean = structureGraders(facts, good, true);
    expect(clean.filter((v) => v.passed === false)).toEqual([]);
    expect(structureGraders(facts, null, false)).toEqual([expect.objectContaining({ id: "valid", passed: false })]);
    const structural = mutants(facts, good).filter((m) => !m.review && !m.grounded);
    expect(structural.map((m) => m.kind).sort()).toEqual([
      "evidence-outside-change",
      "hide-biggest-component",
      "untouched-key-dependency",
    ]);
    for (const m of structural)
      expect(caught(m.targets, clean, structureGraders(facts, m.explanation, true))).toBe(true);
    const generic = mutants(facts, good).find((m) => m.kind === "generic-prose");
    const repeated = structureGraders(facts, generic?.explanation as Explanation, true).find(
      (v) => v.id === "distinct-prose",
    );
    expect(repeated?.passed).toBe(false);
  });

  test("mutants are deterministic", () => {
    const { facts, good } = scenario();
    expect(JSON.stringify(mutants(facts, good))).toBe(JSON.stringify(mutants(facts, good)));
  });

  test("a mutant whose graders already fail the good explanation measures nothing", () => {
    const v = (id: string, passed: boolean | null): Verdict => ({ id, group: "prose", passed, evidence: "" });
    expect(caught(["tldr-effect"], [v("tldr-effect", false)], [v("tldr-effect", false)])).toBeNull();
    expect(caught(["group:prose"], [v("a", true), v("b", true)], [v("a", true), v("b", false)])).toBe(true);
    expect(caught(["tldr-effect"], [v("tldr-effect", true)], [v("tldr-effect", null)])).toBe(false);
  });

  test("evidence counts as in the change near a hunk, never in another file", () => {
    const { facts } = scenario();
    const file = facts.files.find((f) => f.category === "code" && f.hunks.length) as Facts["files"][number];
    const h = file.hunks[0] as Facts["files"][number]["hunks"][number];
    const start = file.delta === "removed" ? h.oldStart : h.newStart;
    expect(inChange(facts, `${file.path}:${start}`)).toBe(true);
    expect(inChange(facts, "no/such/file.rb:1")).toBe(false);
    expect(inChange(facts, "not a location")).toBe(false);
  });

  test("mentions match a whole word, any case; llm assertions go to the judge with the rubric", () => {
    const ex = { tldr: "Adds FamilyExport and a job.", goal: "g", story: [] } as unknown as Explanation;
    const assertions: Assertion[] = [
      { id: "m1", kind: "mentions", text: "names the model", any: ["familyexport"] },
      { id: "m2", kind: "mentions", text: "names the exporter", any: ["Export"] },
      { id: "l1", kind: "llm", text: "Says that the export runs in a job." },
    ];
    expect(mentionGraders(ex, assertions).map((v) => v.passed)).toEqual([true, false]);
    expect(mentionGraders(null, assertions).map((v) => v.passed)).toEqual([false, false]);
    const { ask, ids } = reviewPrompt("Data exports", ex, assertions);
    expect(ids).toEqual(["l1", ...RUBRIC.map((r) => r.id)]);
    expect(ask).toContain("Says that the export runs in a job.");
    expect(ask).not.toContain("names the model");
  });

  test("judge answers: unknown and missing ids count neither way; unreadable answers are null", () => {
    const answers = parseVerdicts(
      'Sure: [{"id":"a","verdict":"pass"},{"id":"b","verdict":"unknown"},{"id":"c","verdict":"fail","reason":"no"}]',
    );
    const verdicts = toVerdicts(answers, ["a", "b", "c", "d"], () => "content");
    expect(verdicts.map((v) => v.passed)).toEqual([true, null, false, null]);
    expect(parseVerdicts("no json")).toBeNull();
    expect(scores(verdicts)).toMatchObject({ score: 0.5, content: 0.5, structure: null });
  });

  test("grader stats give pass^k per example, and changes between 2 evals", () => {
    const row = (example: string, passed: boolean) => ({
      example,
      graders: [{ id: "g", group: "content" as const, passed, evidence: passed ? "" : "misses it" }],
    });
    const before = graderStats([row("x", false), row("x", false)]);
    const now = graderStats([row("x", true), row("x", true)]);
    expect(before).toEqual([{ example: "x", id: "g", group: "content", passed: 0, failed: 2, sample: "misses it" }]);
    expect(graderChanges(before, now)).toEqual({ fixed: [{ example: "x", id: "g", before: 0, now: 1 }], broke: [] });
  });

  test("repeated prose is measured on content words; the sign test is two-sided", () => {
    expect(jaccard(contentWords("The job writes the ZIP file"), contentWords("the job writes a ZIP file"))).toBe(1);
    expect(jaccard(contentWords("adds a cache"), contentWords("removes a queue"))).toBe(0);
    expect(signTest(10, 0)).toBe(0);
    expect(signTest(3, 3)).toBe(1);
    expect(signTest(0, 0)).toBe(1);
  });
});
