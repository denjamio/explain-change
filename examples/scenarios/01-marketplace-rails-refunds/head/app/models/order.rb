class Order < ApplicationRecord
  has_many :refunds
  validates :total, numericality: { greater_than: 0 }

  def refund!(amount, key:)
    raise ArgumentError, "amount exceeds refundable total" if amount > refundable_total
    refunds.create!(amount: amount, idempotency_key: key)
  end

  def refundable_total = total - refunds.sum(:amount)
end
