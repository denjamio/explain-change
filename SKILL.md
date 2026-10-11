---
name: explain-change
description: Visual, architecture-first explanation of a code change (local branch diff or Azure DevOps PR) as a single shareable HTML page — an architecture map with a guided story, data flows, the data model, OpenSpec requirement → code traceability and the design decisions behind the change. It explains; it does not review (bugs, gaps and merge readiness belong to a reviewer agent). Use when the user asks to explain, walk through, visualize or understand a PR, branch, diff or change, or how it fits the architecture; also to set up or improve the repository's .explain-change.toml (layers, components, rules).
---

# explain-change

The script does the deterministic work: diff, components, dependency graph, rule violations, layout and HTML.
You write only `.explain-change/insight.json`: what the change does, how it moves through the architecture and why
it is built this way. **Never read the full diff**: the digest already selects what matters.

## Steps

1. From the repository root, collect the change the user asked for:
   ```bash
   explain-change pr                      # current branch vs the base (--base <ref> to override)
   explain-change pr --include-uncommitted
   explain-change pr --ado <id|url>       # Azure DevOps PR
   explain-change pr --spec <change-id>   # add an OpenSpec change that the diff implements but does not touch
   ```
   OpenSpec changes inside the diff are detected automatically. If `explain-change` is not on PATH, run
   `python3 <this skill dir>/explain_change.py …` (`py -3` on Windows).
2. If the output says `insight: valid ✓`, the existing insight matches this exact change. Stop and give the HTML path.
3. Read `.explain-change/digest.md`. Open a source file only when a hunk is not enough to judge a decision or a flow.
4. Write `.explain-change/insight.json` in the shape shown under `## Task` in the digest, following the rules below.
5. Run `explain-change render`. If it lists issues, fix only those fields and render again.
6. Reply with the HTML path and a 2–3 line summary of what the change does. Do not paste the insight.

If the output starts with `⚠ No .explain-change.toml`, the layers and components are guessed. Say so in your
reply and offer to help write the config (see below).

## Insight rules

The validator enforces ids, limits and cross-references. The schema is `schemas/insight.schema.json`.

**General**
- Write in the digest's `lang`. Use only component ids from the digest; never invent components.
- Explain, do not review. Say what the change does, where it sits and why. Do not judge readiness or report bugs,
  gaps, error handling, security or style: a reviewer agent covers those, and the PR shows the line-level diff.

**What changed**
- `changes`: one line for **every** changed component, saying what it now does differently.
- `story`: 2–8 steps (ideally 3–6), the tour a reader plays over the map.
  - One step = one change (added, removed, now, moved). Headline change first, overview last.
  - `heading` names the thing and what happened to it. `body` says what behaves differently, with numbers when they matter.
  - `stage`: `architecture` | `flow:<id>` | `data` | `spec`. `focus`: 1–3 ids on that stage (components; on a flow,
    also step numbers such as `#2`; on `data`, entity ids; on `spec`, requirement ids).
  - Optional `code`: `file:a-b` inside a hunk, shown beside the step.
- `hero`: 0–2 dependencies (`from`/`to`) that the change is really about, each with an optional short label.

**Why it is built this way**
- `decisions`: 1–5 design choices that explain the change: what was chosen, why, and the main alternative.

**Spec**
- `spec` (only when the digest lists OpenSpec requirements): one entry per ADDED/MODIFIED requirement, as
  `implemented | partial | missing | n/a`, with the components that implement it and the tests that prove it.
  `partial` and `missing` need a note.

**Runtime and data**
- `flows`: 1–2 main runtime flows through the changed components, in call order. Reuse a config flow id when it is
  the same flow, so the report compares it with the reference. Steps with no matching dependency in the code are drawn
  as unverified (`?`). When a flow realises an OpenSpec scenario, set `"scenario": "<req-id>#<scenario-id>"`.
- Flow steps may carry `data`: the type that travels and only the fields that matter (`+email: string`, `-fax`,
  `~total: number`). Add it on steps whose data changed.
- `data_model` (when models, tables, schemas or migrations change): entities with their changed fields and relations;
  unchanged neighbours as `same`. `evidence` is the model or migration hunk.

**Prose**: Simplified Technical English (ASD-STE100) style, adapted to design documents. One idea per sentence, at most
25 words (enforced), active voice, present tense, simple verbs, the same word for the same thing, names exactly as in
the code. No idioms or marketing words (a short list is refused).

## Configure the repository

Without `.explain-change.toml` the script guesses layers and components from folder names, and the CLI and the report
say so first. Offer to configure it. When the user asks to set up or improve the config, follow `CONFIGURE.md` in this
skill folder: it reads the app's docs and existing dependency rules, then writes and tests the file.
