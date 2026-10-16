import type { Facts } from "../../contract/facts.ts";
import { VERSION } from "../../core/constants.ts";
import { UserError } from "../../core/errors.ts";
import { git } from "../../core/git.ts";
import type { HttpFetch, ShareResult } from "../host.ts";
import { AZ_SETUP, type Az, azHint } from "./az.ts";
import { azToken, branchPr, type PrMetadata } from "./pr.ts";

/*
 * Sharing a report on its Azure DevOps PR: the page goes up as a PR attachment, and a comment links to it. Only
 * people who can open the PR can download it. Nothing is shared unless the user runs `share`.
 */

const API = "api-version=7.1";
const ATTACHMENTS_API = "api-version=7.1";

/** The attachment's name: one per change, so sharing the same change twice is noticed. */
export const attachmentName = (facts: Facts) => `explain-change-${facts.key}.html`;

/**
 * Uploads the report to the change's PR and comments with its link. A local branch goes to its active PR, and
 * only when the PR's source is the commit explained: reviewers must see the change the report describes.
 */
export async function shareReport(
  root: string,
  facts: Facts,
  html: string,
  deps: { az: Az; fetch: HttpFetch },
  force = false,
): Promise<ShareResult> {
  const src = facts.source;
  if (src.includeUncommitted) {
    throw new UserError(
      "This report includes uncommitted work, which the PR does not have: commit, push, then explain it again.",
    );
  }
  let prId = src.prId;
  if (!prId) {
    const current = git(["branch", "--show-current"], root).trim();
    if (current !== src.branch) {
      throw new UserError(
        `The report explains '${src.branch}', but '${current || "a detached HEAD"}' is checked out: switch back to it.`,
      );
    }
    prId = branchPr(root, current, deps.az);
  }
  const meta = prShow(root, prId, deps.az);
  if (!meta.url) throw new UserError(`az repos pr show returned no API URL for PR ${prId}.`);
  const explained = explainedSourceSha(root, facts);
  const current = meta.lastMergeSourceCommit?.commitId;
  if (explained && current && explained !== current) {
    throw new UserError(
      `PR ${prId} is at ${current.slice(0, 8)}, but the report explains ${explained.slice(0, 8)}: ` +
        `push your commits or run \`explain-change pr ${prId}\` again, then share.`,
    );
  }
  const token = azToken(root, deps.az);
  if (!token) throw new UserError(`No Azure DevOps token from az: ${AZ_SETUP}.`);
  const api = new AdoApi(token, deps.fetch);
  const web = src.url ?? (meta.repository?.webUrl ? `${meta.repository.webUrl}/pullrequest/${prId}` : null);
  const name = attachmentName(facts);

  const threads = (await api.json("GET", `${meta.url}/threads?${API}`)) as { value?: Thread[] };
  const previous = (threads.value ?? []).find((t) => t.comments?.some((c) => c.content?.includes(name)));
  if (previous && !force) {
    const link = /\]\(([^)]+)\)/.exec(previous.comments?.find((c) => c.content?.includes(name))?.content ?? "");
    return { state: "already-shared", prId, pr: threadUrl(web, previous.id), attachment: link?.[1] ?? name };
  }

  const uploaded = (await api.json("POST", `${meta.url}/attachments/${encodeURIComponent(name)}?${ATTACHMENTS_API}`, {
    body: html,
    type: "application/octet-stream",
  })) as { url?: string };
  if (!uploaded.url) throw new UserError("Azure DevOps accepted the report but returned no attachment URL.");
  const thread = (await api.json("POST", `${meta.url}/threads?${API}`, {
    body: JSON.stringify({
      comments: [{ parentCommentId: 0, commentType: 1, content: comment(facts, uploaded.url) }],
      status: "closed",
    }),
    type: "application/json",
  })) as Thread;
  return { state: "shared", prId, pr: threadUrl(web, thread.id), attachment: uploaded.url };
}

interface Thread {
  id?: number;
  comments?: { content?: string }[];
}

const threadUrl = (web: string | null, id: number | undefined) =>
  web && id !== undefined ? `${web}?discussionId=${id}` : web;

/** The PR's source commit the report explains: the merge ref's second parent, or the branch head. */
function explainedSourceSha(root: string, facts: Facts): string | null {
  const { kind, headRef, headSha } = facts.source;
  if (kind === "pr" && headRef.endsWith("/merge")) {
    const parent = git(["rev-parse", "--verify", "--quiet", `${headSha}^2`], root, { check: false }).trim();
    return parent || null;
  }
  return headSha;
}

interface PrDetails extends PrMetadata {
  url?: string;
  lastMergeSourceCommit?: { commitId?: string };
}

function prShow(root: string, prId: string, az: Az): PrDetails {
  const p = az.run(["repos", "pr", "show", "--id", prId, "-o", "json"], root);
  if ("error" in p) throw new UserError(`${p.error}: ${AZ_SETUP}.`);
  if (p.status !== 0) throw new UserError(`az repos pr show failed: ${azHint(p.stderr)}.`);
  try {
    return JSON.parse(p.stdout) as PrDetails;
  } catch {
    throw new UserError("az repos pr show returned no JSON.");
  }
}

function comment(facts: Facts, url: string): string {
  const title = facts.source.title.replace(/[[\]]/g, "");
  return (
    `**explain-change**: [${title}](${url}), an architecture-first explanation of this PR at \`${facts.source.headSha.slice(0, 8)}\`. ` +
    "Download it and open it in your browser; it works offline."
  );
}

/** The Azure DevOps REST API with an az token; errors become UserErrors with the status and Azure's message. */
class AdoApi {
  constructor(
    private readonly token: string,
    private readonly http: HttpFetch,
  ) {}

  async json(method: string, url: string, send?: { body: string; type: string }): Promise<unknown> {
    let res: Response;
    try {
      res = await this.http(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "User-Agent": `explain-change/${VERSION}`,
          ...(send ? { "Content-Type": send.type } : {}),
        },
        body: send?.body,
      });
    } catch (e) {
      throw new UserError(`Azure DevOps is unreachable: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 200);
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message;
      } catch {}
      throw new UserError(`Azure DevOps answered ${res.status} to ${method} ${url.split("?")[0]}: ${message}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new UserError(`Azure DevOps answered ${method} ${url.split("?")[0]} without JSON.`);
    }
  }
}
