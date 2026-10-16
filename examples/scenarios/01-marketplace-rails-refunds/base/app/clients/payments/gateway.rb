module Payments
  class Gateway
    def self.charge(order)
      client.charges.create(amount: order.total, idempotency_key: "order-#{order.id}")
    end
  end
end
