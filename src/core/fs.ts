import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Creates a folder and its missing parents. It never relies on mkdir's `recursive`: Bun on Windows throws EEXIST
 * from it when the path, or one of its parents, already exists under another spelling (".", a drive root, 8.3 short
 * names such as the runners' C:\Users\RUNNER~1). It finds the deepest folder that exists, then creates each missing
 * one alone; an EEXIST is fine when the path is a folder by then.
 */
export function ensureDir(dir: string): void {
  const missing: string[] = [];
  for (let p = resolve(dir); !isDir(p); p = dirname(p)) {
    if (dirname(p) === p) break; // a root that does not exist: let mkdir report it
    missing.unshift(p);
  }
  for (const p of missing) {
    try {
      mkdirSync(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST" || !isDir(p)) throw e;
    }
  }
}

function isDir(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
}
