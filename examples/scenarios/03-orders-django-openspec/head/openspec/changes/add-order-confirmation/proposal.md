# Change: Order confirmation email

## Why
Customers do not know whether their order was registered, and open support tickets to confirm it.

## What Changes
- Send a confirmation email when an order is created.
- The order stores the customer's email and validates it.
- **BREAKING**: `POST /orders/` requires `email`.

## Impact
- Specs: orders
- Code: Order model, create_order service, new notifications app.
