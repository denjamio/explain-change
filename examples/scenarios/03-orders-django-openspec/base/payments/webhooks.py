from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from payments.provider import InvalidSignature, parse_webhook
from payments.services import handle_payment_event


@csrf_exempt
@require_POST
def payment_webhook(request):
    try:
        event = parse_webhook(request.body, request.headers.get("X-Signature", ""))
    except InvalidSignature:
        return HttpResponse(status=400)
    handle_payment_event(event)
    return HttpResponse(status=204)
