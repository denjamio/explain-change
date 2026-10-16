module Payments
  class Gateway
    def self.charge(order)
      client.charges.create(amount: order.total, idempotency_key: "order-#{order.id}")
    end

    def self.refund(order, amount, idempotency_key:)
      client.refunds.create(charge: order.charge_id, amount: amount, idempotency_key: idempotency_key)
    end
  end
end
