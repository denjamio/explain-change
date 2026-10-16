import { spawnSync } from "node:child_process";
import { ADO_RESOURCE, FETCH_TIMEOUT_MS } from "../core/constants.ts";
import { UserError } from "../core/errors.ts";
import { git } from "../core/git.ts";
import { AZ_SETUP, type Az, azHint } from "./az.ts";

/*
 * Azure DevOps pull requests: the PR's commits through git, its title and links through the `az` CLI. git never
 * prompts: it authenticates with the user's own credentials first and, on an HTTPS Azure DevOps remote, retries
 * with the `az login` token. When az has no session or it expired, `az login` runs once, in the browser.
 */

/** What `az repos pr show` returns that the tool reads. */
export interface PrMetadata {
  title?: string;
  description?: string;
  sourceRefName?: string;
  targetRefName?: string;
  mergeStatus?: string;
  status?: string;
  repository?: { name?: string; webUrl?: string; remoteUrl?: string; sshUrl?: string };
}

/** The part of the change source a PR decides. */
export interface PrSource {
  prId: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  mergeBase: string;
  branch: string;
  title: string;
  description: string;
  url: string | null;
}

const URL_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;

/** Python's urlsplit, as far as this module needs it: [scheme, host, path]. */
function splitUrl(s: string): [string, string, string] {
  const m = URL_RE.exec(s);
  return m ? [(m[1] as string).toLowerCase(), m[2] as string, m[3] as string] : ["", "", s.split(/[?#]/)[0] as string];
}

/** The PR id from `1234`, `!1234` or a PR URL (query and fragment ignored). */
export function adoPrId(pr: string): string {
  const s = pr.trim();
  const m = /^!?(\d+)$/.exec(s) ?? /\/pullrequest\/(\d+)(?:\/|$)/i.exec(splitUrl(s)[2]);
  if (!m) {
    throw new UserError(
      `Expected a PR id or a pull request URL (…/pullrequest/<id>), got '${pr}'. To explain a branch, run \`explain-change local\` on it.`,
    );
  }
  return m[1] as string;
}

/** The PR page from a pasted URL, without its query, so file links can append their own. */
export function adoWebUrl(pr: string, prId: string): string | null {
  const [scheme, host, rawPath] = splitUrl(pr.trim());
  if (scheme !== "http" && scheme !== "https") return null;
  const path = rawPath.replace(/(\/pullrequest\/\d+).*$/i, "$1");
  return path.toLowerCase().endsWith(`/pullrequest/${prId}`) ? `${scheme}://${host}${path}` : null;
}

export const isAdoHttps = (url: string) =>
  /^https:\/\/([^/@]*@)?(dev\.azure\.com|[^/]+\.visualstudio\.com)\//i.test(url);
export const isAdoRepoUrl = (url: string) =>
  url.includes("/_git/") || url.includes("ssh.dev.azure.com") || url.includes("vs-ssh.visualstudio.com");

const remotes = (root: string) => git(["remote"], root).split(/\s+/).filter(Boolean);
const remoteUrl = (root: string, name: string) => git(["remote", "get-url", name], root, { check: false }).trim();

/** A PR is explained from Azure DevOps: its URL, or else (an id, or no PR yet) a remote of this repository. */
export function requireAdo(root: string, pr: string): void {
  const host = splitUrl(pr.trim())[1].toLowerCase();
  if (host) {
    if (!/(^|\.)dev\.azure\.com$|\.visualstudio\.com$/.test(host.split("@").pop() as string)) {
      throw new UserError(
        `Only Azure DevOps PRs are supported, not ${host}. Check out the PR branch and run \`explain-change local\`.`,
      );
    }
    return;
  }
  const urls = remotes(root).map((r) => remoteUrl(root, r).toLowerCase());
  if (!urls.some((u) => isAdoHttps(u) || isAdoRepoUrl(u))) {
    throw new UserError(
      "PR ids work with Azure DevOps remotes, and this repository has none. Check out the PR branch and run `explain-change local`.",
    );
  }
}

/** The repository name in the first Azure DevOps remote (…/_git/<name> or ssh …/v3/org/project/<name>). */
export function adoRepoName(root: string): string | null {
  for (const r of remotes(root)) {
    const url = remoteUrl(root, r).replace(/\/+$/, "");
    if (isAdoHttps(url) || isAdoRepoUrl(url)) {
      const name = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
      return name.endsWith(".git") ? name.slice(0, -4) : name;
    }
  }
  return null;
}

/** The id of the active PR from the current branch: what `explain-change pr` without an id explains. */
export function branchPr(root: string, az: Az): string {
  requireAdo(root, "");
  const branch = git(["branch", "--show-current"], root).trim();
  if (!branch) throw new UserError("HEAD is detached: pass the PR id, `explain-change pr <id>`.");
  const repo = adoRepoName(root);
  const args = ["repos", "pr", "list", "--source-branch", branch, "--status", "active", "-o", "json"];
  const p = az.run([...args, ...(repo ? ["--repository", repo] : [])], root);
  if ("error" in p) throw new UserError(`${p.error}: pass the PR id, or ${AZ_SETUP}.`);
  if (p.status !== 0) throw new UserError(`az repos pr list failed: ${azHint(p.stderr)}. Pass the PR id instead.`);
  let prs: unknown;
  try {
    prs = JSON.parse(p.stdout);
  } catch {
    prs = null;
  }
  if (!Array.isArray(prs)) throw new UserError("az repos pr list returned no list. Pass the PR id instead.");
  if (!prs.length)
    throw new UserError(`No active PR from '${branch}'. Run \`explain-change local\` to explain the branch.`);
  if (prs.length > 1) {
    const found = prs
      .map((x) => `${x.pullRequestId} → ${String(x.targetRefName ?? "").replace(/^refs\/heads\//, "")}`)
      .join(", ");
    throw new UserError(`Several active PRs from '${branch}' (${found}): pass the id, \`explain-change pr <id>\`.`);
  }
  return String(prs[0].pullRequestId);
}

/** `az repos pr show`, or {} with a note saying what is missing and how to fix it. */
export function adoMetadata(root: string, prId: string, notes: string[], az: Az): PrMetadata {
  const p = az.run(["repos", "pr", "show", "--id", prId, "-o", "json"], root);
  if ("error" in p) {
    notes.push(`${p.error}: no PR title, description or file links (${AZ_SETUP}).`);
    return {};
  }
  if (p.status !== 0) {
    notes.push(`az repos pr show failed, so no PR title, description or file links: ${azHint(p.stderr)}.`);
    return {};
  }
  try {
    const meta = JSON.parse(p.stdout);
    return meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
  } catch {
    notes.push("az repos pr show returned no JSON: no PR title, description or file links.");
    return {};
  }
}

/** An Azure DevOps access token from `az login`, or null. */
export function azToken(root: string, az: Az): string | null {
  const p = az.run(
    ["account", "get-access-token", "--resource", ADO_RESOURCE, "--query", "accessToken", "-o", "tsv"],
    root,
  );
  return "error" in p || p.status !== 0 ? null : p.stdout.trim() || null;
}

/** git fetch that never prompts; the token travels in the environment, never on the command line (git 2.31+). */
export function gitFetch(root: string, args: string[], token: string | null): string | null {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  if (token) {
    Object.assign(env, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
    });
  }
  const p = spawnSync("git", args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: FETCH_TIMEOUT_MS,
    encoding: "utf8",
  });
  if (p.error && (p.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    throw new UserError(`git ${args.join(" ")} timed out after ${FETCH_TIMEOUT_MS / 1000}s.`);
  }
  return p.status === 0 ? null : p.stderr.trim() || "git fetch failed";
}

export interface FetchDeps {
  fetch: typeof gitFetch;
  token: (root: string) => string | null;
}

/** null when every refspec was fetched, else git's error. A missing ref is returned; any other error stops. */
export function adoFetch(root: string, remote: string, refspecs: string[], deps: FetchDeps): string | null {
  const args = ["fetch", "--quiet", "--no-tags", remote, ...refspecs];
  let err = deps.fetch(root, args, null);
  const missing = (e: string | null) => Boolean(e?.toLowerCase().includes("couldn't find remote ref"));
  if (err && !missing(err) && isAdoHttps(remoteUrl(root, remote))) {
    const token = deps.token(root);
    if (token) err = deps.fetch(root, args, token);
  }
  if (err && !missing(err)) {
    throw new UserError(
      `git fetch from '${remote}' failed: ${err.split("\n").pop()}\n` +
        "Check that `git fetch` works in this repository, or log in with `az login` " +
        "(explain-change then uses its token for HTTPS Azure DevOps remotes).",
    );
  }
  return err;
}

/** The remote of the PR's repository: the one whose URL matches az's metadata, else origin, else the only one. */
export function adoRemote(root: string, meta: PrMetadata): string {
  const names = remotes(root);
  if (!names.length) throw new UserError("This repository has no git remote to fetch the PR from.");
  const repo = meta.repository ?? {};
  const known = new Set(
    [repo.remoteUrl, repo.sshUrl]
      .filter((u): u is string => Boolean(u))
      .map((u) => decodeURIComponent(u.replace(/\/+$/, "").toLowerCase())),
  );
  const name = (repo.name ?? "").toLowerCase();
  for (const r of names) {
    let url = safeDecode(remoteUrl(root, r)).replace(/\/+$/, "").toLowerCase();
    if (url.endsWith(".git")) url = url.slice(0, -4);
    if (known.has(url) || (name && isAdoRepoUrl(url) && url.slice(url.lastIndexOf("/") + 1) === name)) return r;
  }
  if (names.includes("origin")) return "origin";
  if (names.length === 1) return names[0] as string;
  throw new UserError(`Cannot tell which remote holds the PR (${names.join(", ")}); name it origin or log in with az.`);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The PR as a change source. Prefers Azure DevOps' merge ref (the PR applied to its target); a PR without one
 * (merge conflicts, completed, abandoned) falls back to its source branch against the merge base with its target.
 */
export function adoSource(root: string, pr: string, notes: string[], az: Az, deps?: FetchDeps): PrSource {
  const fetchDeps = deps ?? { fetch: gitFetch, token: (r: string) => azToken(r, az) };
  const prId = adoPrId(pr);
  const meta = adoMetadata(root, prId, notes, az);
  const remote = adoRemote(root, meta);
  const ref = `refs/explain-change/pr-${prId}`;
  const source = (meta.sourceRefName ?? "").replace(/^refs\/heads\//, "");
  const target = (meta.targetRefName ?? "").replace(/^refs\/heads\//, "");
  let head: string | null = null;
  let base: string | null = null;
  let headRef = `${ref}/merge`;
  if (!adoFetch(root, remote, [`+refs/pull/${prId}/merge:${ref}/merge`], fetchDeps)) {
    const parents = git(["rev-list", "--parents", "-n", "1", `${ref}/merge`], root)
      .split(/\s+/)
      .filter(Boolean);
    if (parents.length >= 3) [head, base] = [parents[0] as string, parents[1] as string];
  }
  if (head === null || base === null) {
    headRef = `${ref}/source`;
    if (!source || !target) {
      throw new UserError(
        `PR ${prId} has no merge ref (merge conflicts, completed or abandoned?), and without az metadata its branches are unknown (${AZ_SETUP}).`,
      );
    }
    const err = adoFetch(
      root,
      remote,
      [`+refs/heads/${source}:${ref}/source`, `+refs/heads/${target}:${ref}/target`],
      fetchDeps,
    );
    if (err) {
      throw new UserError(
        `PR ${prId} has no merge ref, and its branches '${source}' → '${target}' cannot be fetched from '${remote}' (deleted after completion?).`,
      );
    }
    head = git(["rev-parse", headRef], root).trim();
    base = git(["merge-base", `${ref}/target`, head], root).trim();
    notes.push(
      `PR ${prId} has no merge ref (${meta.mergeStatus || meta.status || "unknown"}): explained as '${source}' against its merge base with '${target}'.`,
    );
  }
  const webUrl = meta.repository?.webUrl;
  return {
    prId,
    headRef,
    headSha: head,
    baseRef: target || base,
    mergeBase: base,
    branch: source || `pr-${prId}`,
    title: meta.title || `PR ${prId}`,
    description: (meta.description ?? "").slice(0, 4000),
    url: webUrl ? `${webUrl}/pullrequest/${prId}` : adoWebUrl(pr, prId),
  };
}
