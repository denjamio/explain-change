import type { ComponentConfig, Config } from "../contract/config.ts";
import type { FileCategory } from "../contract/facts.ts";
import { CONFIG_EXT, CONFIG_NAMES, DOC_EXT, FRAMEWORK_CONFIG, MIGRATION_PATTERNS } from "../core/constants.ts";
import { globRegExp, literalPrefix, matchesAny } from "../core/glob.ts";
import { langOf } from "../core/lang.ts";
import { basename, extname } from "../core/paths.ts";

/** Maps repository paths to components and file categories. */
export class Mapper {
  readonly components: ComponentConfig[];
  private readonly cache = new Map<string, string | null>();

  constructor(readonly config: Config) {
    this.components = config.components;
  }

  /** The component owning `path`: the most specific matching glob wins (longest literal prefix), ties go to config order. */
  component(path: string): string | null {
    const hit = this.cache.get(path);
    if (hit !== undefined) return hit;
    let best: { len: number; index: number; id: string } | null = null;
    this.components.forEach((c, index) => {
      for (const pattern of c.paths) {
        if (!globRegExp(pattern).test(path)) continue;
        const len = literalPrefix(pattern).length;
        if (!best || len > best.len) best = { len, index, id: c.id };
      }
    });
    const id = (best as { id: string } | null)?.id ?? null;
    this.cache.set(path, id);
    return id;
  }

  category(path: string): FileCategory {
    if (matchesAny(path, this.config.ignore.paths)) return "ignored";
    if (matchesAny(path, this.config.ignore.tests)) return "test";
    if (matchesAny(path, MIGRATION_PATTERNS)) return "migration";
    if (
      matchesAny(path, FRAMEWORK_CONFIG) ||
      (path.startsWith("config/") && !langOf(path) && !/\.(erb|haml|slim)$/.test(path))
    ) {
      return "config";
    }
    const name = basename(path);
    const ext = extname(name).toLowerCase();
    if (DOC_EXT.has(ext)) return "docs";
    if (CONFIG_EXT.has(ext) || CONFIG_NAMES.has(name)) return "config";
    return "code";
  }
}
