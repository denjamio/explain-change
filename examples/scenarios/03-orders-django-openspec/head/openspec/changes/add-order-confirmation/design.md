# Design: Order confirmation email

## Context
`mark_order_paid` runs inside the transaction that `payments` opens for a webhook. Postmark answers in 100 to
800 ms and is down a few times a month.

## Decisions

### Send after commit, from a Celery task
`mark_order_paid` queues `send_order_confirmation` with `transaction.on_commit`. The webhook does not wait for
Postmark, and a rolled-back payment sends nothing.
- Alternative: send inside the webhook request. Rejected: a slow or failed send would fail the webhook, and the
  provider would retry the whole payment event.

### At most 1 confirmation per order
`SentEmail` has a unique (order, kind) constraint. The task creates the row before it calls Postmark; a second
run for the same order stops at the constraint.
- Alternative: a `confirmation_sent_at` field on Order. Rejected: it couples Orders to email, and the next
  emails (shipped, refunded) would each need a field.

### An EmailGateway port
`notifications.gateway.EmailGateway` is the port; `PostmarkGateway` is the only adapter. Tests use a fake.
- Alternative: Django's `send_mail` with an SMTP backend. Rejected: Postmark's message id is needed to answer
  support questions, and SMTP gives none.

## Risks
- A send that times out after Postmark accepted it can be retried and arrive twice. Accepted: a duplicate
  confirmation costs less than a missing one.
