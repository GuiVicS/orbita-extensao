"""Consulta a API pública do GitHub para achar a última release da extensão."""
import requests

API_BASE = "https://api.github.com"


def get_latest_release(repo: str) -> dict | None:
    """Retorna o JSON da última release (tag_name, assets, etc.) ou None se não houver nenhuma."""
    url = f"{API_BASE}/repos/{repo}/releases/latest"
    resp = requests.get(url, timeout=15, headers={"Accept": "application/vnd.github+json"})
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def find_dist_asset(release: dict) -> dict | None:
    """Procura o .zip da extensão compilada anexado na release."""
    assets = release.get("assets", [])
    for asset in assets:
        name = asset["name"].lower()
        if name.endswith(".zip") and ("dist" in name or "extensao" in name or "extension" in name):
            return asset
    for asset in assets:
        if asset["name"].lower().endswith(".zip"):
            return asset
    return None
