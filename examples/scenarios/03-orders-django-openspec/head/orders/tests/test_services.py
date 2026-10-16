import pytest
from django.db import transaction

from orders.models import Order
from orders.services import mark_order_paid, place_order


@pytest.mark.django_db
def test_place_order_reserves_stock(customer, apples):
    order = place_order(customer, [(apples.sku, 3)])
    apples.refresh_from_db()
    assert (order.status, order.total_cents, apples.stock) == (Order.Status.PLACED, 3 * apples.price_cents, 7)
    assert order.contact_email == customer.email


@pytest.mark.django_db
def test_mark_order_paid(order, now, django_capture_on_commit_callbacks, mocker):
    delay = mocker.patch("orders.services.send_order_confirmation.delay")
    with django_capture_on_commit_callbacks(execute=True):
        assert mark_order_paid(order.id, now).status == Order.Status.PAID
    delay.assert_called_once_with(order.id)


@pytest.mark.django_db(transaction=True)
def test_rolled_back_payment_queues_nothing(order, now, mocker):
    delay = mocker.patch("orders.services.send_order_confirmation.delay")
    with pytest.raises(RuntimeError), transaction.atomic():
        mark_order_paid(order.id, now)
        raise RuntimeError
    delay.assert_not_called()
