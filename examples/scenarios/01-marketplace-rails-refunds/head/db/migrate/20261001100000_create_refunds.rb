class CreateRefunds < ActiveRecord::Migration[7.2]
  def change
    create_table :refunds do |t|
      t.references :order, null: false, foreign_key: true
      t.decimal :amount, precision: 10, scale: 2, null: false
      t.string :idempotency_key, null: false, index: { unique: true }
      t.timestamps
    end
  end
end
