#!/usr/bin/env node
// The command line entry point: the npm bundle, the standalone binaries and `bun src/cli/bin.ts` all start here.
// It sets the exit code instead of calling process.exit(): on Windows, writes to a pipe are asynchronous, and exiting
// at once would cut the JSON or the error message short.
import { REPOSITORY } from "../core/constants.ts";
import { main } from "./main.ts";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(
      `explain-change: internal error: ${(e as Error).stack ?? e}\nPlease report it: https://github.com/${REPOSITORY}/issues\n`,
    );
    process.exitCode = 3;
  },
);
