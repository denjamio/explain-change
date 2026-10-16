from django.db import migrations, models
from django.db.models import OuterRef, Subquery


def backfill_contact_email(apps, schema_editor):
    Order = apps.get_model("orders", "Order")
    Customer = apps.get_model("customers", "Customer")
    Order.objects.update(contact_email=Subquery(Customer.objects.filter(pk=OuterRef("customer_id")).values("email")[:1]))


class Migration(migrations.Migration):
    dependencies = [("orders", "0001_initial")]

    operations = [
        migrations.AddField(model_name="order", name="contact_email", field=models.EmailField(default="", max_length=254), preserve_default=False),
        migrations.RunPython(backfill_contact_email, migrations.RunPython.noop),
    ]
