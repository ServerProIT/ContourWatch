#!/bin/sh
# Online SQLite backup plus access keys/config. No service stop is required.
set -eu
umask 077
deploy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$deploy_dir"
[ -f .env ] || { echo 'Нет deploy/.env' >&2; exit 1; }
docker compose config --quiet
destination=${1:-"$deploy_dir/backups"}
mkdir -p -- "$destination"
destination=$(CDPATH= cd -- "$destination" && pwd)
stage=$(mktemp -d "$destination/.incomplete-XXXXXX")
name="contour-$(date -u +%Y%m%dT%H%M%SZ)-$$.sqlite"
docker compose exec -T server node server/backup.mjs --output "/data/backups/$name"
docker compose cp "server:/data/backups/$name" "$stage/contour.db"
docker compose cp server:/data/admin.key "$stage/admin.key"
docker compose cp server:/data/viewer.key "$stage/viewer.key"
cp .env "$stage/deploy.env"
chmod 600 "$stage/contour.db" "$stage/admin.key" "$stage/viewer.key" "$stage/deploy.env"
(cd "$stage" && sha256sum contour.db admin.key viewer.key deploy.env > SHA256SUMS)
final="$destination/contour-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mv -- "$stage" "$final"
# Remove only the uniquely named temporary DB after its verified host copy exists.
docker compose exec -T server node -e 'require("node:fs").unlinkSync(process.argv[1])' "/data/backups/$name"
echo "Резервная копия: $final"
echo 'Каталог содержит секреты. Храните вне ВМ в защищённом месте.'
