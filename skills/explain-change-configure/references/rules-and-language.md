# Rules, glossary, direction and flows

Steps 4 and 5 of the explain-change-configure skill.

## Rules: the dependency rule as an architecture decision

- Encode the rule the team agrees on, **even when today's code breaks it**: the map draws pre-existing violations
  apart (dashed), and each change's new ones in red. That is the signal to track, change by change.
- Layered: allow each lane to depend on the ones below it (`web -> application`, `application -> domain`, …).
  Hexagonal: everything points at the domain; the domain depends on nothing outside it
  (`forbid = ["domain -> infrastructure"]`), adapters may depend on the domain (`infrastructure -> domain`).
- Between contexts, prefer `forbid` for the boundaries that matter (`orders -> billing` when Orders must call Billing
  through its API): a short list of meaningful red lines beats a long one nobody reads.
- Copy rules the team already enforces (packwerk, import-linter…) as they are. With no agreed rule, leave `allow`
  out and say so: invented rules only paint the map red.

## Language: glossary, direction and flows

- `[glossary]`: 5–20 terms of the domain, each with a one-line definition, as the business uses them
  (`refund = "Money returned to a customer for an order, in part or in full"`). One term per concept: when the code
  has two words for one thing (`purchase`, `order`), pick the team's word and note the other in its definition.
  Component names, flow titles and every explanation use these terms.
- `project.direction`: 1–2 sentences naming the style and the dependency rule, and the target when the code is
  moving toward one: *Hexagonal: use cases in app/services own the business flow; models hold the rules; adapters
  in app/clients implement the gateways. New logic leaves controllers and callbacks.*
- `[[flows]]`: 1–3 use cases the business runs on, titled as a command on a domain object (**Place an order**,
  **Refund an order**), with their steps as `"component -> component : call"`. A change that touches one is
  compared with it.
- `project.names`: only product or library names written like code (`FastAPI`, `NestJS`) that explanations name
  and the code never spells out; the validator otherwise asks for them in the change.
- `project.host`: only when the remotes do not tell where the PRs live (a mirror on both hosts, or none): `azure-devops`
  or `github`. Leave it out otherwise; the remotes decide.
