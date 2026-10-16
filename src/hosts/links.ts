import type { HostId } from "../contract/config.ts";

/*
 * Links into a PR page. Pure: the report script bundles this module, so the page builds the same links offline.
 */

const FILE_URL: Record<HostId, (prUrl: string, path: string) => string> = {
  "azure-devops": (prUrl, path) => `${prUrl}?_a=files&path=${encodeURIComponent(`/${path}`)}`,
};

/** The link to one changed file on the PR page. */
export const prFileUrl = (host: HostId, prUrl: string, path: string) => FILE_URL[host](prUrl, path);
