import { UserError } from "../../core/errors.ts";
import type { PrMeta } from "../host.ts";
import { hostnameOf, remotes, remoteUrl, splitUrl } from "../source.ts";
import { GH_SETUP, type Gh, ghHint } from "./gh.ts";

/*
 * GitHub pull requests through the `gh` CLI: ids, URLs, metadata and the token git uses on HTTPS remotes.
 * GitHub keeps every PR's commits at refs/pull/<id>/head in the base repository, so PRs from forks need no
 * extra remote.
 */

const PR_PATH_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/i;

export const isGitHubHostname = (hostname: string) => /^(www\.)?github\.com$/i.test(hostname);

/** owner/name of a github.com remote (https, ssh or scp-like), lowercase; null for other remotes. */
export function gitHubSlug(url: string): string | null {
  const m =
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(url.trim()) ??
    /^(?:https?|ssh|git):\/\/(?:[^/@]*@)?(?:www\.)?github\.com(?::\d+)?\/([^/]+)\/(.+?)(?:\.git)?\/?$/i.exec(
      url.trim(),
    );
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

export const isGitHubHttps = (url: string) => /^https:\/\/([^/@]*@)?(www\.)?github\.com\//i.test(url);

/** The PR id from `42`, `#42` or a PR URL (…/pull/42, query, fragment and sub-pages ignored). */
export function gitHubPrId(pr: string): string {
  const s = pr.trim();
  const m = /^#?(\d+)$/.exec(s) ?? (isGitHubHostname(hostnameOf(s)) ? PR_PATH_RE.exec(splitUrl(s)[2]) : null);
  if (!m) {
    throw new UserError(
      `Expected a PR id or a GitHub pull request URL (…/pull/<id>), got '${pr}'. To explain a branch, run \`explain-change local\` on it.`,
    );
  }
  return m[m.length - 1] as string;
}

/** The PR page from a pasted URL, without sub-pages, query or fragment. */
export function gitHubWebUrl(pr: string, prId: string): string | null {
  const [scheme, , path] = splitUrl(pr.trim());
  const m = PR_PATH_RE.exec(path);
  if ((scheme !== "https" && scheme !== "http") || !m || m[3] !== prId) return null;
  return `https://github.com/${m[1]}/${m[2]}/pull/${prId}`;
}

/** owner/name from a PR page URL, for `gh --repo`. */
const repoOfWebUrl = (url: string | null) => {
  const m = url ? PR_PATH_RE.exec(splitUrl(url)[2]) : null;
  return m ? `${m[1]}/${m[2]}` : null;
};

function ghJson(gh: Gh, args: string[], root: string): { value: unknown } | { problem: string } {
  const p = gh.call(args, root);
  if ("error" in p) return { problem: `${p.error} (${GH_SETUP})` };
  if (p.status !== 0) return { problem: `gh ${args.slice(0, 2).join(" ")} failed: ${ghHint(p.stderr)}` };
  try {
    return { value: JSON.parse(p.stdout) };
  } catch {
    return { problem: `gh ${args.slice(0, 2).join(" ")} returned no JSON` };
  }
}

/** The number of the open PR from a branch: what `explain-change pr` without an id explains. */
export function activeGitHubPr(root: string, branch: string, gh: Gh): string {
  const r = ghJson(gh, ["pr", "list", "--head", branch, "--state", "open", "--json", "number,baseRefName"], root);
  if ("problem" in r) throw new UserError(`${r.problem}. Pass the PR id instead.`);
  const prs = r.value;
  if (!Array.isArray(prs)) throw new UserError("gh pr list returned no list. Pass the PR id instead.");
  if (!prs.length)
    throw new UserError(`No open PR from '${branch}'. Run \`explain-change local\` to explain the branch.`);
  if (prs.length > 1) {
    const found = prs.map((x) => `${x.number} → ${x.baseRefName}`).join(", ");
    throw new UserError(`Several open PRs from '${branch}' (${found}): pass the id, \`explain-change pr <id>\`.`);
  }
  return String(prs[0].number);
}

/** What `gh pr view --json` returns that the tool reads. */
interface GhPr {
  title?: string;
  body?: string;
  headRefName?: string;
  baseRefName?: string;
  url?: string;
  state?: string;
  mergeable?: string;
}

/**
 * `gh pr view`, or only the pasted PR page with a note saying what is missing and how to fix it. A pasted URL
 * names the repository, so gh does not guess it from the remotes.
 */
export function gitHubMetadata(root: string, prId: string, pasted: string | null, notes: string[], gh: Gh): PrMeta {
  const repo = repoOfWebUrl(pasted);
  const fields = "title,body,headRefName,baseRefName,url,state,mergeable";
  const r = ghJson(gh, ["pr", "view", prId, "--json", fields, ...(repo ? ["--repo", repo] : [])], root);
  if ("problem" in r) {
    notes.push(`${r.problem}: no PR title, description or file links.`);
    return { webUrl: pasted ?? undefined };
  }
  const pr = (r.value ?? {}) as GhPr;
  const url = pr.url ?? pasted ?? undefined;
  const slug = repoOfWebUrl(url ?? null);
  return {
    title: pr.title,
    description: pr.body,
    sourceBranch: pr.headRefName,
    targetBranch: pr.baseRefName,
    status: pr.mergeable === "CONFLICTING" ? "conflicts" : pr.state?.toLowerCase(),
    webUrl: url,
    repo: slug ? { name: slug.split("/")[1], urls: [`https://github.com/${slug}`] } : undefined,
  };
}

/** The remote of the PR's repository: the one with its owner/name, else origin, else the only one. */
export function gitHubRemote(root: string, meta: PrMeta): string {
  const names = remotes(root);
  if (!names.length) throw new UserError("This repository has no git remote to fetch the PR from.");
  const slugs = new Set((meta.repo?.urls ?? []).map(gitHubSlug).filter(Boolean));
  const match = names.find((r) => slugs.has(gitHubSlug(remoteUrl(root, r))));
  if (match) return match;
  if (names.includes("origin")) return "origin";
  if (names.length === 1) return names[0] as string;
  throw new UserError(
    `Cannot tell which remote holds the PR (${names.join(", ")}); name it origin or pass the PR URL.`,
  );
}

/** The token of `gh auth login`, or null. */
export function ghToken(root: string, gh: Gh): string | null {
  const p = gh.call(["auth", "token", "--hostname", "github.com"], root);
  return "error" in p || p.status !== 0 ? null : p.stdout.trim() || null;
}
