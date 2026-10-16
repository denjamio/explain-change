# orders

## Purpose
Creating orders and their lifecycle.

## Requirements
### Requirement: Create order
The system SHALL create an order with a positive total.

#### Scenario: Invalid total
- **WHEN** an order is created with a total <= 0
- **THEN** creation fails
