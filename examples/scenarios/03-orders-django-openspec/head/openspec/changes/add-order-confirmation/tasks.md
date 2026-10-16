## 1. Orders
- [x] 1.1 Add `Order.contact_email`, filled from the customer when the order is placed
- [x] 1.2 Migration with a backfill from `Customer.email`
- [x] 1.3 Queue the confirmation in `mark_order_paid`, after commit

## 2. Notifications app
- [x] 2.1 `SentEmail` model with a unique (order, kind) constraint
- [x] 2.2 `EmailGateway` port and `PostmarkGateway` adapter
- [x] 2.3 `send_order_confirmation` service and its Celery task, with retries

## 3. Operations
- [x] 3.1 `POSTMARK_SERVER_TOKEN` and `EMAIL_FROM` settings
- [ ] 3.2 An admin action that resends a confirmation
