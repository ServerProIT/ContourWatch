#!/usr/bin/env python3
"""Optional graphical-session companion. Requires PySide6; service does not."""
import json
from pathlib import Path
import sys
from PySide6.QtCore import QTimer, QUrl
from PySide6.QtGui import QIcon, QDesktopServices
from PySide6.QtWidgets import QApplication, QSystemTrayIcon, QMenu, QMessageBox

app = QApplication(sys.argv)
app.setQuitOnLastWindowClosed(False)
if not QSystemTrayIcon.isSystemTrayAvailable():
    QMessageBox.information(None, 'Контур', 'В этом рабочем окружении недоступен системный трей. Служба продолжает работать независимо.')
    sys.exit(0)
icon = QSystemTrayIcon(QIcon(str(Path(__file__).with_name('agent.svg'))))
menu = QMenu()
status_path = Path('/var/lib/contourwatch/public/status.json')

def status():
    try:
        return json.loads(status_path.read_text())
    except (OSError, ValueError):
        return {'state': 'Состояние недоступно. Проверьте службу contourwatch.'}

def show():
    QMessageBox.information(None, 'Контур · состояние агента', json.dumps(status(), ensure_ascii=False, indent=2))

def panel():
    url = QUrl(status().get('server') or '')
    if url.isValid() and url.scheme() == 'https':
        QDesktopServices.openUrl(url)
    else:
        QMessageBox.information(None, 'Контур', 'Адрес панели пока недоступен. Настройте службу через agent.py --configure.')

menu.addAction('Состояние агента', show)
menu.addAction('Открыть панель', panel)
menu.addSeparator()
menu.addAction('Закрыть значок в трее', app.quit)
icon.setContextMenu(menu)
icon.activated.connect(lambda reason: show() if reason == QSystemTrayIcon.DoubleClick else None)
timer = QTimer()
timer.timeout.connect(lambda: icon.setToolTip('Контур · '+status().get('state', 'Нет данных')))
timer.start(10000)
icon.setToolTip('Контур · агент')
icon.show()
app.exec()
