from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("orders", "0001_initial")]
    operations = [migrations.AddField("order", "email", models.EmailField(default=""), preserve_default=False)]
