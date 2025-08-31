import os, pandas as pd
from dotenv import load_dotenv

load_dotenv()
_DF = None

def get_df():
    global _DF
    if _DF is None:
        path = os.getenv('DATASET_PATH')
        _DF = pd.read_csv(path, low_memory=False, encoding='utf-8')
    return _DF
