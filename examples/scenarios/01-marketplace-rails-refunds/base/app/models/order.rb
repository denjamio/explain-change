class Order < ApplicationRecord
  validates :total, numericality: { greater_than: 0 }
end
