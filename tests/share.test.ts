import { afterEach, describe, expect, test } from "bun:test";
import { shareReport } from "../src/hosts/azure-devops/share.ts";
import type { HttpFetch } from "../src/hosts/host.ts";
import { shareable } from "../src/hosts/index.ts";
import { FakeAz, fakeHosts, ok, Repo } from "./helpers.ts";

const repos: Repo[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.close();
});

function adoRepo(): Repo {
  const r = new Repo();
  r.git("remote", "add", "origin", "https://dev.azure.com/org/proj/_git/Shop");
  repos.push(r);
  return r;
}

const API = "https://dev.azure.com/org/proj-id/_apis/git/repositories/repo-id/pullRequests/7";
const WEB = "https://dev.azure.com/org/proj/_git/Shop/pullrequest/7";

/** az for a branch with PR 7 at `sha`, then a token. */
const az = (sha: string) =>
  new FakeAz([
    ok([{ pullRequestId: 7, targetRefName: "refs/heads/main" }]),
    ok({
      url: API,
      lastMergeSourceCommit: { commitId: sha },
      repository: { webUrl: "https://dev.azure.com/org/proj/_git/Shop" },
    }),
    { status: 0, stdout: "tok\n", stderr: "" },
  ]);

/** Azure DevOps replaced: answers in order, records each request. */
function http(answers: unknown[]) {
  const calls: { method: string; url: string; headers: Record<string, string>; body: string }[] = [];
  const fetch: HttpFetch = async (url, init) => {
    calls.push({
      method: String(init.method),
      url,
      headers: init.headers as Record<string, string>,
      body: String(init.body ?? ""),
    });
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 });
  };
  return { calls, fetch };
}

describe("share", () => {
  test("only changes an Azure DevOps PR can show", () => {
    const plain = new Repo();
    repos.push(plain);
    expect(shareable(plain.collect(), fakeHosts())).toBe(false);
    const r = adoRepo();
    expect(shareable(r.collect(), fakeHosts())).toBe(true);
    r.write({ "app/models/draft.rb": "class Draft\nend\n" });
    expect(shareable(r.collect({ uncommitted: true }), fakeHosts())).toBe(false);
  });

  test("uploads the report to the branch's PR and comments with its link", async () => {
    const r = adoRepo();
    const facts = r.collect();
    const { calls, fetch } = http([{ value: [] }, { url: "https://dev.azure.com/att/1" }, { id: 42 }]);
    const result = await shareReport(r.path, facts, "<html>report</html>", { az: az(facts.source.headSha), fetch });
    expect(result).toEqual({
      state: "shared",
      prId: "7",
      pr: `${WEB}?discussionId=42`,
      attachment: "https://dev.azure.com/att/1",
    });
    expect(calls.map((c) => [c.method, c.url.split("?")[0]])).toEqual([
      ["GET", `${API}/threads`],
      ["POST", `${API}/attachments/explain-change-${facts.key}.html`],
      ["POST", `${API}/threads`],
    ]);
    expect(calls[1]?.headers.Authorization).toBe("Bearer tok");
    expect(calls[1]?.body).toBe("<html>report</html>");
    const thread = JSON.parse(calls[2]?.body ?? "{}");
    expect(thread.comments[0].content).toContain("](https://dev.azure.com/att/1)");
    expect(thread.comments[0].content).toContain(facts.source.headSha.slice(0, 8));
  });

  test("a PR that already has this report gets no second copy, unless forced", async () => {
    const r = adoRepo();
    const facts = r.collect();
    const content = `**explain-change**: [x](https://dev.azure.com/att/explain-change-${facts.key}.html), …`;
    const { calls, fetch } = http([{ value: [{ id: 3, comments: [{ content }] }] }]);
    const result = await shareReport(r.path, facts, "html", { az: az(facts.source.headSha), fetch });
    expect(result.state).toBe("already-shared");
    expect(result.pr).toBe(`${WEB}?discussionId=3`);
    expect(calls).toHaveLength(1);
  });

  test("never shares a report of other commits than the PR's", async () => {
    const r = adoRepo();
    const facts = r.collect();
    const { calls, fetch } = http([]);
    await expect(shareReport(r.path, facts, "html", { az: az("0".repeat(40)), fetch })).rejects.toThrow(
      "push your commits",
    );
    r.write({ "app/models/draft.rb": "class Draft\nend\n" });
    await expect(
      shareReport(r.path, r.collect({ uncommitted: true }), "html", { az: az(facts.source.headSha), fetch }),
    ).rejects.toThrow("uncommitted");
    expect(calls).toHaveLength(0);
  });
});
