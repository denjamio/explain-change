RSpec.describe Refunds::Create do
  it "is idempotent per key" do
    first = described_class.call(order_id: order.id, amount: 5, key: "k1")
    expect(described_class.call(order_id: order.id, amount: 5, key: "k1")).to eq(first)
  end
end
