## ADDED Requirements
### Requirement: Email de confirmación
El sistema SHALL enviar un email de confirmación al cliente cuando se crea un pedido.

#### Scenario: Pedido creado
- **WHEN** se crea un pedido válido
- **THEN** el pedido se guarda
- **AND** el cliente recibe un email de confirmación

#### Scenario: SMTP caído
- **WHEN** el servidor SMTP no responde
- **THEN** el pedido se crea igualmente
- **AND** la confirmación se reintenta más tarde

## MODIFIED Requirements
### Requirement: Crear pedido
El sistema SHALL crear un pedido con total positivo y un email válido del cliente.

#### Scenario: Email inválido
- **WHEN** se crea un pedido con un email sin @
- **THEN** la creación falla
