from dataclasses import dataclass
from typing import Protocol

import requests
from django.conf import settings


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    text: str


class GatewayError(Exception):
    """The provider refused the message or did not answer: the send can be retried."""


class EmailGateway(Protocol):
    def send(self, email: Email) -> str:
        """Sends the email and returns the provider's message id."""


class PostmarkGateway:
    URL = "https://api.postmarkapp.com/email"

    def __init__(self, token: str, sender: str):
        self.token = token
        self.sender = sender

    def send(self, email: Email) -> str:
        try:
            response = requests.post(
                self.URL,
                json={"From": self.sender, "To": email.to, "Subject": email.subject, "TextBody": email.text},
                headers={"X-Postmark-Server-Token": self.token, "Accept": "application/json"},
                timeout=10,
            )
        except requests.RequestException as error:
            raise GatewayError(str(error)) from error
        if response.status_code != 200:
            raise GatewayError(f"Postmark answered {response.status_code}")
        return response.json()["MessageID"]


def default_gateway() -> EmailGateway:
    return PostmarkGateway(settings.POSTMARK_SERVER_TOKEN, settings.EMAIL_FROM)
