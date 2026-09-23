"""Configuração persistente do Orbita Updater (%APPDATA%\\OrbitaUpdater\\config.json)."""
import json
import os
from pathlib import Path

APP_DIR = Path(os.getenv("APPDATA", Path.home())) / "OrbitaUpdater"
APP_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_FILE = APP_DIR / "config.json"

DEFAULTS = {
    "install_path": None,
    "installed_version": None,
    "repo": "GuiVicS/orbita-extensao",
    "check_interval_minutes": 15,
}


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            return {**DEFAULTS, **data}
        except Exception:
            pass
    return dict(DEFAULTS)


def save_config(cfg: dict) -> None:
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
