from django.urls import path

from orders import views

urlpatterns = [path("orders/", views.create)]
