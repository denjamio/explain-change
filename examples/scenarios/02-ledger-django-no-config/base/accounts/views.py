from .models import Account


def detail(request, pk):
    return Account.objects.get(pk=pk)
