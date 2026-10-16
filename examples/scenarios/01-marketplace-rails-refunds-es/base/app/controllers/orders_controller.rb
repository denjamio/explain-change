class OrdersController < ApplicationController
  def create
    order = Checkout::PlaceOrder.call(params)
    render json: order
  end
end
