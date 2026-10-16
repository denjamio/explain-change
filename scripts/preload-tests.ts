// bun test preload: the CLI embeds the report's assets, so they are built (when stale) before any test runs.
import { buildAssets } from "./build.ts";

// The suite's time limit is `bun test --timeout 30000` in package.json: many tests build git repositories and run
// the CLI, some 20 processes each, which take 1 to 3 s on Windows runners and spike past bun's 5 s default.
// setDefaultTimeout here would cover only the first test file, and bunfig.toml has no such key.

await buildAssets();
