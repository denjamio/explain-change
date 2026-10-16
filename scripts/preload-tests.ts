// bun test preload: the CLI embeds the report's assets, so they are built (when stale) before any test runs.
import { setDefaultTimeout } from "bun:test";
import { buildAssets } from "./build.ts";

// Many tests build git repositories and run the CLI: some 20 processes each, which take 1 to 3 s on Windows
// runners and spike past bun's 5 s default. 1 limit for the whole suite, not 1 per test.
setDefaultTimeout(30_000);

await buildAssets();
