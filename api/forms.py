from django import forms

class UploadDataForm(forms.Form):
    data_file = forms.FileField(
        label='Dataset',
        help_text='Formatos: CSV, XLSX, Parquet, JSON'
    )
