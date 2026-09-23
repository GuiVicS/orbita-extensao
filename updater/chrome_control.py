"""Fecha e reabre o Chrome (necessário para o Chrome recarregar a extensão atualizada)."""
import os
import subprocess

import psutil

CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
]


def find_chrome_exe() -> str | None:
    for p in CHROME_PATHS:
        if p and os.path.exists(p):
            return p
    return None


def close_chrome() -> bool:
    procs = [p for p in psutil.process_iter(["name"]) if (p.info.get("name") or "").lower() == "chrome.exe"]
    if not procs:
        return False
    for p in procs:
        try:
            p.terminate()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    _gone, alive = psutil.wait_procs(procs, timeout=10)
    for p in alive:
        try:
            p.kill()
        except Exception:
            pass
    return True


def reopen_chrome() -> bool:
    exe = find_chrome_exe()
    if not exe:
        return False
    subprocess.Popen([exe])
    return True


def open_extensions_page() -> bool:
    """Abre chrome://extensions pra facilitar o 'Carregar sem compactação' da primeira instalação."""
    exe = find_chrome_exe()
    if not exe:
        return False
    subprocess.Popen([exe, "chrome://extensions"])
    return True
