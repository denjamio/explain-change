module Checkout
  class PlaceOrder
    def self.call(params)
      order = Order.create!(params)
      Payments::Gateway.charge(order)
      order
    end
  end
end
