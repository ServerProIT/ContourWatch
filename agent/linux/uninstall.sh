#!/bin/sh
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Нужны права root' >&2; exit 1; }
systemctl disable --now contourwatch.service
rm -f -- /etc/systemd/system/contourwatch.service /etc/xdg/autostart/contourwatch-tray.desktop
systemctl daemon-reload
echo 'Служба удалена. /opt/contourwatch и /var/lib/contourwatch сохранены для восстановления.'
