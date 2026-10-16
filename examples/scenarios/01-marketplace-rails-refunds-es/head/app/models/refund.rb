class Refund < ApplicationRecord
  belongs_to :order
  validates :amount, numericality: { greater_than: 0 }
  validates :idempotency_key, presence: true, uniqueness: true
end
