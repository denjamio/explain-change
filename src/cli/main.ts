import { parseArgs } from "node:util";
import { jsonSchema, SCHEMAS, type SchemaName } from "../contract/schemas.ts";
import { ANALYSIS_VERSION, CONTRACT_VERSION, VERSION } from "../core/constants.ts";
import { UserError } from "../core/errors.ts";
import { explain, render } from "./commands/change.ts";
import { check, init } from "./commands/config.ts";
import { install } from "./commands/install.ts";
import { share } from "./commands/share.ts";
import { update } from "./commands/update.ts";
import { printJson } from "./output.ts";

type OptionSpec = { type: "string" | "boolean"; multiple?: boolean; short?: string };

interface Command {
  usage: string;
  summary: string;
  options: Record<string, OptionSpec & { help: string }>;
  positionals: [number, number];
  run: (o: Record<string, string | boolean | string[] | undefined>, pos: string[]) => number | Promise<number>;
}

const json = { type: "boolean" as const, help: "print the result as JSON (for agents and scripts)" };
const out = {
  type: "string" as const,
  help: "write the report to this path (default .explain-change/out/<branch>.html)",
};
const noOpen = { type: "boolean" as const, help: "do not open the report in the browser" };
const changeOptions = {
  host: {
    type: "string" as const,
    help: "where the PR lives: azure-devops or github (default: project.host, else the host of the git remotes)",
  },
  spec: {
    type: "string" as const,
    multiple: true,
    help: "also explain this OpenSpec change when the diff does not touch it (repeatable)",
  },
  budget: { type: "string" as const, help: "digest size in characters (default: project.budget, else 12000)" },
  out,
  "no-open": noOpen,
  json,
};
const str = (v: unknown) => (typeof v === "string" ? v : null);
const budget = (v: unknown) => (typeof v === "string" ? Number(v) : null);

const COMMANDS: Record<string, Command> = {
  local: {
    usage: "local [--base REF] [--include-uncommitted] [--spec ID]…",
    summary: "explain the current branch: facts, digest, explanation draft and report",
    options: {
      base: {
        type: "string",
        help: "base ref (default: project.base, else origin/HEAD, origin/main, origin/master, main…)",
      },
      "include-uncommitted": { type: "boolean", help: "explain the working tree, untracked files included" },
      ...changeOptions,
    },
    positionals: [0, 0],
    run: (o) =>
      explain({
        pr: null,
        host: str(o.host),
        base: str(o.base),
        includeUncommitted: Boolean(o["include-uncommitted"]),
        specs: (o.spec as string[] | undefined) ?? [],
        budget: budget(o.budget),
        out: str(o.out),
        noOpen: Boolean(o["no-open"]),
        json: Boolean(o.json),
      }),
  },
  pr: {
    usage: "pr [ID|URL] [--host HOST] [--spec ID]…",
    summary: "explain an Azure DevOps or GitHub PR (without an id: the active PR from the current branch)",
    options: changeOptions,
    positionals: [0, 1],
    run: (o, pos) =>
      explain({
        pr: pos[0] ?? "",
        host: str(o.host),
        base: null,
        includeUncommitted: false,
        specs: (o.spec as string[] | undefined) ?? [],
        budget: budget(o.budget),
        out: str(o.out),
        noOpen: Boolean(o["no-open"]),
        json: Boolean(o.json),
      }),
  },
  render: {
    usage: "render",
    summary: "validate explanation.json and write the report (exits 1 until the explanation is valid)",
    options: { out, "no-open": noOpen, json },
    positionals: [0, 0],
    run: (o) => render({ out: str(o.out), noOpen: Boolean(o["no-open"]), json: Boolean(o.json), dryRun: false }),
  },
  status: {
    usage: "status",
    summary: "the explanation's state and the next step, without writing anything (exits 1 until valid)",
    options: { json },
    positionals: [0, 0],
    run: (o) => render({ out: null, noOpen: true, json: Boolean(o.json), dryRun: true }),
  },
  share: {
    usage: "share [--force]",
    summary: "share the finished report on its Azure DevOps PR: attached, with a comment linking to it",
    options: { force: { type: "boolean", help: "share it again when the PR already has this report" }, json },
    positionals: [0, 0],
    run: (o) => share({ force: Boolean(o.force), json: Boolean(o.json) }),
  },
  init: {
    usage: "init [--force]",
    summary: "write a draft .explain-change.toml from the folder layout",
    options: { force: { type: "boolean", help: "replace an existing .explain-change.toml" }, json },
    positionals: [0, 0],
    run: (o) => init({ force: Boolean(o.force), json: Boolean(o.json) }),
  },
  check: {
    usage: "check",
    summary:
      "validate .explain-change.toml against the code: lanes and file counts, unmapped folders, broken rules, mutual dependencies, components that change together",
    options: {
      history: { type: "string", help: "commits read for components that change together (default 300)" },
      json,
    },
    positionals: [0, 0],
    run: (o) => check({ json: Boolean(o.json), history: o.history ? Number(o.history) : 300 }),
  },
  schema: {
    usage: `schema <${Object.keys(SCHEMAS).join("|")}>`,
    summary: "print the JSON Schema of the config, facts.json or explanation.json",
    options: {},
    positionals: [1, 1],
    run: (_, pos) => {
      const name = pos[0] as string;
      if (!(name in SCHEMAS)) throw new UserError(`Unknown schema '${name}': use ${Object.keys(SCHEMAS).join(", ")}.`);
      printJson(jsonSchema(name as SchemaName));
      return 0;
    },
  },
  install: {
    usage: "install [--force] [--link]",
    summary: "install the agent skills into ~/.agents/skills and ~/.claude/skills",
    options: {
      force: { type: "boolean", help: "replace skill folders this tool did not write" },
      link: { type: "boolean", help: "from a source checkout: link the skill files, so edits show at once" },
      json,
    },
    positionals: [0, 0],
    run: (o) => install({ force: Boolean(o.force), link: Boolean(o.link), json: Boolean(o.json) }),
  },
  update: {
    usage: "update [--version TAG]",
    summary: "replace this binary with the latest release (or TAG) and refresh the skills",
    options: { version: { type: "string", help: "a release tag such as v0.3.0 (default: the latest)" }, json },
    positionals: [0, 0],
    run: (o) => update({ version: str(o.version), json: Boolean(o.json) }),
  },
};

