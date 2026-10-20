import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NormalizedExplanation } from "../src/contract/explanation.ts";
import type { Facts, FileFacts } from "../src/contract/facts.ts";
import { DEFAULT_BUDGET } from "../src/core/constants.ts";
import { buildDigest } from "../src/digest/digest.ts";
import { draftExplanation } from "../src/explanation/draft.ts";
import { validateExplanation } from "../src/explanation/validate.ts";
import { readReportData } from "../src/report/data.ts";
import { renderHtml } from "../src/report/render.ts";
import { interdiff, lastReview, patchHash, recordReview, type Since, since, snapshot } from "../src/review/since.ts";
import { smoke } from "./dom.ts";
import { ROOT, tempDir } from "./helpers.ts";

const data = readReportData(readFileSync(join(ROOT, "examples/real-maybe-rails-data-exports.html"), "utf8"));
const base: Facts = data.facts;
const clone = (f: Facts): Facts => JSON.parse(JSON.stringify(f));
/** The PR at another head: `edit` changes its files. */
function at(head: string, edit: (files: FileFacts[]) => void = () => {}, mergeBase = base.source.mergeBase): Facts {
  const f = clone(base);
  f.source.headSha = head;
  f.source.mergeBase = mergeBase;
  edit(f.files);
  return f;
}
const code = base.files.find((f) => f.hunks.some((h) => h.lines.some(([m]) => m === "+"))) as FileFacts;
/** The PR at head b…b, with 1 added line of `path` edited: its patch changed since the review of `base`. */
function editedAt(path: string): Facts {
  return at("b".repeat(40), (files) => {
    const f = files.find((x) => x.path === path) as FileFacts;
    (f.hunks.flatMap((h) => h.lines).find(([m]) => m === "+") as [string, string])[1] += " # again";
  });
}
const status = { state: data.state, issues: data.issues, explanation: data.explanation };

