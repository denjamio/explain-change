import os

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only")
DEBUG = os.environ.get("DEBUG") == "1"
ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "localhost").split(",")

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "rest_framework",
    "catalog",
    "customers",
    "orders",
    "payments",
    "notifications",
]

ROOT_URLCONF = "shop.urls"
DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": os.environ.get("DB_NAME", "larder")}}
CELERY_BROKER_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_TASK_ACKS_LATE = True

PAYMENTS_WEBHOOK_SECRET = os.environ.get("PAYMENTS_WEBHOOK_SECRET", "")

POSTMARK_SERVER_TOKEN = os.environ.get("POSTMARK_SERVER_TOKEN", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "Larder <orders@larder.example>")
