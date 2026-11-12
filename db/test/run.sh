#!/usr/bin/env bash
# Builds a brand-new database from every migration, in order, checks every
# SQL query in the n8n workflows against it, runs every database test, then
# the seven customer journeys (db/test/journeys.py). Used by GitHub Actions on each pull request; you
# can run it yourself against any scratch Postgres that has pgvector:
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres db/test/run.sh
#
# It creates and drops a database called elliot_ci_<random>. It never touches
# Supabase: there is no Supabase address in this repository.
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="elliot_ci_$RANDOM$RANDOM"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
cleanup() { "${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${PSQL[@]}" -d postgres -c "create database $DB" >/dev/null
"${PSQL[@]}" -d "$DB" -f db/test/bootstrap.sql >/dev/null

echo "Migrations"
for m in db/migrations/0*.sql; do
  if ! out=$("${PSQL[@]}" -d "$DB" -f "$m" 2>&1); then
    echo "  FAIL $(basename "$m")"; echo "$out" | grep -E "ERROR|error" | head -5; exit 1
  fi
  echo "  ok   $(basename "$m")"
done

echo "Migration record"
files=$(ls db/migrations/0*.sql | wc -l)
"${PSQL[@]}" -d "$DB" -v files="$files" -f db/test/check_migration_record.sql >/dev/null
echo "  ok   every migration is in migration_status()"
# From 0049 on, each migration names itself and the one before it.
prev=""
for m in db/migrations/0*.sql; do
  v=$(basename "$m" | cut -c1-4)
  if [[ "$v" > "0048" ]]; then
    if ! grep -qE "select begin_migration\('$v', '[a-z0-9_]+', '$prev'\);" "$m"; then
      echo "  FAIL $(basename "$m") must start with: select begin_migration('$v', 'short_name', '$prev');"; exit 1
    fi
  fi
  prev=$v
done
echo "  ok   migrations from 0049 on call begin_migration"
# Running the newest migration again is refused, and changes nothing.
last=$(ls db/migrations/0*.sql | tail -1)
if "${PSQL[@]}" -d "$DB" -f "$last" >/dev/null 2>/tmp/rerun.$$; then
  echo "  FAIL running $(basename "$last") a second time was not refused"; exit 1
fi
grep -q "already in this database" /tmp/rerun.$$ || { echo "  FAIL unexpected error on re-run:"; cat /tmp/rerun.$$; exit 1; }
rm -f /tmp/rerun.$$
echo "  ok   running $(basename "$last") again is refused"

echo "Workflow queries"
python3 db/test/check_workflow_sql.py "$DB"

echo "Tests"
failed=0
for t in db/seed/test_0*.sql; do
  # Notices on: some tests announce their result as a NOTICE.
  if out=$(PGOPTIONS="" "${PSQL[@]}" -d "$DB" -f "$t" 2>&1) && echo "$out" | grep -qiE "checks passed"; then
    echo "  ok   $(basename "$t")"
  else
    echo "  FAIL $(basename "$t")"; echo "$out" | grep -E "ERROR|FAIL|error" | head -5; failed=1
  fi
done
[ $failed -eq 0 ] || exit 1

echo
python3 db/test/journeys.py "$DB"
