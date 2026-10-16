# maybe (Ruby on Rails) · Data exports (#2517)

A real pull request explained by an agent: the source of `examples/real-maybe-rails-data-exports.html`.

- `real.json`: the repository, the commit and the gallery card.
- `explain-change.toml`: the config the agent wrote for the repository, following the configure skill.
- `explanation.json`: what the agent wrote about the change (without `version`, `key` and `lang`, which the build adds).

Rebuild it (clones https://github.com/maybe-finance/maybe.git at `0329a5f211fa`):

```bash
bun scripts/build-examples.ts --real
```
