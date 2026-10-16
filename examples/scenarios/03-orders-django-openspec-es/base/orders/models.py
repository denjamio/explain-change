from django.core.exceptions import ValidationError
from django.db import models


class Order(models.Model):
    total = models.DecimalField(max_digits=10, decimal_places=2)

    @classmethod
    def place(cls, total):
        if total <= 0:
            raise ValidationError("invalid total")
        return cls.objects.create(total=total)
