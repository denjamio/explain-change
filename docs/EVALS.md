# Evals

`bun run eval` measures the skill end to end: a real agent explains real pull requests, asked for by their URL as a
user does, and pass/fail graders check what it wrote. It costs tokens; `--max-cost` caps them. The design follows
`claude plugin eval`, skill-creator and Anthropic's guide to agent evals. The code is in `scripts/eval*.ts`.

## What runs

For each PR in `examples/real/<name>/` (`real.json`), the eval:

1. clones the PR's repository into a temporary folder, with the PR's `explain-change.toml`;
2. puts this checkout on `PATH` as `explain-change`;
3. runs the agent (`claude -p`, `--model haiku` by default) with the user's request and `skills/explain-change/SKILL.md`,
   only the tools it may use (`Bash`, `Read`, `Edit`, `Write`) and no MCP server or other skill (`--discover`
   installs the skills in the repository instead and reports whether the agent loaded the skill from its
   description);
4. grades the explanation it leaves.

The scenarios in `examples/scenarios/` are offline test fixtures; they run only when named.

## Graders

Each grader is pass/fail with its evidence. A run's `score` is the share of the graders that pass; one that does not
apply, or that the judge answers `unknown`, counts neither way.

| Group | Checked by | What it checks |
|---|---|---|
| **structure** | code, against the facts (free, no noise) | the explanation is valid; the story lights at least 80% of the changed code; each key dependency is one the change touches; decision evidence points into the change; flow steps exist in the code; no field repeats another |
| **content** | `examples/real/<name>/assertions.json` | what any good explanation of the PR says: `mentions` assertions in code (a name appears), `llm` assertions by the judge |
| **prose** | the judge, on the explanation alone | a rubric of PASS/FAIL conditions (`RUBRIC` in `scripts/eval-graders.ts`) |
| **grounded** | the judge, per decision whose basis is not `inferred` | the source (PR description, OpenSpec proposal and design, or the whole hunk around the evidence at the head) states the why |

The judge (`--judge`, haiku) makes 2 short calls per run, each lean: no tools, no settings, a 1-line system prompt
(about 600 tokens of overhead). `--judge none` keeps only the free graders.

### Assertions: an independent reference

`assertions.json` is written once per PR by a model from the PR's title, description and diff only
(`bun scripts/eval-assertions.ts`), never from the tool's output: grading the tool against what it wrote itself is
circular and saturates. The assertions are committed and kept stable, so evals compare across versions. Delete one
that a 1-page explanation need not meet; regenerate (`--force`) only an assertion that is wrong, and say so.

### Meta-eval

`--calibrate` grades each committed explanation and its mutants (`scripts/eval-mutants.ts`: known defects, such as a
story that skips a component, evidence outside the change or a basis that its source does not state) and reports
which graders catch which defect. A grader that catches nothing cannot move when the agent improves.

### The judge

Haiku stays the judge. Its calls are the eval's cheapest part, and the loop compares 2 runs graded the same way.
Graded by sonnet instead (`--rejudge baseline-4.json --judge sonnet`, 2026-10-18; $0.34 against $0.03), the same
11 explanations scored 0.78 against 0.85: prose and grounded within 0.04, content 0.71 against 0.87. Sonnet fails
an assertion when one of its clauses is missing ("…and the request returns at once with a notice"); haiku passes it
on the main point. Neither is wrong: the assertions are compound. Use sonnet to check a release, not in the loop.

## Reported, not scored

Turns, cost, tokens in and out, `render` calls (and the issues of the first render: what makes the agent render
again), source reads, the digest's size, the tool calls in order (`tools`, with the size of each input and result),
and the F1 of the structure against the committed explanation (`fidelity`, `draft`, `lift`): a regression check,
not a measure of quality.

## Splits and the improvement loop

`real.json` `eval` puts each PR in `train` (the default) or `test`. Test is bitwarden-invite, chatwoot-branded,
immich-workflow, maybe-balance-sheet and saleor-webhook.

1. One change at a time, on a branch.
2. Train, 1 run, as a filter: `bun scripts/eval.ts --split train --out X --baseline B --compare B`.
3. When train improves and the blind A/B does not prefer the old explanations: test, `--runs 2`.
4. Keep the change only when test does not drop and the A/B on test does not prefer the old one.
5. Read the failures of train only, never those of test.

With 5 test PRs, the score moves by about ±0.08 between runs: an improvement smaller than that needs more runs
before it counts.

## Options

| Option | Does |
|---|---|
| `--split train\|test\|all` | which PRs run |
| `--runs N` | repeats each PR: 1 run of an agent is a sample |
| `--out file` | keeps every run (its explanation and verdicts) and the summary |
| `--baseline file` | compares with an earlier `--out`, the same PRs only: a mean that drops by more than the noise (2 standard errors, at least 0.1) fails, and the graders fixed or broken are listed |
| `--compare file` | the judge picks, blind and in both orders, which of the 2 explanations serves a reviewer better |
| `--rejudge file` | grades the explanations of an `--out` file again, with no agent: a change to the graders measured on the same explanations |
| `--max-cost USD` | stops starting runs past this spend |

A quick loop eval (`--split train`, 1 run) costs about $0.10; the full set about $0.20.
