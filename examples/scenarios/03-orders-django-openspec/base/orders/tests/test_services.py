import pytest

from orders.models import Order
from orders.services import mark_order_paid, place_order


@pytest.mark.django_db
def test_place_order_reserves_stock(customer, apples):
    order = place_order(customer, [(apples.sku, 3)])
    apples.refresh_from_db()
    assert (order.status, order.total_cents, apples.stock) == (Order.Status.PLACED, 3 * apples.price_cents, 7)


@pytest.mark.django_db
def test_mark_order_paid(order, now):
    assert mark_order_paid(order.id, now).status == Order.Status.PAID
