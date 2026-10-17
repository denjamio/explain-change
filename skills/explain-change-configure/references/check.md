# Test the model against the code

Step 6 of the explain-change-configure skill.

```bash
explain-change check      # --history N reads more commits for "change together"
```

`check` measures how the config fits the code at HEAD:
- **Dependencies that break `[rules]` today**: real debt or a wrong rule. Keep the rule and accept the dashed lines
  when it is debt; fix the rule or the component when the code is right.
- **Components that depend on each other** (A ↔ B): usually one context split in two, or a missing boundary (an
  interface, an event). Merge them, or keep them and name the cycle in `direction` as debt.
- **Components that change together** (share of commits): above ~70% between two domain components, they are one
  context for the team; merge them. Between a context's parts across lanes (Orders API + Orders) it is expected.
- **Components that rarely change**: a context or a team keeps its box; a part of a context merges into it (step 3).
- **Components that list single files**: replace them with folders and name globs where a name groups them.
- **Unmapped folders**: give them an owner or add them to `[ignore]`. Never ignore migrations or architecture
  decision records: they are the evidence for the data model and the decisions. `check` warns when `[ignore]` hides
  them.

## The PRs you explain with it

A good model shows a typical PR as 3–8 boxes the author would name the same way, with arrows that mean something.
When a PR spreads over many tiny boxes, merge them; when one box hides the point of the change, split it.
