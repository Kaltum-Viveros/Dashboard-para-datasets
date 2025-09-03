# api/utils.py
import os, os.path, pandas as pd, csv
from dotenv import load_dotenv
load_dotenv()

# Cache controlado por ruta + mtime
_CACHE = {"path": None, "mtime": None, "df": None}

# ====== NUEVO: override en memoria para dataset subido ======
_OVERRIDE_DF_JSON = None   # DataFrame activo (JSON orient='split')
_OVERRIDE_DF_NAME = None   # Nombre del archivo subido (para UI)

def set_df(df: pd.DataFrame, name: str | None = None) -> None:
    """Activa un DataFrame en memoria para que get_df() lo regrese."""
    global _override_enabled, _OVERRIDE_DF_JSON, _OVERRIDE_DF_NAME
    _OVERRIDE_DF_JSON = df.to_json(orient='split')
    _OVERRIDE_DF_NAME = name

def get_df_name() -> str | None:
    """Devuelve el nombre del dataset activo (si fue subido por la UI)."""
    return _OVERRIDE_DF_NAME
# ============================================================

def _read_csv_autosep(path: str) -> pd.DataFrame:
    """
    Lee CSV detectando separador y codificación.
    - Primero intenta sep=None con engine='python' (sin low_memory).
    - Luego hace fallback con csv.Sniffer y prueba C-engine y python-engine.
    """
    encodings = ("utf-8", "utf-8-sig", "latin-1")

    # 1) Autodetección nativa de pandas
    for enc in encodings:
        try:
            return pd.read_csv(
                path,
                sep=None,            # autodetecta , ; | \t
                engine="python",     # requerido para sep=None
                encoding=enc,
                on_bad_lines="skip",
            )
        except Exception:
            pass

    # 2) Sniffer / heurística para elegir separador
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            sample = f.read(131072)
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        sep = dialect.delimiter
    except Exception:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            first = f.readline()
        sep = max([",",";","|","\t"], key=lambda d: first.count(d))

    # 3) Leer con el separador detectado
    for enc in encodings:
        # C-engine rápido (permite low_memory)
        try:
            return pd.read_csv(
                path,
                sep=sep,
                encoding=enc,
                low_memory=False,
                on_bad_lines="skip",
            )
        except Exception:
            # python-engine (sin low_memory)
            try:
                return pd.read_csv(
                    path,
                    sep=sep,
                    engine="python",
                    encoding=enc,
                    on_bad_lines="skip",
                )
            except Exception:
                continue

    # Último recurso
    return pd.read_csv(path)

def get_df():
    """
    Devuelve un DataFrame.
    Prioridad:
    1) Si hay dataset subido (override en memoria) → úsalo.
    2) Si no, usa DATASET_PATH (.env) con tu cache por ruta+mtime.
    """
    # 1) Override en memoria
    global _OVERRIDE_DF_JSON
    if _OVERRIDE_DF_JSON is not None:
        try:
            return pd.read_json(_OVERRIDE_DF_JSON, orient='split')
        except Exception:
            _OVERRIDE_DF_JSON = None  # limpia y cae a la ruta default

    # 2) Lectura por archivo configurado (tu lógica original)
    path = os.getenv("DATASET_PATH")
    if not path:
        raise RuntimeError("Falta DATASET_PATH en .env")

    # Normaliza la ruta por si viene con comillas o espacios
    path = path.strip().strip('"').strip("'")

    try:
        mtime = os.path.getmtime(path)
    except OSError as e:
        raise RuntimeError(f"No se puede leer el dataset en {path}: {e}")

    # recarga si cambia archivo o mtime
    if _CACHE["df"] is None or _CACHE["path"] != path or _CACHE["mtime"] != mtime:
        df = _read_csv_autosep(path)
        _CACHE.update({"path": path, "mtime": mtime, "df": df})

    return _CACHE["df"]
