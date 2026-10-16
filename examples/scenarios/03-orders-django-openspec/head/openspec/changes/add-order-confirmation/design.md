## Context
External integrations live outside the orders app.

## Decisions
### Decision: A notifications app for the email
orders calls a function of notifications; it does not know the email backend.

### Decision: Notify when the order is created
The email goes out in the same request that creates the order.

## Risks / Trade-offs
- If SMTP fails, the request fails.
