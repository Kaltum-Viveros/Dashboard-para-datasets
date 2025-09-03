from django.urls import path
from . import views

urlpatterns = [
    path('summary/', views.summary),
    path('nulls-per-column/', views.nulls_per_column),
    path('cardinality/', views.cardinality),
    path('outliers/', views.outliers),
    path('distribution/', views.distribution),
    path('types/', views.types),               # <--
    # Endpoints del boxplot (sin prefijo 'api/')
    path('numeric-columns', views.numeric_columns),
    path('numeric-columns/', views.numeric_columns),
    path('boxplot', views.boxplot),
    path('boxplot/', views.boxplot),
    path('describe/', views.describe_numeric),   
    path('describe', views.describe_numeric),    

    path('', views.dashboard, name='dashboard'),
]
