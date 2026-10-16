from accounts.models import Account

from .statements import monthly_statement


def statement(request, pk, month):
    return monthly_statement(Account.objects.get(pk=pk), month)
