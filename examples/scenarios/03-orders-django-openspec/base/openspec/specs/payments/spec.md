# payments

## Purpose
Applying the payment provider's events to payments and orders.

## Requirements
### Requirement: Apply payment webhooks once
The system SHALL apply each provider event at most once, and SHALL refuse events with an invalid signature.

#### Scenario: Repeated delivery
- **WHEN** the provider delivers the same payment.succeeded event twice
- **THEN** the order is marked paid once

#### Scenario: Invalid signature
- **WHEN** the X-Signature header does not match the payload
- **THEN** the webhook answers 400 and changes nothing
