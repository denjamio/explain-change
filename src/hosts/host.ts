import type { HostId } from "../contract/config.ts";
import type { Facts } from "../contract/facts.ts";

/*
 * Where pull requests live. The analysis never talks to a host: `local` needs none, and `pr` asks the host only for
 * the PR's id, its metadata and which refs hold its commits. git does the rest (./source.ts), the same for every
 * host. Each adapter wraps the host's own CLI, so the user's login is the only credential the tool uses.
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
  /** The PR id from an id or a PR URL of this host; a UserError for anything else. */
  prId(input: string): string;
  /** The PR page from a pasted PR URL, without its query; null for a bare id. */
  webUrlFrom(input: string, prId: string): string | null;
  /** The id of the active PR from a branch. */
  activePr(root: string, branch: string): string;
  /** What the host's CLI says about a PR, or less, with a note in `notes` that says what is missing. */
  metadata(root: string, prId: string, notes: string[]): PrMeta;
  /** The remote that holds the PR. */
  remote(root: string, meta: PrMeta): string;
  /** The ref that holds the PR applied to its target (a merge commit: target, then source). */
  mergeRef(prId: string): string;
  /** The ref with the PR's own commits, for a PR without a merge ref; null when it is unknown. */
  headRef(prId: string, meta: PrMeta): string | null;
  /** Whether git over this remote URL takes the token of `gitAuth`. */
  takesToken(url: string): boolean;
  /** An Authorization header for git over HTTPS from the CLI's login, or null without one. */
  gitAuth(root: string): string | null;
  /** null when the host cannot take a report as a PR attachment. */
  readonly share: ShareFn | null;
}
