from django.urls import path
from . import views

urlpatterns = [
    path('summary/', views.summary),
    path('nulls-per-column/', views.nulls_per_column),
    path('cardinality/', views.cardinality),
    path('outliers/', views.outliers),
    path('distribution/', views.distribution),
    path('types/', views.types),               
    path('duplicates/', views.duplicates),     
    ## path('correlation/', views.correlation),  
    path("histograms/", views.histograms),
    path("boxplots/", views.boxplots),
    path("topk/", views.topk_categories),
]
