import type { PrHost } from "../host.ts";
import { AZ_SETUP, type Az } from "./az.ts";
import {
  adoMetadata,
  adoPrId,
  adoRemote,
  adoWebUrl,
  azToken,
  branchPr,
  isAdoHttps,
  isAdoRepoUrl,
  toPrMeta,
} from "./pr.ts";

/** Azure DevOps, through the az CLI and its token. */
export function azureDevOps(deps: { az: Az }): PrHost {
  return {
    id: "azure-devops",
    name: "Azure DevOps",
    setup: AZ_SETUP,
    ownsHostname: (hostname) => /(^|\.)dev\.azure\.com$|\.visualstudio\.com$/i.test(hostname),
    ownsRemote: (url) => isAdoHttps(url.toLowerCase()) || isAdoRepoUrl(url.toLowerCase()),
    api: {
      parse: (input) => {
        const id = adoPrId(input);
        return { id, webUrl: adoWebUrl(input, id) };
      },
      activePr: (root, branch) => branchPr(root, branch, deps.az),
      metadata: (root, pr, notes) => toPrMeta(adoMetadata(root, pr.id, notes, deps.az), pr.id),
    },
    git: {
      remote: adoRemote,
      mergeRef: (prId) => `refs/pull/${prId}/merge`,
      headRef: (_prId, meta) => (meta.sourceBranch ? `refs/heads/${meta.sourceBranch}` : null),
      takesToken: isAdoHttps,
      auth: (root) => {
        const token = azToken(root, deps.az);
        return token && `Bearer ${token}`;
      },
    },
  };
}
