from rest_framework.decorators import api_view
from rest_framework.response import Response
import numpy as np
import pandas as pd
from .utils import get_df, set_df, get_df_name  # ← AÑADE set_df y get_df_name

from django.shortcuts import render
from .forms import UploadDataForm
from io import BytesIO
import csv

SUPPORTED_EXTS = ('.csv', '.xlsx', '.xls', '.parquet', '.json')

def _read_dataset_from_upload(uploaded_file) -> pd.DataFrame:
    """
    Lee CSV/XLSX/Parquet/JSON directo desde request.FILES (no escribe a disco).
    """
    name = uploaded_file.name.lower()
    raw = uploaded_file.read()

    if name.endswith('.csv'):
        preview = raw[:5000].decode('utf-8', errors='ignore')
        try:
            dialect = csv.Sniffer().sniff(preview)
            sep = dialect.delimiter
        except Exception:
            sep = ','
        return pd.read_csv(BytesIO(raw), sep=sep, low_memory=False)

    if name.endswith('.xlsx') or name.endswith('.xls'):
        return pd.read_excel(BytesIO(raw))

    if name.endswith('.parquet'):
        return pd.read_parquet(BytesIO(raw))  # requiere pyarrow o fastparquet

    if name.endswith('.json'):
        try:
            return pd.read_json(BytesIO(raw), lines=True)
        except ValueError:
            return pd.read_json(BytesIO(raw))

    raise ValueError('Formato no soportado. Sube CSV, XLSX, Parquet o JSON.')

def _compute_profile(df: pd.DataFrame):
    profile = {}
    profile['shape'] = {'rows': int(df.shape[0]), 'cols': int(df.shape[1])}
    nulls = df.isna().sum().sort_values(ascending=False)
    profile['nulls_by_col'] = nulls.to_dict()
    profile['row_duplicates'] = int(df.duplicated().sum())
    dtype_counts = df.dtypes.astype(str).value_counts()
    profile['dtypes'] = dtype_counts.to_dict()
    card = (df.nunique(dropna=False) / len(df) * 100).round(2) if len(df) > 0 else (df.nunique(dropna=False) * 0)
    profile['cardinality_pct'] = card.to_dict()
    return profile

# Placeholder por si aún no llamas a utils.py
def build_charts(df: pd.DataFrame):
    # Reemplaza esto por tus gráficas reales o importa desde utils.py
    return {
        'top_nulls': sorted(_compute_profile(df)['nulls_by_col'].items(), key=lambda x: x[1], reverse=True)[:15]
    }

def dashboard(request):
    """
    Renderiza templates/index.html con barra de carga arriba.
    Guarda el último dataset en sesión para recargas.
    Además, activa el DF subido para que lo usen los endpoints /api/*.
    """
    form = UploadDataForm()
    df = None
    ds_name = None  # ← NUEVO

    if request.method == 'POST':
        form = UploadDataForm(request.POST, request.FILES)
        if form.is_valid():
            up = request.FILES['data_file']
            if not any(up.name.lower().endswith(ext) for ext in SUPPORTED_EXTS):
                form.add_error('data_file', 'Formato no soportado. Sube CSV, XLSX, Parquet o JSON.')
            else:
                try:
                    df = _read_dataset_from_upload(up)
                    # Persistencia en sesión (si quieres seguir usándola)
                    request.session['df_json'] = df.to_json(orient='split')
                    request.session['df_name'] = up.name
                    # <<<<<<<< clave: activa override en memoria para /api/* >>>>>>>>
                    set_df(df, name=up.name)
                    ds_name = up.name
                except Exception as e:
                    form.add_error('data_file', f'Error al leer el archivo: {e}')

    # Si no hubo POST o no se subió, intenta recuperar nombre desde utils
    if ds_name is None:
        ds_name = get_df_name() or request.session.get('df_name')

    if df is None and request.session.get('df_json'):
        try:
            df = pd.read_json(request.session['df_json'], orient='split')
        except Exception:
            df = None

    context = {
        'form': form,
        'file_name': request.session.get('df_name'),  # si lo usas en otro lugar
        'ds_name': ds_name,                           # ← para tu pill en el HTML
    }

    if df is not None:
        context['profile'] = _compute_profile(df)
        context['charts'] = build_charts(df)

    return render(request, 'index.html', context)

@api_view(['GET'])
def summary(request):
    df = get_df()
    total_rows = len(df)
    total_cols = len(df.columns)
    nulls = int(df.isna().sum().sum())
    null_pct = float(nulls / (total_rows * total_cols) * 100) if total_rows else 0.0
    dups = int(df.duplicated().sum())
    return Response({
        "rows": total_rows,
        "cols": total_cols,
        "null_cells": nulls,
        "null_pct": round(null_pct, 2),
        "dup_rows": dups,
    })

@api_view(['GET'])
def nulls_per_column(request):
    df = get_df()
    s = df.isna().sum().sort_values(ascending=False)
    data = [{"column": c, "nulls": int(s[c])} for c in s.index]
    return Response(data)