function help(): string {
  const width = Math.max(...Object.values(COMMANDS).map((c) => c.usage.length));
  return [
    `explain-change ${VERSION}: an architecture-first explanation of a code change, as one HTML page.`,
    "",
    "Usage: explain-change <command> [options]",
    "",
    ...Object.values(COMMANDS).map((c) => `  ${c.usage.padEnd(width)}  ${c.summary}`),
    "",
    "Run `explain-change <command> --help` for its options. Exit codes: 0 done, 1 explanation not valid yet, 2 usage or config error.",
  ].join("\n");
}

function commandHelp(c: Command): string {
  const opts = Object.entries(c.options).map(([k, o]) => [`--${k}${o.type === "string" ? " VALUE" : ""}`, o.help]);
  const width = Math.max(0, ...opts.map(([a]) => (a as string).length));
  return [
    `Usage: explain-change ${c.usage}`,
    "",
    c.summary,
    "",
    ...opts.map(([a, h]) => `  ${(a as string).padEnd(width)}  ${h}`),
  ].join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "--help" || name === "-h" || name === "help") {
    console.log(help());
    return name ? 0 : 2;
  }
  if (name === "--version" || name === "-v") {
    console.log(`explain-change ${VERSION} (contract ${CONTRACT_VERSION}, analysis ${ANALYSIS_VERSION})`);
    return 0;
  }
  const command = COMMANDS[name];
  const wantsJson = rest.includes("--json");
  try {
    if (!command) throw new UserError(`Unknown command '${name}'. Run \`explain-change --help\`.`);
    if (rest.includes("--help") || rest.includes("-h")) {
      console.log(commandHelp(command));
      return 0;
    }
    let parsed: ReturnType<typeof parseArgs>;
    try {
      parsed = parseArgs({
        args: rest,
        options: Object.fromEntries(Object.entries(command.options).map(([k, { help: _, ...o }]) => [k, o])),
        allowPositionals: true,
        strict: true,
      });
    } catch (e) {
      throw new UserError(`${(e as Error).message}. Run \`explain-change ${name} --help\`.`);
    }
    const [min, max] = command.positionals;
    if (parsed.positionals.length < min || parsed.positionals.length > max) {
      throw new UserError(`Usage: explain-change ${command.usage}`);
    }
    return await command.run(
      parsed.values as Record<string, string | boolean | string[] | undefined>,
      parsed.positionals,
    );
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    if (wantsJson) printJson({ command: name, error: e.message });
    process.stderr.write(`explain-change: ${e.message}\n`);
    return 2;
  }
}
