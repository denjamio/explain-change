import type { Mapper } from "../config/mapper.ts";
import { byKeys, compareStrings } from "../core/text.ts";
import type { Extracted } from "./refs.ts";

/** `to` holds classes that implement interfaces `from` declares: ports and their adapter. */
export interface PortLink {
  from: string;
  to: string;
  /** The interfaces, sorted: a flow step names the 1 its call uses. */
  interfaces: string[];
}

/**
 * Ports and their adapters across components: Core declares IFolderRepository, Dapper implements it. Neither the
 * code that calls the port nor the adapter imports the other, so these links are what verifies a flow step from
 * the 1 to the other. 1 link per pair of components, with every interface that links them.
 */
export function portLinks(extracted: ReadonlyMap<string, Extracted>, mapper: Mapper): PortLink[] {
  const declared = new Map<string, Set<string>>();
  for (const [file, ex] of extracted) {
    const component = mapper.component(file);
    if (!component) continue;
    for (const name of ex.interfaces ?? []) declared.set(name, (declared.get(name) ?? new Set()).add(component));
  }
  const links = new Map<string, Set<string>>();
  for (const [file, ex] of extracted) {
    const to = mapper.component(file);
    if (!to) continue;
    for (const name of ex.implements ?? []) {
      for (const from of declared.get(name) ?? []) {
        if (from === to) continue;
        const key = `${from}\0${to}`;
        links.set(key, (links.get(key) ?? new Set()).add(name));
      }
    }
  }
  return [...links.entries()]
    .map(([key, names]) => {
      const [from, to] = key.split("\0") as [string, string];
      return { from, to, interfaces: [...names].sort(compareStrings) };
    })
    .sort(byKeys((l) => [l.from, l.to]));
}
