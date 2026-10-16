from django.db import transaction

from catalog.models import Product
from customers.models import Customer
from orders.models import Order, OrderLine


@transaction.atomic
def place_order(customer: Customer, items: list[tuple[str, int]]) -> Order:
    """Reserves the stock of each item and creates a placed order."""
    if not items:
        raise ValueError("An order needs at least 1 item")
    products = {p.sku: p for p in Product.objects.select_for_update().filter(sku__in=[sku for sku, _ in items])}
    lines = []
    for sku, quantity in items:
        product = products[sku]
        product.reserve(quantity)
        lines.append(OrderLine(product=product, quantity=quantity, unit_price_cents=product.price_cents))
    order = Order.objects.create(
        customer=customer,
        total_cents=sum(line.quantity * line.unit_price_cents for line in lines),
    )
    for line in lines:
        line.order = order
    OrderLine.objects.bulk_create(lines)
    return order


@transaction.atomic
def mark_order_paid(order_id: int, paid_at) -> Order:
    """Called by Payments when the provider confirms the charge."""
    order = Order.objects.select_for_update().get(pk=order_id)
    order.mark_paid(paid_at)
    return order
