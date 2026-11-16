#!/bin/sh
# Online SQLite backup plus initial credentials/config. No service stop is required.
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
for file in initial-admin.txt admin.key viewer.key; do
  if docker compose exec -T server node -e 'process.exit(require("node:fs").existsSync("/data/"+process.argv[1])?0:1)' "$file"; then
    docker compose cp "server:/data/$file" "$stage/$file"
  fi
done
cp .env "$stage/deploy.env"
chmod 600 "$stage/"*
(cd "$stage" && sha256sum ./* > SHA256SUMS)
final="$destination/contour-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mv -- "$stage" "$final"
# Remove only the uniquely named temporary DB after its verified host copy exists.
docker compose exec -T server node -e 'require("node:fs").unlinkSync(process.argv[1])' "/data/backups/$name"
echo "Резервная копия: $final"
echo 'Каталог содержит секреты. Храните вне ВМ в защищённом месте.'
