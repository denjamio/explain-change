from rest_framework import serializers

from orders.models import Order, OrderLine


class OrderLineSerializer(serializers.ModelSerializer):
    sku = serializers.CharField(source="product.sku")

    class Meta:
        model = OrderLine
        fields = ["sku", "quantity", "unit_price_cents"]


class OrderSerializer(serializers.ModelSerializer):
    lines = OrderLineSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = ["id", "status", "total_cents", "placed_at", "paid_at", "lines"]


class PlaceOrderSerializer(serializers.Serializer):
    items = serializers.ListField(child=serializers.ListField(min_length=2, max_length=2), min_length=1)
