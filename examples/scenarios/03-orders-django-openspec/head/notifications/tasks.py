from celery import shared_task

from notifications import services
from notifications.gateway import GatewayError


@shared_task(autoretry_for=(GatewayError,), retry_backoff=30, retry_backoff_max=1800, max_retries=5)
def send_order_confirmation(order_id: int) -> None:
    services.send_order_confirmation(order_id)
