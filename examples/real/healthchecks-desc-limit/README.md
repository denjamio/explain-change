# healthchecks · Description length limit

Config and insight for `../../real-healthchecks-django-desc-limit.html`.

To regenerate it:

```bash
git init healthchecks && cd healthchecks
git remote add origin https://github.com/healthchecks/healthchecks.git
git fetch --depth 2 origin a37fcf82131a26653d75edc18c2c0cedffc880c9 && git checkout FETCH_HEAD
cp <this folder>/explain-change.toml .explain-change.toml
explain-change pr --base HEAD~1
cp <this folder>/insight.json .explain-change/insight.json
explain-change render
```
