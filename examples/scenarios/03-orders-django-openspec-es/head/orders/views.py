import json

from django.http import JsonResponse

from orders.services import create_order


def create(request):
    data = json.loads(request.body)
    order = create_order(data["total"], data["email"])
    return JsonResponse({"id": order.id}, status=201)
