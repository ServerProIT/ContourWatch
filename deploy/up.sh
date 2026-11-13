#!/bin/sh
set -eu
deploy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$deploy_dir"
[ -f .env ] || { echo 'Сначала: cp .env.example .env, затем настройте PUBLIC_URL и адрес ВМ.' >&2; exit 1; }
docker compose version >/dev/null
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 120
docker compose ps
echo 'Проверьте внешний HTTPS-адрес через Nginx Proxy Manager. Ключ администратора:'
echo 'cd deploy && sudo docker compose exec server cat /data/admin.key'
