from django.core.exceptions import ValidationError
from django.db import models


class Order(models.Model):
    total = models.DecimalField(max_digits=10, decimal_places=2)
    email = models.EmailField()

    @classmethod
    def place(cls, total, email):
        if total <= 0:
            raise ValidationError("invalid total")
        if "@" not in email:
            raise ValidationError("invalid email")
        return cls.objects.create(total=total, email=email)
