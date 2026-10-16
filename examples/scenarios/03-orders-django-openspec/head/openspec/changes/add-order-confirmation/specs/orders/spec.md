## MODIFIED Requirements
### Requirement: Place an order
The system SHALL create a placed order from a customer's items, reserve their stock in the same transaction, and
store the customer's current email as the order's contact email.

#### Scenario: Items in stock
- **WHEN** a customer places an order for items in stock
- **THEN** the order is placed with the total of its lines
- **AND** the stock of each product goes down by its quantity
- **AND** the order's contact email is the customer's email

#### Scenario: Item out of stock
- **WHEN** an item has less stock than its quantity
- **THEN** no order is created and no stock is reserved

### Requirement: Mark an order paid
The system SHALL mark a placed order as paid when Payments reports a successful charge, and SHALL queue its
confirmation email after the transaction commits.

#### Scenario: Payment succeeded
- **WHEN** Payments reports a successful charge for a placed order
- **THEN** the order status is paid and paid_at is the charge time
- **AND** a confirmation email is queued for the order

#### Scenario: Payment rolled back
- **WHEN** the transaction that marks the order paid rolls back
- **THEN** no confirmation email is queued
