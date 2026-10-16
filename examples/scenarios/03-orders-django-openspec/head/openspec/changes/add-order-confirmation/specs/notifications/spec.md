## ADDED Requirements
### Requirement: Order confirmation email
The system SHALL send 1 confirmation email per paid order to the order's contact email, with its lines and total.

#### Scenario: Order paid
- **WHEN** the confirmation task runs for a paid order
- **THEN** Postmark receives 1 message for the order's contact email
- **AND** a SentEmail row records the Postmark message id

#### Scenario: Task runs twice
- **WHEN** the confirmation task runs again for the same order
- **THEN** no second message is sent

### Requirement: Retry failed sends
The system SHALL retry a send that fails because of the email provider, with backoff, up to 5 times.

#### Scenario: Postmark is down
- **WHEN** Postmark answers with an error or does not answer
- **THEN** the order stays paid
- **AND** the task is retried later
