import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { share } from "../src/cli/commands/share.ts";
import { gitHubPrId, gitHubSlug, gitHubWebUrl } from "../src/hosts/github/pr.ts";
import { branchHost, prHost, shareable } from "../src/hosts/index.ts";
import { prFileUrl } from "../src/hosts/links.ts";
import { prSource } from "../src/hosts/source.ts";
import { FakeGh, fakeHosts, ok, Repo, throwsUser } from "./helpers.ts";

const repos: Repo[] = [];
const repo = (opts?: { empty?: boolean }) => {
  const r = new Repo(undefined, opts);
  repos.push(r);
  return r;
};
afterEach(() => {
  for (const r of repos.splice(0)) r.close();
});

const none = { flag: null, config: null };
const ADO = "https://dev.azure.com/org/proj/_git/repo";
const GITHUB = "git@github.com:org/repo.git";

describe("host selection", () => {
  test("a PR id goes to the host of the remotes, Azure DevOps first", () => {
    const r = repo();
    r.git("remote", "add", "origin", GITHUB);
    expect(prHost(r.path, "42", fakeHosts(), none).id).toBe("github");
    r.git("remote", "add", "ado", ADO);
    expect(prHost(r.path, "42", fakeHosts(), none).id).toBe("azure-devops");
    expect(prHost(r.path, "42", fakeHosts(), { flag: null, config: "github" }).id).toBe("github");
    expect(prHost(r.path, "42", fakeHosts(), { flag: "azure-devops", config: "github" }).id).toBe("azure-devops");
  });

  test("a PR URL names its host; a chosen host needs a remote of it for an id", () => {
    const r = repo();
    r.git("remote", "add", "origin", ADO);
    expect(prHost(r.path, "https://github.com/org/repo/pull/42", fakeHosts(), none).id).toBe("github");
    throwsUser(
      () => prHost(r.path, "https://github.com/org/repo/pull/42", fakeHosts(), { flag: "azure-devops", config: null }),
      "does not match the PR URL",
    );
    throwsUser(() => prHost(r.path, "42", fakeHosts(), { flag: "github", config: null }), "GitHub remotes");
  });

  test("a branch records the host its PR would be on", () => {
    const r = repo();
    expect(branchHost(r.path, fakeHosts(), none)).toBeNull();
    expect(r.collect().source.host).toBeNull();
    r.git("remote", "add", "origin", GITHUB);
    expect(r.collect().source.host).toBe("github");
    expect(branchHost(r.path, fakeHosts(), { flag: "azure-devops", config: null })?.id).toBe("azure-devops");
  });
});

