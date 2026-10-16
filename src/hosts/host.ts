import type { HostId } from "../contract/config.ts";
import type { Facts } from "../contract/facts.ts";

/*
 * Where pull requests live. The analysis never talks to a host: `local` needs none, and `pr` asks the host's API for
 * the PR and its metadata, and its git side for the refs that hold its commits. git does the rest (./source.ts), the
 * same for every host. Each adapter wraps the host's own CLI, so the user's login is the only credential the tool
 * uses. A new host is one folder with an adapter, registered in ./index.ts and ./links.ts.
 */

/** What a host says about a PR. Every field can be missing: without its CLI, a PR still has its refs. */
export interface PrMeta {
  title?: string;
  description?: string;
  /** Branch names, without refs/heads/. */
  sourceBranch?: string;
  targetBranch?: string;
  /** Why the PR has no merge ref (conflicts, completed…), for the note that says so. */
  status?: string;
  /** The PR page. */
  webUrl?: string;
  /** The PR's repository, to find the remote that holds it. */
  repo?: { name?: string; urls: string[] };
}

export interface ShareResult {
  state: "shared" | "already-shared";
  prId: string;
  /** The PR page, the comment thread when the URL is known. */
  pr: string | null;
  attachment: string;
}

/** Attaches a finished report to the PR of its change and comments with the link. */
export type ShareFn = (root: string, facts: Facts, html: string, force: boolean) => Promise<ShareResult>;

/** HTTP as `fetch` does it; adapters take it injected, so tests replace it. */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

/** A PR as the user named it, parsed once: its id and, from a pasted URL, its page. */
export interface PrRef {
  id: string;
  /** The PR page from a pasted URL, without sub-pages or query; null for a bare id. */
  webUrl: string | null;
}

/** The host's API side, through its CLI: what it knows about PRs and what it takes. */
export interface PrApi {
  /** The PR from an id or a PR URL of this host; a UserError for anything else. */
  parse(input: string): PrRef;
  /** The id of the open PR from a branch. */
  activePr(root: string, branch: string): string;
  /** What the host says about a PR, or less, with a note in `notes` that says what is missing. */
  metadata(root: string, pr: PrRef, notes: string[]): PrMeta;
  /** null when the host cannot take a report as a PR attachment. */
  readonly share: ShareFn | null;
}

/** The git side: where a PR's commits live and how git reaches them. */
export interface PrGit {
  /** The remote that holds the PR. */
  remote(root: string, meta: PrMeta): string;
  /** The ref that holds the PR applied to its target (a merge commit: target, then source). */
  mergeRef(prId: string): string;
  /** The ref with the PR's own commits, for a PR without a merge ref; null when it is unknown. */
  headRef(prId: string, meta: PrMeta): string | null;
  /** Whether git over this remote URL takes the header of `auth`. */
  takesToken(url: string): boolean;
  /** An Authorization header value for git over HTTPS from the CLI's login, or null without one. */
  auth(root: string): string | null;
}

/** A PR host: who it is, which URLs and remotes are its own, and its two sides. */
export interface PrHost {
  readonly id: HostId;
  /** The name users know: "Azure DevOps", "GitHub". */
  readonly name: string;
  /** How to install and log in to the host's CLI, for error messages. */
  readonly setup: string;
  /** Whether a URL's hostname is this host's. */
  ownsHostname(hostname: string): boolean;
  /** Whether a git remote URL points at this host. */
  ownsRemote(url: string): boolean;
  readonly api: PrApi;
  readonly git: PrGit;
}
