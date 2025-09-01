from rest_framework.decorators import api_view
from rest_framework.response import Response
import numpy as np
import pandas as pd
from .utils import get_df

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
def duplicates(request):
    """
    Devuelve total de duplicados, únicos y una muestra.
    keep=False para incluir TODAS las repeticiones en la muestra.
    """
    import pandas as pd
    import numpy as np

    df = get_df()
    mask = df.duplicated(keep=False)
    dup_total = int(mask.sum())
    unique_total = int(len(df) - dup_total)

    # Muestra (hasta 10 filas)
    sample = df[mask].head(10).copy()

    # Convertir a tipos serializables: NaN/NaT -> None
    # (astype(object) + where es robusto para NaN y NaT)
    sample = sample.astype(object).where(pd.notna(sample), None)
    sample_json = sample.to_dict(orient='records')

    return Response({
        "dup_rows": dup_total,
        "unique_rows": unique_total,
        "total": int(len(df)),
        "sample": sample_json
    })
'''
@api_view(['GET'])
def correlation(request):
    """
    Matriz de correlación muestral para columnas numéricas.
    Parámetros:
    - max (int)    : máximo de columnas (por varianza). Default 12.
    - sample (int) : cuántas filas muestrear. Default 10000.
    """
    import numpy as np
    import pandas as pd

    df = get_df()
    num_cols = df.select_dtypes(include=[np.number]).columns
    if len(num_cols) < 2:
        return Response({"labels": [], "matrix": []})

    try:
        max_cols = max(2, int(request.GET.get('max', '12')))
    except ValueError:
        max_cols = 12
    try:
        sample_n = max(1000, int(request.GET.get('sample', '10000')))
    except ValueError:
        sample_n = 10000

    # Quita columnas constantes (std=0) para evitar NaN
    std = df[num_cols].std(numeric_only=True)
    non_constant = std[std > 0].index
    if len(non_constant) < 2:
        return Response({"labels": [], "matrix": []})

    # Top por varianza (más informativas)
    var = df[non_constant].var().sort_values(ascending=False)
    cols = var.head(min(max_cols, len(var))).index

    # Muestra de filas para acelerar
    df_s = df[cols]
    if len(df_s) > sample_n:
        df_s = df_s.sample(n=sample_n, random_state=0)

    # Corr sobre float32 para ahorrar memoria
    corr = df_s.astype('float32').corr(numeric_only=True)

    # Sustituir NaN/Inf por 0.0 para JSON
    corr = corr.replace({np.nan: 0.0, np.inf: 0.0, -np.inf: 0.0})

    # Redondea (opcional) para reducir tamaño
    corr = corr.round(3)

    return Response({
        "labels": list(cols),
        "matrix": corr.values.tolist()
    })

'''
