## Context
Las integraciones externas viven fuera de la app orders.

## Decisions
### Decision: App notifications para el email
orders llama a una función de notifications; no conoce el backend de email.

### Decision: Notificar al crear el pedido
El email sale en la misma petición que crea el pedido.

## Risks / Trade-offs
- Si el SMTP falla, la petición falla.
