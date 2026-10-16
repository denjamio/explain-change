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
import { type HttpFetch, shareReport } from "./share.ts";

/** Azure DevOps, through the az CLI and its token. Reports go up as PR attachments. */
export function azureDevOps(deps: { az: Az; fetch: HttpFetch }): PrHost {
  return {
    id: "azure-devops",
    name: "Azure DevOps",
    setup: AZ_SETUP,
    ownsHostname: (hostname) => /(^|\.)dev\.azure\.com$|\.visualstudio\.com$/i.test(hostname),
    ownsRemote: (url) => isAdoHttps(url.toLowerCase()) || isAdoRepoUrl(url.toLowerCase()),
    prId: adoPrId,
    webUrlFrom: adoWebUrl,
    activePr: (root, branch) => branchPr(root, branch, deps.az),
    metadata: (root, prId, _input, notes) => toPrMeta(adoMetadata(root, prId, notes, deps.az), prId),
    remote: adoRemote,
    mergeRef: (prId) => `refs/pull/${prId}/merge`,
    headRef: (_prId, meta) => (meta.sourceBranch ? `refs/heads/${meta.sourceBranch}` : null),
    takesToken: isAdoHttps,
    gitAuth: (root) => {
      const token = azToken(root, deps.az);
      return token && `Bearer ${token}`;
    },
    share: (root, facts, html, force) => shareReport(root, facts, html, deps, force),
  };
}
