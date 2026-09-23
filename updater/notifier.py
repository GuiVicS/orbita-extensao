"""Notificação nativa do Windows (toast), com fallback pra messagebox se não estiver disponível."""


def notify(title: str, message: str) -> None:
    try:
        from win11toast import toast
        toast(title, message, duration="short")
        return
    except Exception:
        pass
    try:
        import tkinter as tk
        from tkinter import messagebox

        root = tk.Tk()
        root.withdraw()
        messagebox.showinfo(title, message)
        root.destroy()
    except Exception:
        print(f"[{title}] {message}")
