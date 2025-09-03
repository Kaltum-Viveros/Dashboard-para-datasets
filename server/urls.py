from django.contrib import admin
from django.urls import path, include
from .views import home

urlpatterns = [
    path("admin/", admin.site.urls),
    path('', include('api.urls')), # Include the api app URLs
    path("api/", include("api.urls")),
    path("", home, name="home"),
]
