from django.db import models
from django.utils import timezone

from orders.models import Order


class SentEmail(models.Model):
    """1 row per email sent about an order: the guard against sending it twice, and the trail for support."""

    class Kind(models.TextChoices):
        ORDER_CONFIRMATION = "order_confirmation"

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="sent_emails")
    kind = models.CharField(max_length=32, choices=Kind.choices)
    to = models.EmailField()
    provider_message_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["order", "kind"], name="one_email_per_order_and_kind")]
