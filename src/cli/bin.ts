#!/usr/bin/env node
// The command line entry point: the npm bundle, the standalone binaries and `bun src/cli/bin.ts` all start here.
import { main } from "./main.ts";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(
      `explain-change: internal error: ${(e as Error).stack ?? e}\nPlease report it: https://github.com/denjamio/explain-change/issues\n`,
    );
    process.exit(3);
  },
);
