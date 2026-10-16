from django.core.mail import send_mail

from orders.models import Order


def send_order_confirmation(order: Order):
    send_mail("Order confirmed", f"Order {order.id} registered.", None, [order.email])
