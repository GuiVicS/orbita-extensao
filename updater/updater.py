"""Baixa e extrai o zip da extensão na pasta de instalação, com backup da versão anterior."""
import io
import shutil
import zipfile
from pathlib import Path

import requests


def download_and_extract(asset_url: str, destination: Path) -> Path:
    resp = requests.get(asset_url, timeout=60, headers={"Accept": "application/octet-stream"})
    resp.raise_for_status()

    destination = Path(destination)

    # Backup da versão anterior (por segurança, sobrescreve o backup anterior)
    backup_dir = destination.parent / f"{destination.name}_backup"
    if destination.exists():
        if backup_dir.exists():
            shutil.rmtree(backup_dir, ignore_errors=True)
        shutil.copytree(destination, backup_dir)
        shutil.rmtree(destination, ignore_errors=True)

    destination.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        # Se o zip tiver uma única pasta raiz (ex: dist/manifest.json), extrai o conteúdo dela direto
        roots = {n.split("/")[0] for n in names if "/" in n}
        single_root = len(roots) == 1 and all(n.startswith(next(iter(roots)) + "/") for n in names)

        if single_root:
            root = next(iter(roots))
            for member in names:
                rel = member[len(root) + 1:]
                if not rel:
                    continue
                target = destination / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
        else:
            zf.extractall(destination)

    return destination
