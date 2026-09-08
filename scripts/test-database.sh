#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
container_name="teachnotes-test-db-$$"
image="supabase/postgres:17.6.1.136"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --name "$container_name" --user postgres --entrypoint sh --network none --tmpfs /tmp -d "$image" -c \
  'initdb -D /tmp/reviewdb -A trust >/tmp/initdb.log && exec postgres -D /tmp/reviewdb -c listen_addresses= -c unix_socket_directories=/tmp' >/dev/null

attempt=0
until docker exec "$container_name" pg_isready -h /tmp -U postgres >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    docker logs "$container_name"
    exit 1
  fi
  sleep 1
done

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -h /tmp -U postgres < "$repo_dir/tests/database/bootstrap.sql"
for migration in "$repo_dir"/supabase/migrations/*.sql; do
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -h /tmp -U postgres < "$migration"
done
for test_file in "$repo_dir"/tests/database/*.sql; do
  [ "$(basename "$test_file")" = "bootstrap.sql" ] && continue
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -h /tmp -U postgres < "$test_file"
done
