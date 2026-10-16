## ADDED Requirements
### Requirement: Confirmation email
The system SHALL send a confirmation email to the customer when an order is created.

#### Scenario: Order created
- **WHEN** a valid order is created
- **THEN** the order is saved
- **AND** the customer receives a confirmation email

#### Scenario: SMTP down
- **WHEN** the SMTP server does not answer
- **THEN** the order is created anyway
- **AND** the confirmation is retried later

## MODIFIED Requirements
### Requirement: Create order
The system SHALL create an order with a positive total and a valid customer email.

#### Scenario: Invalid email
- **WHEN** an order is created with an email without @
- **THEN** creation fails
