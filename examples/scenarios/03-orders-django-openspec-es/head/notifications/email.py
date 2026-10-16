from django.core.mail import send_mail

from orders.models import Order


def send_order_confirmation(order: Order):
    send_mail("Pedido confirmado", f"Pedido {order.id} registrado.", None, [order.email])
