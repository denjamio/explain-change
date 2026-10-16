import hashlib
import hmac
import json
from dataclasses import dataclass

from django.conf import settings


@dataclass(frozen=True)
class PaymentEvent:
    kind: str
    provider_ref: str
    occurred_at: str


class InvalidSignature(Exception):
    pass


def parse_webhook(payload: bytes, signature: str) -> PaymentEvent:
    """Checks the provider's HMAC signature and reads the event."""
    expected = hmac.new(settings.PAYMENTS_WEBHOOK_SECRET.encode(), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise InvalidSignature()
    body = json.loads(payload)
    return PaymentEvent(kind=body["type"], provider_ref=body["data"]["id"], occurred_at=body["created"])
