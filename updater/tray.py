"""Ícone na bandeja do sistema (system tray) com menu de ações."""
import pystray
from PIL import Image, ImageDraw


def make_icon_image() -> Image.Image:
    img = Image.new("RGB", (64, 64), color=(20, 20, 30))
    d = ImageDraw.Draw(img)
    d.ellipse((8, 8, 56, 56), outline=(100, 180, 255), width=4)
    d.ellipse((24, 24, 40, 40), fill=(100, 180, 255))
    return img


def run_tray(on_check_now, on_open_folder, on_uninstall):
    def _quit(icon, _item=None):
        icon.stop()

    def _uninstall(icon, _item=None):
        icon.stop()
        on_uninstall()

    menu = pystray.Menu(
        pystray.MenuItem("Verificar atualização agora", lambda icon, item: on_check_now()),
        pystray.MenuItem("Abrir pasta da extensão", lambda icon, item: on_open_folder()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Sair", _quit),
        pystray.MenuItem("Desinstalar atualizador", _uninstall),
    )
    icon = pystray.Icon("orbita_updater", make_icon_image(), "Orbita Updater", menu)
    icon.run()
