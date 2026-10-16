import pytest

from notifications.gateway import GatewayError
from notifications.models import SentEmail
from notifications.services import send_order_confirmation


class FakeGateway:
    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    def send(self, email):
        if self.fail:
            raise GatewayError("down")
        self.sent.append(email)
        return f"msg-{len(self.sent)}"


@pytest.mark.django_db
def test_sends_once_to_the_contact_email(paid_order):
    gateway = FakeGateway()
    assert send_order_confirmation(paid_order.id, gateway) is True
    assert send_order_confirmation(paid_order.id, gateway) is False
    assert [e.to for e in gateway.sent] == [paid_order.contact_email]
    assert SentEmail.objects.get(order=paid_order).provider_message_id == "msg-1"


@pytest.mark.django_db
def test_a_failed_send_can_be_retried(paid_order):
    with pytest.raises(GatewayError):
        send_order_confirmation(paid_order.id, FakeGateway(fail=True))
    assert not SentEmail.objects.filter(order=paid_order).exists()
    assert send_order_confirmation(paid_order.id, FakeGateway()) is True
