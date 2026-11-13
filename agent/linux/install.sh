#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then echo 'Запустите от root: sudo sh install.sh' >&2; exit 1; fi
python3 -c 'import sys; assert sys.version_info >= (3,9), "Требуется Python 3.9+"'
command -v systemctl >/dev/null || { echo 'Требуется systemd' >&2; exit 1; }
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
systemctl stop contourwatch.service 2>/dev/null || true
install -d -m 755 /opt/contourwatch
install -d -m 711 /var/lib/contourwatch
install -d -m 700 /var/lib/contourwatch/queue
install -d -m 755 /var/lib/contourwatch/public
install -m 644 "$source_dir/agent.py" "$source_dir/tray.py" "$source_dir/agent.svg" /opt/contourwatch/
install -m 644 "$source_dir/contourwatch.service" /etc/systemd/system/contourwatch.service
systemctl daemon-reload
systemctl enable contourwatch.service
echo 'Файлы установлены. Служба пока остановлена. Настройте её:'
echo 'python3 /opt/contourwatch/agent.py --configure --server=https://monitor.company.local --token-file=/root/enrollment.txt'
echo 'systemctl start contourwatch'
echo 'Системный трей: см. docs/LINUX.md (необязательный отдельный компонент).'