@api_view(['GET'])
def cardinality(request):
    df = get_df()
    s = df.nunique(dropna=False).sort_values(ascending=False)
    data = [{"column": c, "unique": int(s[c])} for c in s.index]
    return Response(data)

@api_view(['GET'])
def outliers(request):
    df = get_df()
    res = []
    for col in df.select_dtypes(include=[np.number]).columns:
        s = df[col].dropna()
        if s.empty:
            count = 0
        else:
            q1, q3 = s.quantile(0.25), s.quantile(0.75)
            iqr = q3 - q1
            lower, upper = q1 - 1.5*iqr, q3 + 1.5*iqr
            count = int(((s < lower) | (s > upper)).sum())
        res.append({"column": col, "outliers": count})
    res.sort(key=lambda x: x["outliers"], reverse=True)
    return Response(res)

@api_view(['GET'])
def distribution(request):
    col = request.GET.get('column')
    bins = int(request.GET.get('bins', '20'))
    top  = int(request.GET.get('top', '50'))
    df = get_df()

    if col not in df.columns:
        return Response({"error": "column not found"}, status=400)

    s = df[col]
    if s.dtype.kind in 'biufc':  # numérica
        s = s.dropna().astype(float)
        bins = max(5, min(bins, 100))
        hist, edges = np.histogram(s, bins=bins)
        return Response({
            "bins": edges.tolist(),
            "counts": hist.tolist(),
            "numeric": True
        })
    else:
        top = max(5, min(top, 50))
        vc = s.astype(str).value_counts(dropna=False).head(top)
        counts = vc.values.tolist()
        labels = vc.index.tolist()
        # <- chequeo extra
        if max(counts) <= 1:
            return Response({"labels": labels, "counts": counts, "numeric": False, "unique_like": True})
        return Response({"labels": labels, "counts": counts, "numeric": False})


# -----------------------------------------------------------------------
@api_view(['GET'])
def types(request):
    df = get_df()
    counts = df.dtypes.astype(str).value_counts()
    return Response([{"dtype": k, "columns": int(v)} for k, v in counts.items()])

@api_view(['GET'])
def numeric_columns(request):
    """
    Devuelve la lista de columnas numéricas disponibles para boxplot.
    """
    df = get_df()
    cols = df.select_dtypes(include=[np.number]).columns.tolist()
    return Response({"columns": cols})

@api_view(['GET'])
def boxplot(request):
    """
    Devuelve los estadísticos para un boxplot tipo Tukey (IQR) de una columna:
    min, q1, median, q3, max y outliers (valores fuera de [Q1-1.5*IQR, Q3+1.5*IQR]).
    """
    col = request.GET.get('column')
    if not col:
        return Response({"error": "column param required"}, status=400)

    df = get_df()
    if col not in df.columns:
        return Response({"error": "column not found"}, status=400)

    s = df[col].dropna()
    if s.empty or not np.issubdtype(s.dtype, np.number):
        return Response({"error": "column is not numeric or has no data"}, status=400)

    s = s.astype(float)
    q1 = float(s.quantile(0.25))
    med = float(s.quantile(0.50))
    q3 = float(s.quantile(0.75))
    iqr = q3 - q1
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr

    # whiskers: típicamente el valor más extremo dentro de [lower, upper]
    inside = s[(s >= lower) & (s <= upper)]
    if inside.empty:
        whisk_min = float(s.min())
        whisk_max = float(s.max())
    else:
        whisk_min = float(inside.min())
        whisk_max = float(inside.max())

    outliers = s[(s < lower) | (s > upper)].tolist()

    return Response({
        "column": col,
        "min": whisk_min,
        "q1": q1,
        "median": med,
        "q3": q3,
        "max": whisk_max,
        "outliers": outliers,
        "lower_fence": float(lower),
        "upper_fence": float(upper)
    })
    
@api_view(['GET'])
def describe_numeric(request):
    """
    Estadísticos de columnas numéricas:
    count, mean, std, min, 5%, 25%, 50%(median), 75%, 95%, max.
    """
    df = get_df()
    num = df.select_dtypes(include=[np.number])
    if num.empty:
        return Response({"columns": [], "rows": []})

    desc = num.describe(percentiles=[.05, .25, .5, .75, .95]).T
    desc = desc.rename(columns={
        'count':'count','mean':'mean','std':'std','min':'min',
        '5%':'p05','25%':'p25','50%':'median','75%':'p75','95%':'p95','max':'max'
    })
    order = ['count','mean','std','min','p05','p25','median','p75','p95','max']
    cols_present = [c for c in order if c in desc.columns]
    desc = desc[cols_present].round(6)

    rows = []
    for col, row in desc.iterrows():
        item = {"column": col}
        for k in cols_present:
            v = row[k]
            if pd.isna(v):
                item[k] = None
            else:
                item[k] = int(v) if k == 'count' else float(v)
        rows.append(item)
    return Response({"columns": cols_present, "rows": rows})