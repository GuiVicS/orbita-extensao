"""Auto-instalação do próprio .exe: copia pra %LOCALAPPDATA%, inicia com o Windows e evita instâncias duplicadas."""
import ctypes
import os
import shutil
import subprocess
import sys
import winreg
from pathlib import Path

INSTALL_DIR = Path(os.getenv("LOCALAPPDATA", Path.home())) / "OrbitaUpdater"
INSTALLED_EXE = INSTALL_DIR / "OrbitaUpdater.exe"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "OrbitaUpdater"
MUTEX_NAME = "Local\\OrbitaUpdaterSingleInstance"
ERROR_ALREADY_EXISTS = 183
SYNCHRONIZE = 0x00100000

_mutex = None  # mantido vivo enquanto o processo roda


def is_frozen() -> bool:
    return getattr(sys, "frozen", False)


def running_from_install_dir() -> bool:
    try:
        return Path(sys.executable).resolve() == INSTALLED_EXE.resolve()
    except OSError:
        return False


def acquire_single_instance() -> bool:
    """True se esta for a única instância rodando."""
    global _mutex
    _mutex = ctypes.windll.kernel32.CreateMutexW(None, False, MUTEX_NAME)
    return ctypes.windll.kernel32.GetLastError() != ERROR_ALREADY_EXISTS


def another_instance_running() -> bool:
    """Checa sem segurar o mutex (pra não bloquear a cópia instalada que vamos abrir)."""
    handle = ctypes.windll.kernel32.OpenMutexW(SYNCHRONIZE, False, MUTEX_NAME)
    if handle:
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    return False


def set_autostart(enabled: bool = True) -> None:
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, RUN_VALUE, 0, winreg.REG_SZ, f'"{INSTALLED_EXE}"')
        else:
            try:
                winreg.DeleteValue(key, RUN_VALUE)
            except FileNotFoundError:
                pass


def install_self() -> None:
    """Copia o .exe atual pra pasta de instalação, registra na inicialização e abre a cópia instalada."""
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(sys.executable, INSTALLED_EXE)
    set_autostart(True)
    subprocess.Popen([str(INSTALLED_EXE)], close_fds=True)


def uninstall() -> None:
    """Remove da inicialização e agenda a exclusão do .exe instalado (depois que o processo fechar)."""
    set_autostart(False)
    subprocess.Popen(
        f'cmd /c timeout /t 3 /nobreak >nul & rmdir /s /q "{INSTALL_DIR}"',
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
