#!/usr/bin/env python3
"""Optional graphical-session companion. Requires PySide6; service does not."""
import json
from pathlib import Path
import sys
from PySide6.QtCore import QTimer, QUrl, QSettings
from PySide6.QtGui import QIcon, QDesktopServices
from PySide6.QtWidgets import QApplication, QSystemTrayIcon, QMenu, QMessageBox

app = QApplication(sys.argv)
app.setQuitOnLastWindowClosed(False)
preferences = QSettings('ContourWatch', 'Tray')
def theme(choice=None):
    if choice is not None:
        preferences.setValue('theme', choice)
    choice = preferences.value('theme', 'system')
    app.setStyleSheet('' if choice == 'system' else
        'QWidget{background:#172124;color:#e7efec} QMenu::item:selected,QPushButton{background:#294339;color:#e7efec} QPushButton{padding:8px;border:1px solid #496058;border-radius:5px}' if choice == 'dark' else
        'QWidget{background:#f6f9f7;color:#1b3029} QMenu::item:selected,QPushButton{background:#deeee6;color:#1b3029} QPushButton{padding:8px;border:1px solid #bfd0c4;border-radius:5px}')
theme()
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
    data = status()
    QMessageBox.information(None, 'Контур · состояние агента', '\n'.join([
        'Состояние: '+str(data.get('state', 'Недоступно')),
        'Версия: '+str(data.get('version', '—')),
        'Пакетов в очереди: '+str(data.get('queue', '—')),
        'Обновлено: '+str(data.get('updated', '—'))]))

def panel():
    url = QUrl(status().get('server') or '')
    if url.isValid() and url.scheme() == 'https':
        QDesktopServices.openUrl(url)
    else:
        QMessageBox.information(None, 'Контур', 'Адрес панели пока недоступен. Настройте службу через agent.py --configure.')

menu.addAction('Состояние агента', show)
menu.addAction('Открыть панель', panel)
themes = menu.addMenu('Тема')
for key, text in [('system', 'Системная'), ('light', 'Светлая'), ('dark', 'Тёмная')]:
    themes.addAction(text, lambda checked=False, choice=key: theme(choice))
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
