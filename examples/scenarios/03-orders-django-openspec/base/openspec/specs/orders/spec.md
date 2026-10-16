# orders

## Purpose
Placing orders and their life cycle, from placed to paid.

## Requirements
### Requirement: Place an order
The system SHALL create a placed order from a customer's items and reserve their stock in the same transaction.

#### Scenario: Items in stock
- **WHEN** a customer places an order for items in stock
- **THEN** the order is placed with the total of its lines
- **AND** the stock of each product goes down by its quantity

#### Scenario: Item out of stock
- **WHEN** an item has less stock than its quantity
- **THEN** no order is created and no stock is reserved

### Requirement: Mark an order paid
The system SHALL mark a placed order as paid when Payments reports a successful charge.

#### Scenario: Payment succeeded
- **WHEN** Payments reports a successful charge for a placed order
- **THEN** the order status is paid and paid_at is the charge time
