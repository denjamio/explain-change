# maybe · Data exports (#2517)

Config and insight for `../../real-maybe-rails-data-exports.html`.

To regenerate it:

```bash
git init maybe && cd maybe
git remote add origin https://github.com/maybe-finance/maybe.git
git fetch --depth 2 origin 0329a5f211fac5fb2b2d2383fbaa571880f5caee && git checkout FETCH_HEAD
cp <this folder>/explain-change.toml .explain-change.toml
explain-change local --base HEAD~1
cp <this folder>/insight.json .explain-change/insight.json
explain-change render
```
