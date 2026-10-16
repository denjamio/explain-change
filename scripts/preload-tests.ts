// bun test preload: the CLI embeds the report's assets, so they are built (when stale) before any test runs.
import { buildAssets } from "./build.ts";

await buildAssets();
