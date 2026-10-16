import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildScenario, scenarioNames } from "../scripts/build-examples.ts";
import type { Facts } from "../src/contract/facts.ts";
import { tempDir } from "./helpers.ts";

/** Every scenario built twice, from scratch, in two folders: the pages must be byte-identical. */
const runs: { dir: string; facts: Record<string, Facts> }[] = [];

beforeAll(() => {
  for (let i = 0; i < 2; i++) {
    const dir = tempDir("ec-e2e-");
    const facts: Record<string, Facts> = {};
    for (const name of scenarioNames()) facts[name] = buildScenario(name, dir, join(dir, `${name}.html`));
    runs.push({ dir, facts });
  }
}, 180_000); // 6 repositories built and explained: slow on Windows runners
afterAll(() => {
  for (const r of runs) rmSync(r.dir, { recursive: true, force: true });
});

const facts = (name: string) => runs[0]?.facts[name] as Facts;
const edges = (name: string) =>
  Object.fromEntries(
    facts(name).dependencies.map((e) => [
      `${e.from}->${e.to}`,
      [e.delta, Boolean(e.violation), Boolean(e.violation?.preexisting)],
    ]),
  );

describe("end to end", () => {
  test("the same change gives a byte-identical page", () => {
    for (const name of scenarioNames()) {
      expect(readFileSync(join(runs[0]?.dir as string, `${name}.html`))).toEqual(
        readFileSync(join(runs[1]?.dir as string, `${name}.html`)),
      );
    }
  });

  test("Rails: new dependencies through the layers, no violation", () => {
    const e = edges("01-marketplace-rails-refunds-es");
    for (const pair of ["controllers->refunds", "refunds->models", "refunds->payments", "refunds->mailers"]) {
      expect(e[pair]).toEqual(["added", false, false]);
    }
    expect(facts("01-marketplace-rails-refunds-es").stats.newViolations).toBe(0);
  });

  test("Django without config: components inferred from the apps", () => {
    expect(facts("02-ledger-django-no-config").config.inferred).toBe(true);
    const e = edges("02-ledger-django-no-config");
    expect(e["reports->billing"]).toBeDefined();
    expect(e["reports->accounts"]).toBeDefined();
  });

  test("Django with OpenSpec: requirement deltas and the new app", () => {
    const name = "03-orders-django-openspec-es";
    expect(edges(name)["orders-svc->notifications"]).toEqual(["added", false, false]);
    expect(edges(name)["notifications->orders-model"]).toEqual(["added", false, false]);
    expect(facts(name).components.find((c) => c.id === "notifications")?.delta).toBe("added");
    const reqs = Object.fromEntries(
      facts(name).openspec?.changes.flatMap((c) => c.requirements.map((r) => [r.id, r.op])) ?? [],
    );
    expect(reqs).toEqual({ "orders/email-de-confirmacion": "ADDED", "orders/crear-pedido": "MODIFIED" });
  });
});
