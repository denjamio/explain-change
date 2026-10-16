module Refunds
  class Create
    def self.call(order_id:, amount:, key:)
      existing = Refund.find_by(idempotency_key: key)
      return existing if existing

      order = Order.find(order_id)
      refund = order.refund!(amount, key: key)
      Payments::Gateway.refund(order, amount, idempotency_key: key)
      RefundMailer.confirmation(refund).deliver_later
      refund
    end
  end
end
