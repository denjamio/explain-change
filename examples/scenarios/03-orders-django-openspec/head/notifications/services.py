from django.db import IntegrityError, transaction
from django.template.loader import render_to_string

from notifications.gateway import Email, EmailGateway, default_gateway
from notifications.models import SentEmail
from orders.models import Order


def send_order_confirmation(order_id: int, gateway: EmailGateway | None = None) -> bool:
    """Sends the confirmation of a paid order once. Returns False when it was already sent."""
    order = Order.objects.prefetch_related("lines__product").get(pk=order_id)
    try:
        with transaction.atomic():
            sent = SentEmail.objects.create(order=order, kind=SentEmail.Kind.ORDER_CONFIRMATION, to=order.contact_email)
    except IntegrityError:
        return False
    email = Email(
        to=order.contact_email,
        subject=f"Your Larder order #{order.id} is confirmed",
        text=render_to_string("notifications/order_confirmation.txt", {"order": order}),
    )
    try:
        sent.provider_message_id = (gateway or default_gateway()).send(email)
    except Exception:
        sent.delete()  # free the guard, so the retry can send
        raise
    sent.save(update_fields=["provider_message_id"])
    return True
