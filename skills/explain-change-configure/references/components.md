# Components: bounded contexts and capabilities, in domain language

Step 3 of the explain-change-configure skill.

A component is a unit of ownership a reviewer names in one word of the domain. Aim for 8–20. The map draws only
what a change touches, so a quiet box costs nothing on the page; what a box costs is keeping its paths right.

- **Domain first.** Each bounded context or business capability is a component: Orders, Billing, Refunds,
  Catalog, Identity. Split a context across lanes only where the code separates it, and then name the parts with a
  fixed suffix set:
  - `<Context>` for its domain core (entities, aggregates, rules): **Orders**
  - `<Context> API` / `<Context> UI` for its entry points: **Orders API**
  - `<Context> jobs` for its background work: **Orders jobs**
  - `<Capability> adapter` or the provider's role for an outbound integration: **Payment gateway**, **Email delivery**
- **Never a framework artifact as a name**: no "Controllers", "Models", "Services", "Helpers", "Serializers",
  "Mailers" boxes. When the code is organized by artifact (all models in `app/models`), group by the domain concept
  anyway: `paths` take globs, and the most specific one wins (`app/models/order.rb`, `app/models/order/**`).
  A technical component exists only for a real cross-cutting capability, named by what it does: **Web UI** (views,
  assets, JS), **Persistence**, **Messaging**, **Observability**.
- **No dumping grounds.** "common", "shared", "utils", "core", "misc" hide coupling. If a shared kernel exists, call it
  **Shared kernel**, keep it to value objects and ids, and say so in `desc`.
- **Granularity.** Split when two parts have different aggregates, lifecycles or owners; merge when they always
  change together (step 6 measures it). A component with 0 files is wrong; one with far more files than the rest
  usually hides several contexts. Apply the same rules to every box:
  - A context or a team the code names keeps its box, however quiet (Bitwarden's teams in CODEOWNERS, Saleor's
    Django apps, an enterprise edition).
  - A part that rarely changes (`check` lists them) and belongs to a context merges into it: campaigns into the
    inboxes they send from, a permission helper into identity. Never merge 2 unrelated contexts to save a box.
  - Framework configuration (`config/`, Rails initializers, settings) belongs to **Platform**; a composition root
    written as code (`app.module.ts`, a SharedWeb project) keeps its box in the entry lane.
  - Past 20 boxes, every box must be a context or a team the code names.
- **Fields.**
  - `id`: kebab-case of the name (`orders-api`), stable: rules, flows and explanations reference it.
  - `name`: the domain noun, ≤ 20 characters, in English, singular or plural as the
    team says it, the same style for every box.
  - `desc`: one sentence, "Owns <aggregates or data>; <what it guarantees or decides>": *Owns Order and LineItem; an
    order's total and what can still be refunded.*
  - `paths` decide ownership; `constants` (Ruby), `imports` (Python, TypeScript) and `namespaces` (C#) only for code
    owned outside them. A component may share its id with a layer only when it lives in that layer.
  - Write `paths` as folders (`app/services/conversations/**`) and name globs: `app/models/conversation**` owns
    `conversation.rb`, `conversation_*.rb` and `conversation/`. They keep up with new files; a single file does not,
    and a new file next to it silently falls to another component, usually the shared kernel. List a single file
    only when no name groups it (Rails delegated types such as `loan.rb`, `vehicle.rb`).
