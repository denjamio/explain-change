from django.urls import path

from payments.webhooks import payment_webhook

urlpatterns = [path("webhook/", payment_webhook)]
