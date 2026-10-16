from orders.models import Order


def create_order(total):
    return Order.place(total)
