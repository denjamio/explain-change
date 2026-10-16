import { HOST_IDS, type HostId } from "../contract/config.ts";
import type { Facts } from "../contract/facts.ts";
import { UserError } from "../core/errors.ts";
import { Az } from "./azure-devops/az.ts";
import { azureDevOps } from "./azure-devops/host.ts";
import type { HttpFetch } from "./azure-devops/share.ts";
import type { PrHost } from "./host.ts";
import { hostnameOf, remotes, remoteUrl } from "./source.ts";

/** What the adapters run: each host's CLI and HTTP. Tests replace them. */
export interface HostDeps {
  az: Az;
  fetch: HttpFetch;
}

export const defaultHostDeps = (): HostDeps => ({ az: new Az(), fetch: (url, init) => fetch(url, init) });

export type Hosts = Record<HostId, PrHost>;

export function createHosts(deps: HostDeps = defaultHostDeps()): Hosts {
  return { "azure-devops": azureDevOps(deps) };
}

/** The host a PR id goes to when nothing else names one. */
export const DEFAULT_HOST: HostId = "azure-devops";

const hasRemoteOf = (root: string, host: PrHost) => remotes(root).some((r) => host.ownsRemote(remoteUrl(root, r)));

/** The host of a PR: the one its URL names, else the default, which the repository must have a remote of. */
export function prHost(root: string, pr: string, hosts: Hosts): PrHost {
  const all = HOST_IDS.map((id) => hosts[id]);
  const hostname = hostnameOf(pr).toLowerCase();
  if (hostname) {
    const host = all.find((h) => h.ownsHostname(hostname));
    if (!host) {
      throw new UserError(
        `Only ${all.map((h) => h.name).join(" and ")} PRs are supported, not ${hostname}. Check out the PR branch and run \`explain-change local\`.`,
      );
    }
    return host;
  }
  const host = hosts[DEFAULT_HOST];
  if (!hasRemoteOf(root, host)) {
    throw new UserError(
      `PR ids work with ${host.name} remotes, and this repository has none. Check out the PR branch and run \`explain-change local\`.`,
    );
  }
  return host;
}

/** The host a branch's PR would be on: the first one the repository has a remote of; null when none. */
export function branchHost(root: string, hosts: Hosts): PrHost | null {
  return HOST_IDS.map((id) => hosts[id]).find((h) => hasRemoteOf(root, h)) ?? null;
}

/** The host of a change: the PR's (`pr` is an id, a URL, or "" for the branch's active PR), or the branch's. */
export const changeHost = (root: string, pr: string | null, hosts: Hosts): PrHost | null =>
  pr === null ? branchHost(root, hosts) : prHost(root, pr, hosts);

/** Whether `share` can work for these facts: a host that takes reports, and no work the PR does not have. */
export function shareable(facts: Facts, hosts: Hosts): boolean {
  const host = facts.source.host ? hosts[facts.source.host] : null;
  return Boolean(host?.share) && !facts.source.includeUncommitted;
}
