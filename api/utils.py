# utils.py
import os, os.path, pandas as pd, csv
from dotenv import load_dotenv
load_dotenv()

# Cache controlado por ruta + mtime
_CACHE = {"path": None, "mtime": None, "df": None}

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
    Devuelve un DataFrame cacheado. Se invalida si cambia la ruta
    (DATASET_PATH) o el mtime del archivo.
    """
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
        # ⬇️ aquí estaba el typo: usemos .update correctamente
        _CACHE.update({"path": path, "mtime": mtime, "df": df})
    return _CACHE["df"]
