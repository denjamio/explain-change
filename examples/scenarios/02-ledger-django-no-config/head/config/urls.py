from django.urls import path
from accounts import views
from reports import views as report_views

urlpatterns = [
    path('accounts/<int:pk>/', views.detail),
    path('accounts/<int:pk>/statements/<int:month>/', report_views.statement),
]
