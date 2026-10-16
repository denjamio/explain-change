from django.urls import path
from accounts import views

urlpatterns = [path('accounts/<int:pk>/', views.detail)]
