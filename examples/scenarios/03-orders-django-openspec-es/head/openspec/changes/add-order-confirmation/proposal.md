# Change: Confirmación de pedido por email

## Why
Los clientes no saben si su pedido se registró y abren tickets de soporte para confirmarlo.

## What Changes
- Enviar un email de confirmación al crear un pedido.
- El pedido guarda el email del cliente y lo valida.
- **BREAKING**: `POST /orders/` exige `email`.

## Impact
- Specs: orders
- Código: modelo Order, servicio create_order, nueva app notifications.
