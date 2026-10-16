# Change: Order confirmation email

## Why
Customers get no message after they pay. Support answers about 40 tickets a week that ask whether an order went
through, and some customers pay twice.

## What Changes
- Send a confirmation email when an order becomes paid, not when it is placed: a placed order can still fail to
  pay.
- Keep the email address the order was placed with, so a later change of the customer's email does not move the
  confirmation of an old order.
- Send through Postmark from a new `notifications` app, behind an `EmailGateway` port.
- Retry a failed send in the background; a payment never fails because email is down.

## Impact
- Specs: orders (MODIFIED), notifications (ADDED)
- Code: `orders` (model, services), new `notifications` app, settings
- Data: `Order.contact_email`, new `SentEmail` table
