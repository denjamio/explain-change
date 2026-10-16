# Saleor (Django) · Per-webhook payload generation (#19920)

A real pull request explained by an agent: the source of `examples/real-saleor-django-webhook-payload-generation.html`.

- `real.json`: the repository, the commit and the gallery card.
- `explain-change.toml`: the config the agent wrote for the repository, following the configure skill.
- `explanation.json`: what the agent wrote about the change (without `version`, `key` and `lang`, which the build adds).

Rebuild it (clones https://github.com/saleor/saleor.git at `3dd4bf79a461`):

```bash
bun scripts/build-examples.ts --real
```
