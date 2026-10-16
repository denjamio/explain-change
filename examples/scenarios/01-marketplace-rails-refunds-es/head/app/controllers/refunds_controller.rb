class RefundsController < ApplicationController
  def create
    refund = Refunds::Create.call(
      order_id: params.require(:order_id),
      amount: params.require(:amount).to_d,
      key: request.headers.fetch("Idempotency-Key")
    )
    render json: refund, status: :created
  end
end
