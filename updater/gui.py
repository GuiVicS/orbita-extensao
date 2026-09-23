"""Formulário de primeira execução: escolher a pasta de instalação da extensão."""
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox


def ask_install_folder() -> str | None:
    root = tk.Tk()
    root.withdraw()
    messagebox.showinfo(
        "Orbita — Configuração inicial",
        "Escolha a pasta onde a extensão Orbita será instalada.\n\n"
        "Essa é a pasta que você vai selecionar depois no Chrome "
        "(chrome://extensions > Carregar sem compactação).",
    )
    folder = filedialog.askdirectory(title="Selecione a pasta de instalação da extensão Orbita")
    root.destroy()
    if not folder:
        return None
    path = Path(folder) / "Orbita-Extensao"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)
