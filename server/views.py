from django.shortcuts import render
from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()

def home(request):
    ds_path = (os.getenv("DATASET_PATH") or "").strip().strip('"').strip("'")
    ds_name = Path(ds_path).name if ds_path else ""
    return render(request, "index.html", {"ds_path": ds_path, "ds_name": ds_name})
