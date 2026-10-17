import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleTargets } from "../scripts/build-examples.ts";
import { argv, f1, fidelity, items, lift, readTranscript, spread } from "../scripts/eval-metrics.ts";
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
    const tool = (name: string, input: Record<string, string>) =>
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init" }),
      tool("Skill", { skill: "explain-change" }),
      tool("Bash", { command: "explain-change pr https://github.com/o/r/pull/1 --json" }),
      tool("Read", { file_path: "/tmp/r/.explain-change/digest.md" }),
      tool("Read", { file_path: "/tmp/r/app/models/order.rb" }),
      tool("Bash", { command: "explain-change render --json" }),
      tool("Bash", { command: "cd /tmp/r && explain-change  render --json" }),
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
      sourceReads: 1,
      skills: ["explain-change"],
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
});
