# Larder

## Purpose
Larder is an online grocery shop. Customers place orders through the API; a payment provider confirms payments
through a webhook; the warehouse picks paid orders.

## Tech stack
- Django 5 and Django REST Framework, PostgreSQL
- Celery on Redis for background work
- An external payment provider (HMAC-signed webhooks)

## Conventions
- Views and webhooks stay thin: business rules live in each app's `services.py` and models.
- Each external system sits behind 1 module of its own (`payments/provider.py`).
- Background work is a Celery task, queued only after the database transaction commits.
