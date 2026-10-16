from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Product",
            fields=[
                ("id", models.BigAutoField(primary_key=True)),
                ("sku", models.CharField(max_length=32, unique=True)),
                ("name", models.CharField(max_length=200)),
                ("price_cents", models.PositiveIntegerField()),
                ("stock", models.PositiveIntegerField(default=0)),
            ],
        ),
    ]
