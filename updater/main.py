"""
Orbita Updater
--------------
App portátil pra Windows que instala e mantém a extensão Orbita
(https://github.com/GuiVicS/orbita-extensao) sempre atualizada.

- Primeira execução: pergunta a pasta de instalação, baixa a última versão.
- Execuções seguintes: fica na bandeja do sistema, checa atualização
  periodicamente e, ao achar uma nova, fecha o Chrome, atualiza os
  arquivos e reabre o Chrome sozinho.
"""
import os
import sys
import threading
import time
from pathlib import Path

import gui
import installer
import tray
from chrome_control import close_chrome, open_extensions_page, reopen_chrome
from config import load_config, save_config
from github_api import find_dist_asset, get_latest_release
from notifier import notify
from updater import download_and_extract

CHECK_INTERVAL_SEC = 15 * 60  # 15 minutos


def do_first_run_setup(cfg: dict) -> dict:
    folder = gui.ask_install_folder()
    if not folder:
        notify("Orbita Updater", "Instalação cancelada. Execute novamente quando quiser configurar.")
        sys.exit(0)
    cfg["install_path"] = folder
    save_config(cfg)
    return cfg


def install_or_update(cfg: dict, silent: bool = False) -> bool:
    release = get_latest_release(cfg["repo"])
    if not release:
        if not silent:
            notify("Orbita Updater", "Nenhuma versão publicada ainda no repositório.")
        return False

    tag = release.get("tag_name")
    install_path = Path(cfg["install_path"])
    already_installed = install_path.exists() and any(install_path.iterdir())

    if cfg.get("installed_version") == tag and already_installed:
        return False  # já está na versão mais recente

    asset = find_dist_asset(release)
    if not asset:
        if not silent:
            notify("Orbita Updater", f"Release {tag} encontrada, mas sem arquivo .zip da extensão anexado.")
        return False

    is_first_install = not already_installed

    if not is_first_install:
        notify("Orbita — Atualização encontrada", f"Instalando versão {tag}... o Chrome vai fechar e reabrir.")
        close_chrome()

    download_and_extract(asset["browser_download_url"], install_path)

    cfg["installed_version"] = tag
    save_config(cfg)

    if is_first_install:
        os.startfile(install_path)
        open_extensions_page()
        notify(
            "Orbita instalada!",
            f"Versão {tag} pronta em:\n{install_path}\n\n"
            "No Chrome (chrome://extensions), ative o Modo do desenvolvedor e clique em "
            "'Carregar sem compactação' apontando para essa pasta.",
        )
    else:
        reopen_chrome()
        notify("Orbita atualizada!", f"Versão {tag} instalada. Chrome reaberto.")

    return True


def background_loop(cfg: dict) -> None:
    while True:
        time.sleep(CHECK_INTERVAL_SEC)
        try:
            install_or_update(load_config(), silent=True)
        except Exception as e:  # nunca deixa a thread morrer silenciosamente
            print(f"Erro ao checar atualização: {e}")


def main() -> None:
    # Rodando o .exe baixado: instala em %LOCALAPPDATA%, liga o início automático e abre a cópia instalada
    if installer.is_frozen() and not installer.running_from_install_dir():
        if installer.another_instance_running():
            notify(
                "Orbita Updater",
                "O Orbita Updater já está rodando (ícone perto do relógio). "
                "Para reinstalar, clique nele com o botão direito > Sair e abra este arquivo de novo.",
            )
            sys.exit(0)
        try:
            installer.install_self()
        except Exception as e:
            notify("Orbita Updater — erro", f"Não foi possível instalar: {e}")
            sys.exit(1)
        sys.exit(0)

    if not installer.acquire_single_instance():
        sys.exit(0)  # já tem um rodando na bandeja

    cfg = load_config()

    if not cfg.get("install_path"):
        cfg = do_first_run_setup(cfg)

    try:
        install_or_update(cfg)
    except Exception as e:
        notify("Orbita Updater — erro", f"Falha ao verificar/instalar: {e}")

    threading.Thread(target=background_loop, args=(cfg,), daemon=True).start()

    def on_check_now():
        try:
            updated = install_or_update(load_config())
            if not updated:
                notify("Orbita Updater", "Você já está na versão mais recente.")
        except Exception as e:
            notify("Orbita Updater — erro", str(e))

    def on_open_folder():
        path = load_config().get("install_path")
        if path and os.path.exists(path):
            os.startfile(path)

    def on_uninstall():
        installer.uninstall()
        notify(
            "Orbita Updater removido",
            "O atualizador não inicia mais com o Windows. A pasta da extensão foi mantida.",
        )

    # Ao fechar o ícone, icon.run() retorna e o processo termina (a thread de checagem é daemon)
    tray.run_tray(on_check_now, on_open_folder, on_uninstall)


if __name__ == "__main__":
    main()
