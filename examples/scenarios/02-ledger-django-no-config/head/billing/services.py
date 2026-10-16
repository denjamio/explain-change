from .models import Invoice


def open_invoices(account):
    return Invoice.objects.filter(account=account, paid=False).select_related('account')
