from decimal import Decimal

from accounts.models import Account
from billing.models import Invoice
from billing.services import open_invoices


def monthly_statement(account: Account, month):
    invoices = Invoice.objects.filter(account=account, created__month=month)
    return {"account": account.name, "total": sum((i.amount for i in invoices), Decimal(0)),
            "open": open_invoices(account).count()}
