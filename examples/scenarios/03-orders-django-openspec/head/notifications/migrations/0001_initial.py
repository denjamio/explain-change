import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [("orders", "0002_order_contact_email")]

    operations = [
        migrations.CreateModel(
            name="SentEmail",
            fields=[
                ("id", models.BigAutoField(primary_key=True)),
                ("kind", models.CharField(max_length=32)),
                ("to", models.EmailField(max_length=254)),
                ("provider_message_id", models.CharField(blank=True, max_length=64)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("order", models.ForeignKey(on_delete=models.CASCADE, related_name="sent_emails", to="orders.order")),
            ],
            options={"constraints": [models.UniqueConstraint(fields=("order", "kind"), name="one_email_per_order_and_kind")]},
        ),
    ]
