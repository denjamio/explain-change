from django.db import transaction

from notifications.email import send_order_confirmation
from orders.models import Order


def create_order(total, email):
    with transaction.atomic():
        order = Order.place(total, email)
        send_order_confirmation(order)
    return order
