from django.db import transaction
from django.utils.dateparse import parse_datetime

from orders.services import mark_order_paid
from payments.models import Payment
from payments.provider import PaymentEvent


@transaction.atomic
def handle_payment_event(event: PaymentEvent) -> None:
    """Applies a provider event once: a repeated delivery finds the payment already settled."""
    payment = Payment.objects.select_for_update().get(provider_ref=event.provider_ref)
    if payment.status != Payment.Status.PENDING:
        return
    if event.kind == "payment.succeeded":
        payment.status = Payment.Status.SUCCEEDED
        payment.save(update_fields=["status"])
        mark_order_paid(payment.order_id, parse_datetime(event.occurred_at))
    elif event.kind == "payment.failed":
        payment.status = Payment.Status.FAILED
        payment.save(update_fields=["status"])