describe("GitHub", () => {
  test("PR ids, URLs and remotes", () => {
    for (const pr of [
      "42",
      "#42",
      " 42 ",
      "https://github.com/o/r/pull/42",
      "https://github.com/o/r/pull/42/files?x=1#y",
    ])
      expect(gitHubPrId(pr)).toBe("42");
    for (const pr of ["feature", "https://github.com/o/r/issues/42", "https://example.com/o/r/pull/42"])
      throwsUser(() => gitHubPrId(pr), "Expected a PR id");
    expect(gitHubWebUrl("https://github.com/O/r/pull/42/files#x", "42")).toBe("https://github.com/O/r/pull/42");
    expect(gitHubWebUrl("42", "42")).toBeNull();
    for (const url of [
      GITHUB,
      "https://github.com/Org/Repo",
      "https://x@github.com/org/repo.git/",
      "ssh://git@github.com/org/repo",
    ])
      expect(gitHubSlug(url)).toBe("org/repo");
    expect(gitHubSlug("https://github.com.evil.io/org/repo")).toBeNull();
  });

  /** A clone of a "server" with GitHub's refs/pull/<id>/head and refs/pull/<id>/merge. */
  function gitHubClone(withMerge: boolean) {
    const server = repo();
    server.git("update-ref", "refs/pull/42/head", "feature");
    if (withMerge) {
      server.git("checkout", "-q", "main");
      server.git("merge", "-q", "--no-ff", "feature", "-m", "Merge PR 42");
      server.git("update-ref", "refs/pull/42/merge", "HEAD");
      server.git("reset", "-q", "--hard", "HEAD~1");
    }
    const clone = repo({ empty: true });
    const path = `${clone.path}/c`;
    spawnSync("git", ["clone", "-q", server.path, path], { env: process.env });
    return path;
  }
  const changed = (path: string, src: { mergeBase: string; headSha: string }) =>
    spawnSync("git", ["diff", "--name-only", src.mergeBase, src.headSha], { cwd: path, encoding: "utf8" })
      .stdout.split(/\s+/)
      .filter(Boolean);
  const pr = {
    title: "Add line items",
    body: "Why",
    headRefName: "feature",
    baseRefName: "main",
    url: "https://github.com/org/repo/pull/42",
    state: "OPEN",
    mergeable: "MERGEABLE",
  };

  test("merge ref with gh metadata; a pasted URL names the repository", () => {
    const path = gitHubClone(true);
    const gh = new FakeGh([ok(pr)]);
    const notes: string[] = [];
    const src = prSource(path, fakeHosts({ gh }).github, "https://github.com/org/repo/pull/42/files", notes);
    expect(changed(path, src)).toEqual(["app/models/order.rb"]);
    expect([src.host, src.prId, src.title, src.branch, src.baseRef, src.url]).toEqual([
      "github",
      "42",
      "Add line items",
      "feature",
      "main",
      "https://github.com/org/repo/pull/42",
    ]);
    const args = gh.calls[0] as string[];
    expect(args.slice(0, 3)).toEqual(["pr", "view", "42"]);
    expect(args[args.indexOf("--repo") + 1]).toBe("org/repo");
    expect(notes).toEqual([]);
  });

  test("no merge ref: refs/pull/<id>/head against its merge base; without gh it stops", () => {
    const path = gitHubClone(false);
    const notes: string[] = [];
    const conflicting = { ...pr, mergeable: "CONFLICTING" };
    const src = prSource(path, fakeHosts({ gh: new FakeGh([ok(conflicting)]) }).github, "42", notes);
    expect(changed(path, src)).toEqual(["app/models/order.rb"]);
    expect(src.headRef).toBe("refs/explain-change/pr-42/source");
    expect(notes[0]).toContain("conflicts");
    throwsUser(() => prSource(path, fakeHosts().github, "42", []), "gh auth login");
  });

  test("`pr` without an id finds the branch's open PR", () => {
    const r = repo();
    const gh = new FakeGh([ok([{ number: 42, baseRefName: "main" }])]);
    expect(fakeHosts({ gh }).github.api.activePr(r.path, "feature")).toBe("42");
    expect(gh.calls[0]?.slice(0, 4)).toEqual(["pr", "list", "--head", "feature"]);
    throwsUser(
      () => fakeHosts({ gh: new FakeGh([ok([])]) }).github.api.activePr(r.path, "feature"),
      "explain-change local",
    );
    throwsUser(
      () =>
        fakeHosts({
          gh: new FakeGh([
            ok([
              { number: 1, baseRefName: "main" },
              { number: 2, baseRefName: "release" },
            ]),
          ]),
        }).github.api.activePr(r.path, "feature"),
      "1 → main, 2 → release",
    );
  });

  test("git over HTTPS takes gh's token as basic auth", () => {
    const r = repo();
    const host = fakeHosts({ gh: new FakeGh([{ status: 0, stdout: "tok\n", stderr: "" }]) }).github;
    expect(host.git.auth(r.path)).toBe(`Basic ${Buffer.from("x-access-token:tok").toString("base64")}`);
    expect(host.git.takesToken("https://github.com/org/repo")).toBe(true);
    expect(host.git.takesToken(GITHUB)).toBe(false);
  });

  test("file links use GitHub's diff anchors", () => {
    const path = "app/models/order.rb";
    const anchor = createHash("sha256").update(path).digest("hex");
    expect(prFileUrl("github", pr.url, path)).toBe(`${pr.url}/files#diff-${anchor}`);
  });

  test("share says GitHub cannot take the report", async () => {
    const r = repo();
    r.git("remote", "add", "origin", GITHUB);
    const facts = r.collect();
    expect(shareable(facts, fakeHosts())).toBe(false);
    r.run(["local", "--base", "main", "--no-open"]);
    await expect(share({ force: false, json: false }, fakeHosts(), r.path)).rejects.toThrow(
      "GitHub cannot take the report",
    );
  });
});
