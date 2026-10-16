import type { PrHost } from "../host.ts";
import { GH_SETUP, type Gh } from "./gh.ts";
import {
  activeGitHubPr,
  ghToken,
  gitHubMetadata,
  gitHubPrId,
  gitHubRemote,
  gitHubSlug,
  gitHubWebUrl,
  isGitHubHostname,
  isGitHubHttps,
} from "./pr.ts";

/**
 * GitHub (github.com), through the gh CLI and its token. No `share`: GitHub's API cannot attach a file to a PR
 * comment, and gh uploads only images and videos.
 */
export function gitHub(deps: { gh: Gh }): PrHost {
  return {
    id: "github",
    name: "GitHub",
    setup: GH_SETUP,
    ownsHostname: isGitHubHostname,
    ownsRemote: (url) => gitHubSlug(url) !== null,
    api: {
      parse: (input) => {
        const id = gitHubPrId(input);
        return { id, webUrl: gitHubWebUrl(input, id) };
      },
      activePr: (root, branch) => activeGitHubPr(root, branch, deps.gh),
      metadata: (root, pr, notes) => gitHubMetadata(root, pr, notes, deps.gh),
      share: null,
    },
    git: {
      remote: gitHubRemote,
      mergeRef: (prId) => `refs/pull/${prId}/merge`,
      headRef: (prId) => `refs/pull/${prId}/head`,
      takesToken: isGitHubHttps,
      auth: (root) => {
        const token = ghToken(root, deps.gh);
        return token && `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
      },
    },
  };
}