describe("since your review", () => {
  test("a patch keeps its hash when its lines move, not when its own lines change", () => {
    const moved = clone(base).files.find((f) => f.path === code.path) as FileFacts;
    for (const h of moved.hunks) {
      h.oldStart += 40;
      h.newStart += 40;
    }
    expect(patchHash(moved)).toBe(patchHash(code));
    const edited = clone(base).files.find((f) => f.path === code.path) as FileFacts;
    const line = edited.hunks.flatMap((h) => h.lines).find(([m]) => m === "+") as [string, string];
    line[1] += " # edited";
    expect(patchHash(edited)).not.toBe(patchHash(code));
  });

  test("files and components are new, changed again or the same; a file the PR left is gone", () => {
    const review = snapshot(base);
    const dropped = base.files.find((f) => f.path !== code.path) as FileFacts;
    const now = editedAt(code.path);
    now.files = now.files.filter((x) => x.path !== dropped.path);
    review.files["app/legacy.rb"] = { patch: "x", component: null }; // in the PR at your review only
    const s = since(review, now);
    expect(s.files[code.path]).toBe("again");
    expect(s.gone).toEqual(["app/legacy.rb", dropped.path].sort());
    expect(Object.values(s.files).filter((v) => v === "same").length).toBe(now.files.length - 1);
    expect(s.components[code.component as string]).toBe("again");
    expect(s.rebased).toBe(false);
    // a component untouched at your review is new
    const fresh = snapshot(base);
    for (const f of Object.values(fresh.files)) if (f.component === code.component) f.component = "elsewhere";
    expect(since(fresh, base).components[code.component as string]).toBe("new");
  });

  test("an interdiff lists what a patch gained (>) and lost (<), in order", () => {
    expect(interdiff(["+a", "+b", "-c"], ["+a", "+B", "-c", "+d"])).toEqual(["< +b", "> +B", "> +d"]);
    expect(interdiff(["+a"], ["+a"])).toEqual([]);
    expect(interdiff(undefined, ["+a"])).toBeNull();
  });

  test("a moved merge base reads as rebased; the same patches stay the same", () => {
    const s = since(snapshot(base), at("c".repeat(40), undefined, "d".repeat(40)));
    expect(s.rebased).toBe(true);
    expect(Object.values(s.files).every((v) => v === "same")).toBe(true);
  });

  test("a valid report records its head; the delta is against the latest other head, and none for a branch", () => {
    const work = tempDir();
    const reviewDelta = (f: Facts, record: boolean) => {
      const r = lastReview(work, f);
      if (record) recordReview(work, f);
      return r ? since(r, f) : null;
    };
    expect(reviewDelta(base, true)).toBeNull(); // the first review
    expect(reviewDelta(base, true)).toBeNull(); // the same head again
    const next = at("e".repeat(40));
    expect(reviewDelta(next, false)?.head).toBe(base.source.headSha); // a draft records nothing
    expect(reviewDelta(next, true)?.head).toBe(base.source.headSha);
    expect(reviewDelta(next, true)?.head).toBe(base.source.headSha); // rendering it again keeps the review before
    const third = at("f".repeat(40));
    expect(reviewDelta(third, true)?.head).toBe(next.source.headSha);
    const local = clone(base);
    local.source.kind = "local";
    expect(reviewDelta(local, true)).toBeNull();
  });

  test("the page says since when, rings what changed on the map and marks it in the changes", () => {
    const now = editedAt(code.path);
    const s = since(snapshot(base), now);
    const page = renderHtml(now, status, s);
    let out = { banner: "", rings: 0, pills: 0, pressed: "" };
    smoke(page, (app) => {
      out = {
        banner: app.querySelectorAll(".since")[0]?.textContent ?? "",
        rings: app.querySelectorAll(".since-ring").length,
        pills: app.querySelectorAll(".chg-list .since-pill").length,
        pressed: app.querySelectorAll(".since-toggle")[0]?.getAttribute("aria-pressed") ?? "",
      };
    });
    expect(out.banner).toContain("Since your review");
    expect(out.banner).toContain("1 changed again");
    expect(out.rings).toBe(1);
    expect(out.pills).toBe(2); // the component and its file
    expect(out.pressed).toBe("true");
    // without a review, the page has none of it
    let none = -1;
    smoke(renderHtml(base, status), (app) => {
      none = app.querySelectorAll(".since").length + app.querySelectorAll(".since-ring").length;
    });
    expect(none).toBe(0);
  });

  describe("what the agent writes about it", () => {
    const now = editedAt(code.path);
    const review = snapshot(base);
    const s = since(review, now);
    const comp = code.component as string;
    const written = {
      review: base.source.headSha,
      summary: "The export now names its file.",
      components: [{ id: comp, summary: "It names the file." }],
    };

    test("the draft asks for it only when something moved since the review", () => {
      const draft = draftExplanation(now, s) as { since?: { review: string; components?: { id: string }[] } };
      expect(draft.since?.review).toBe(base.source.headSha);
      expect(draft.since?.components?.map((c) => c.id)).toEqual([comp]);
      expect(draftExplanation(now, since(review, base)).since).toBeUndefined();
      expect(draftExplanation(now).since).toBeUndefined();
    });

    test("the digest shows how each patch changed; without a review it has no such section", () => {
      const digest = buildDigest(now, DEFAULT_BUDGET, review);
      expect(digest).toContain(`## Since your review (${base.source.headSha.slice(0, 8)} → bbbbbbbb)`);
      expect(digest).toContain(`### ${code.path}`);
      expect(digest).toMatch(/^> \+.* # again$/m);
      expect(buildDigest(now, DEFAULT_BUDGET)).not.toContain("Since your review");
    });

    test("it is checked against the review it names, and not at all without one", () => {
      const issues = (sx: Since | null, w: unknown) =>
        validateExplanation({ ...data.explanation, key: now.key, since: w }, now, null, sx).filter((i) =>
          i.path.startsWith("since"),
        );
      expect(issues(s, written)).toEqual([]);
      expect(issues(s, { ...written, review: "c".repeat(40) })[0]?.code).toBe("stale");
      const same = Object.keys(s.components).find((id) => s.components[id] === "same") as string;
      expect(issues(s, { ...written, components: [{ id: same, summary: "x" }] })[0]?.code).toBe("not-allowed");
      expect(issues(null, { ...written, review: "c".repeat(40) })).toEqual([]);
    });

    test("the page shows it only for the review it was written for", () => {
      const banner = (sx: Since) => {
        let text = "";
        const explanation = { ...(data.explanation as NormalizedExplanation), since: written };
        smoke(renderHtml(now, { state: "valid", issues: [], explanation }, sx), (app) => {
          text = app.querySelectorAll(".since")[0]?.textContent ?? "";
        });
        return text;
      };
      expect(banner(s)).toContain(written.summary);
      expect(banner({ ...s, head: "c".repeat(40) })).not.toContain(written.summary);
    });
  });
});
