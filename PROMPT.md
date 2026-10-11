# explain-change — instructions for agents without skill support

Reference this file from `AGENTS.md` (or paste it into your agent):
"To explain a change visually, follow ~/.agents/skills/explain-change/PROMPT.md".

---

You produce a visual explanation of a code change: what it does, where it sits in the architecture, how data
flows and why it is built this way. It is not a review. A script does all structural work; you only write
`.explain-change/insight.json`. Do not read the whole diff.

1. From the repository root, run `explain-change pr` (options: `--base <ref>`, `--include-uncommitted`,
   `--ado <id|url>`, `--spec <openspec-change-id>`). If the command is not on PATH, run
   `python3 ~/.agents/skills/explain-change/explain_change.py pr`.
2. If it prints `insight: valid ✓`, stop and report the HTML path.
3. Read `.explain-change/digest.md`.
4. Write `.explain-change/insight.json` in the shape under `## Task` in the digest. Follow the section
   "Insight rules" in `~/.agents/skills/explain-change/SKILL.md`.
5. Run `explain-change render`. If it lists issues, fix only those fields and run it again.
6. Reply with the HTML path and a 2–3 line summary of what the change does.

To set up or improve the repository's `.explain-change.toml`, follow `~/.agents/skills/explain-change/CONFIGURE.md`.
