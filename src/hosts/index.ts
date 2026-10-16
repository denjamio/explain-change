import { HOST_IDS, type HostId } from "../contract/config.ts";
import type { Facts } from "../contract/facts.ts";
import { UserError } from "../core/errors.ts";
import { Az } from "./azure-devops/az.ts";
import { azureDevOps } from "./azure-devops/host.ts";
import type { HttpFetch } from "./azure-devops/share.ts";
import { Gh } from "./github/gh.ts";
import { gitHub } from "./github/host.ts";
import type { PrHost } from "./host.ts";
import { hostnameOf, remotes, remoteUrl } from "./source.ts";

/** What the adapters run: each host's CLI and HTTP. Tests replace them. */
export interface HostDeps {
  az: Az;
  gh: Gh;
  fetch: HttpFetch;
}

export const defaultHostDeps = (): HostDeps => ({
  az: new Az(),
  gh: new Gh(),
  fetch: (url, init) => fetch(url, init),
});

export type Hosts = Record<HostId, PrHost>;

export function createHosts(deps: HostDeps = defaultHostDeps()): Hosts {
  return { "azure-devops": azureDevOps(deps), github: gitHub(deps) };
}

/** The host a PR goes to when nothing names one and no remote tells. */
export const DEFAULT_HOST: HostId = "azure-devops";

const hasRemoteOf = (root: string, host: PrHost) => remotes(root).some((r) => host.ownsRemote(remoteUrl(root, r)));

/** The host the user names: `--host`, else `project.host` in the config. */
export interface HostChoice {
  flag: HostId | null;
  config: HostId | null;
}

/**
 * The host of a PR, the first that applies: the one its URL names, the user's choice, the first host the
 * repository has a remote of, the default. A PR id needs a remote of its host to fetch the PR from.
 */
export function prHost(root: string, pr: string, hosts: Hosts, choice: HostChoice): PrHost {
  const all = HOST_IDS.map((id) => hosts[id]);
  const hostname = hostnameOf(pr).toLowerCase();
  if (hostname) {
    const host = all.find((h) => h.ownsHostname(hostname));
    if (!host) {
      throw new UserError(
        `Only ${all.map((h) => h.name).join(" and ")} PRs are supported, not ${hostname}. Check out the PR branch and run \`explain-change local\`.`,
      );
    }
    if (choice.flag && choice.flag !== host.id) {
      throw new UserError(`--host ${choice.flag} does not match the PR URL, which is on ${host.name}.`);
    }
    return host;
  }
  const chosen = choice.flag ?? choice.config;
  const host = chosen ? hosts[chosen] : (all.find((h) => hasRemoteOf(root, h)) ?? hosts[DEFAULT_HOST]);
  if (!hasRemoteOf(root, host)) {
    throw new UserError(
      `PR ids work with ${host.name} remotes, and this repository has none. Pass the PR URL, or check out the PR branch and run \`explain-change local\`.`,
    );
  }
  return host;
}

/** The host a branch's PR would be on: the user's choice, else the first host the repository has a remote of. */
export function branchHost(root: string, hosts: Hosts, choice: HostChoice): PrHost | null {
  const chosen = choice.flag ?? choice.config;
  if (chosen) return hosts[chosen];
  return HOST_IDS.map((id) => hosts[id]).find((h) => hasRemoteOf(root, h)) ?? null;
}

/** The host of a change: the PR's (`pr` is an id, a URL, or "" for the branch's active PR), or the branch's. */
export const changeHost = (root: string, pr: string | null, hosts: Hosts, choice: HostChoice): PrHost | null =>
  pr === null ? branchHost(root, hosts, choice) : prHost(root, pr, hosts, choice);

/** Whether `share` can work for these facts: a host that takes reports, and no work the PR does not have. */
export function shareable(facts: Facts, hosts: Hosts): boolean {
  const host = facts.source.host ? hosts[facts.source.host] : null;
  return Boolean(host?.share) && !facts.source.includeUncommitted;
}
