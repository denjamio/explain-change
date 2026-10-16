# healthchecks (Django) · Description length limit

A real pull request explained by an agent: the source of `examples/real-healthchecks-django-desc-limit.html`.

- `real.json`: the repository, the commit and the gallery card.
- `explain-change.toml`: the config the agent wrote for the repository, following the configure skill.
- `explanation.json`: what the agent wrote about the change (without `version`, `key` and `lang`, which the build adds).

Rebuild it (clones https://github.com/healthchecks/healthchecks.git at `a37fcf82131a`):

```bash
bun scripts/build-examples.ts --real
```
