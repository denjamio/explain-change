from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [("orders", "0001_initial")]

    operations = [
        migrations.CreateModel(
            name="Payment",
            fields=[
                ("id", models.BigAutoField(primary_key=True)),
                ("provider_ref", models.CharField(max_length=64, unique=True)),
                ("status", models.CharField(default="pending", max_length=16)),
                ("amount_cents", models.PositiveIntegerField()),
                ("order", models.ForeignKey(on_delete=models.PROTECT, related_name="payments", to="orders.order")),
            ],
        ),
    ]
