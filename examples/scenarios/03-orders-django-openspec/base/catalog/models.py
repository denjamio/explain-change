from django.db import models


class Product(models.Model):
    sku = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=200)
    price_cents = models.PositiveIntegerField()
    stock = models.PositiveIntegerField(default=0)

    def reserve(self, quantity: int) -> None:
        if quantity > self.stock:
            raise OutOfStock(self.sku)
        self.stock -= quantity
        self.save(update_fields=["stock"])


class OutOfStock(Exception):
    pass
