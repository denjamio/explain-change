import { spawnSync } from "node:child_process";
import type { HostId } from "../contract/config.ts";
import { FETCH_TIMEOUT_MS } from "../core/constants.ts";
import { UserError } from "../core/errors.ts";
import { git } from "../core/git.ts";
import type { PrHost } from "./host.ts";

/*
 * A PR as a change source, for any host: its commits through git, its title and links through the host. git never
 * prompts: it authenticates with the user's own credentials first and, on an HTTPS remote of the host, retries with
 * the token of the host's CLI.
 */

/** The part of the change source a PR decides. */
export interface PrSource {
  host: HostId;
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

/** Python's urlsplit, as far as the hosts need it: [scheme, host, path]. */
export function splitUrl(s: string): [string, string, string] {
  const m = URL_RE.exec(s);
  return m ? [(m[1] as string).toLowerCase(), m[2] as string, m[3] as string] : ["", "", s.split(/[?#]/)[0] as string];
}

/** The hostname of a URL, without user info or port; "" when it is not a URL. */
export const hostnameOf = (url: string) => (splitUrl(url.trim())[1].split("@").pop() as string).split(":")[0] as string;

export const remotes = (root: string) => git(["remote"], root).split(/\s+/).filter(Boolean);
export const remoteUrl = (root: string, name: string) =>
  git(["remote", "get-url", name], root, { check: false }).trim();

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** git fetch that never prompts; the header travels in the environment, never on the command line (git 2.31+). */
export function gitFetch(root: string, args: string[], auth: string | null): string | null {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  if (auth) {
    Object.assign(env, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: ${auth}`,
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
}

/** null when every refspec was fetched, else git's error. A missing ref is returned; any other error stops. */
export function fetchRefs(
  root: string,
  host: PrHost,
  remote: string,
  refspecs: string[],
  deps: FetchDeps = { fetch: gitFetch },
): string | null {
  const args = ["fetch", "--quiet", "--no-tags", remote, ...refspecs];
  let err = deps.fetch(root, args, null);
  const missing = (e: string | null) => Boolean(e?.toLowerCase().includes("couldn't find remote ref"));
  if (err && !missing(err) && host.takesToken(remoteUrl(root, remote))) {
    const auth = host.gitAuth(root);
    if (auth) err = deps.fetch(root, args, auth);
  }
  if (err && !missing(err)) {
    throw new UserError(
      `git fetch from '${remote}' failed: ${err.split("\n").pop()}\n` +
        `Check that \`git fetch\` works in this repository, or log in to ${host.name} (${host.setup}); ` +
        `explain-change then uses its token for HTTPS ${host.name} remotes.`,
    );
  }
  return err;
}

/**
 * The PR as a change source. Prefers the host's merge ref (the PR applied to its target); a PR without one
 * (merge conflicts, completed, abandoned) falls back to its own commits against the merge base with its target.
 */
export function prSource(root: string, host: PrHost, pr: string, notes: string[], deps?: FetchDeps): PrSource {
  const prId = host.prId(pr);
  const meta = host.metadata(root, prId, notes);
  const remote = host.remote(root, meta);
  const ref = `refs/explain-change/pr-${prId}`;
  const source = meta.sourceBranch ?? "";
  const target = meta.targetBranch ?? "";
  let head: string | null = null;
  let base: string | null = null;
  let headRef = `${ref}/merge`;
  if (!fetchRefs(root, host, remote, [`+${host.mergeRef(prId)}:${ref}/merge`], deps)) {
    const parents = git(["rev-list", "--parents", "-n", "1", `${ref}/merge`], root)
      .split(/\s+/)
      .filter(Boolean);
    if (parents.length >= 3) [head, base] = [parents[0] as string, parents[1] as string];
  }
  if (head === null || base === null) {
    headRef = `${ref}/source`;
    const own = host.headRef(prId, meta);
    if (!own || !target) {
      throw new UserError(
        `PR ${prId} has no merge ref (merge conflicts, completed or abandoned?), and without ${host.name} metadata its branches are unknown (${host.setup}).`,
      );
    }
    const err = fetchRefs(root, host, remote, [`+${own}:${ref}/source`, `+refs/heads/${target}:${ref}/target`], deps);
    if (err) {
      throw new UserError(
        `PR ${prId} has no merge ref, and its branches '${source || own}' → '${target}' cannot be fetched from '${remote}' (deleted after completion?).`,
      );
    }
    head = git(["rev-parse", headRef], root).trim();
    base = git(["merge-base", `${ref}/target`, head], root).trim();
    notes.push(
      `PR ${prId} has no merge ref (${meta.status || "unknown"}): explained as '${source || own}' against its merge base with '${target}'.`,
    );
  }
  return {
    host: host.id,
    prId,
    headRef,
    headSha: head,
    baseRef: target || base,
    mergeBase: base,
    branch: source || `pr-${prId}`,
    title: meta.title || `PR ${prId}`,
    description: (meta.description ?? "").slice(0, 4000),
    url: meta.webUrl ?? host.webUrlFrom(pr, prId),
  };
}
