# orders

## Purpose
Creación y ciclo de vida de pedidos.

## Requirements
### Requirement: Crear pedido
El sistema SHALL crear un pedido con total positivo.

#### Scenario: Total inválido
- **WHEN** se crea un pedido con total <= 0
- **THEN** la creación falla
