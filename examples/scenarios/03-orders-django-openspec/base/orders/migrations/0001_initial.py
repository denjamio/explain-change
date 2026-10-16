import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [("catalog", "0001_initial"), ("customers", "0001_initial")]

    operations = [
        migrations.CreateModel(
            name="Order",
            fields=[
                ("id", models.BigAutoField(primary_key=True)),
                ("status", models.CharField(default="placed", max_length=16)),
                ("total_cents", models.PositiveIntegerField()),
                ("placed_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                ("customer", models.ForeignKey(on_delete=models.PROTECT, related_name="orders", to="customers.customer")),
            ],
        ),
        migrations.CreateModel(
            name="OrderLine",
            fields=[
                ("id", models.BigAutoField(primary_key=True)),
                ("quantity", models.PositiveIntegerField()),
                ("unit_price_cents", models.PositiveIntegerField()),
                ("order", models.ForeignKey(on_delete=models.CASCADE, related_name="lines", to="orders.order")),
                ("product", models.ForeignKey(on_delete=models.PROTECT, to="catalog.product")),
            ],
        ),
    ]
