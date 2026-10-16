import { ADO_RESOURCE } from "../../core/constants.ts";
import { UserError } from "../../core/errors.ts";
import type { PrMeta } from "../host.ts";
import { remotes, remoteUrl, safeDecode, splitUrl } from "../source.ts";
import { AZ_SETUP, type Az, azHint } from "./az.ts";

/*
 * Azure DevOps pull requests through the `az` CLI: ids, URLs, metadata and the token git uses on HTTPS remotes.
 * When az has no session or it expired, `az login` runs once, in the browser.
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

/** The id of the active PR from a branch: what `explain-change pr` without an id explains. */
export function branchPr(root: string, branch: string, az: Az): string {
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

/** The remote of the PR's repository: the one whose URL matches az's metadata, else origin, else the only one. */
export function adoRemote(root: string, meta: PrMeta): string {
  const names = remotes(root);
  if (!names.length) throw new UserError("This repository has no git remote to fetch the PR from.");
  const known = new Set((meta.repo?.urls ?? []).map((u) => decodeURIComponent(u.replace(/\/+$/, "").toLowerCase())));
  const name = (meta.repo?.name ?? "").toLowerCase();
  for (const r of names) {
    let url = safeDecode(remoteUrl(root, r)).replace(/\/+$/, "").toLowerCase();
    if (url.endsWith(".git")) url = url.slice(0, -4);
    if (known.has(url) || (name && isAdoRepoUrl(url) && url.slice(url.lastIndexOf("/") + 1) === name)) return r;
  }
  if (names.includes("origin")) return "origin";
  if (names.length === 1) return names[0] as string;
  throw new UserError(`Cannot tell which remote holds the PR (${names.join(", ")}); name it origin or log in with az.`);
}

const branchName = (ref: string | undefined) => (ref ? ref.replace(/^refs\/heads\//, "") : undefined);

/** az's metadata as the hosts' PrMeta. */
export function toPrMeta(meta: PrMetadata, prId: string): PrMeta {
  const webUrl = meta.repository?.webUrl;
  return {
    title: meta.title,
    description: meta.description,
    sourceBranch: branchName(meta.sourceRefName),
    targetBranch: branchName(meta.targetRefName),
    status: meta.mergeStatus || meta.status,
    webUrl: webUrl ? `${webUrl}/pullrequest/${prId}` : undefined,
    repo: meta.repository && {
      name: meta.repository.name,
      urls: [meta.repository.remoteUrl, meta.repository.sshUrl].filter((u): u is string => Boolean(u)),
    },
  };
}
