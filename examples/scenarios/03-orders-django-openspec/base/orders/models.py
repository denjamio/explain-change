from django.db import models
from django.utils import timezone

from catalog.models import Product
from customers.models import Customer


class Order(models.Model):
    class Status(models.TextChoices):
        PLACED = "placed"
        PAID = "paid"
        CANCELLED = "cancelled"

    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="orders")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PLACED)
    total_cents = models.PositiveIntegerField()
    placed_at = models.DateTimeField(default=timezone.now)
    paid_at = models.DateTimeField(null=True, blank=True)

    def mark_paid(self, paid_at) -> None:
        if self.status != self.Status.PLACED:
            raise InvalidTransition(self.status, self.Status.PAID)
        self.status = self.Status.PAID
        self.paid_at = paid_at
        self.save(update_fields=["status", "paid_at"])


class OrderLine(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="lines")
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    unit_price_cents = models.PositiveIntegerField()


class InvalidTransition(Exception):
    pass
