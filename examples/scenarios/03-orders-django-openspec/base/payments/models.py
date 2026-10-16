from django.db import models

from orders.models import Order


class Payment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending"
        SUCCEEDED = "succeeded"
        FAILED = "failed"

    order = models.ForeignKey(Order, on_delete=models.PROTECT, related_name="payments")
    provider_ref = models.CharField(max_length=64, unique=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    amount_cents = models.PositiveIntegerField()
