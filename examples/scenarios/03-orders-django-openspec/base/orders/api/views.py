from rest_framework import mixins, status, viewsets
from rest_framework.response import Response

from orders.api.serializers import OrderSerializer, PlaceOrderSerializer
from orders.models import Order
from orders.services import place_order


class OrderViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = OrderSerializer

    def get_queryset(self):
        return Order.objects.filter(customer__user=self.request.user).prefetch_related("lines__product")

    def create(self, request):
        payload = PlaceOrderSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        order = place_order(request.user.customer, [tuple(item) for item in payload.validated_data["items"]])
        return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)
