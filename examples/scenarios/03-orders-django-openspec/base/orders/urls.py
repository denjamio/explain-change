from rest_framework.routers import DefaultRouter

from orders.api.views import OrderViewSet

router = DefaultRouter()
router.register("", OrderViewSet, basename="order")
urlpatterns = router.urls
