#!/usr/bin/env bash
#
# Runs the SQL rule suite against a Postgres database.
#
#   ./supabase/tests/run.sh                        # uses $DATABASE_URL
#   DATABASE_URL=postgres://... ./supabase/tests/run.sh
#
# What it does, in order:
#   1. loads the test harness (a minimal `auth` schema + assertion helpers),
#   2. applies every migration in order,
#   3. applies seed.sql, because every rule function reads game_config and
#      raises on a missing key,
#   4. runs each test file inside a transaction that is rolled back, so the
#      suite is repeatable and leaves nothing behind.
#
# ⚠️ NEVER point this at production. Step 1 replaces auth.uid().

set -euo pipefail

DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ON_ERROR_STOP is what turns a failed assertion into a failed build. Without
# it psql prints the error and exits 0, and CI goes green on a broken rule.
PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 --quiet --no-psqlrc)

if [[ "$DB_URL" == *"supabase.co"* ]]; then
  echo "REFUSING: \$DATABASE_URL points at a hosted Supabase project." >&2
  echo "This suite replaces auth.uid(). Run it against a disposable database." >&2
  exit 1
fi

echo "==> Loading the test harness"
"${PSQL[@]}" -f "$ROOT/supabase/tests/helpers/00_harness.sql"

echo "==> Applying migrations"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$migration")"
  "${PSQL[@]}" -f "$migration"
done

echo "==> Seeding game_config"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"

# After the migrations, because the grants target tables the migrations create.
echo "==> Granting the client roles (so RLS is what blocks, not a missing grant)"
"${PSQL[@]}" -f "$ROOT/supabase/tests/helpers/99_grants.sql"

failed=0
for suite in "$ROOT"/supabase/tests/[0-9]*.sql; do
  name="$(basename "$suite")"
  echo ""
  echo "==> $name"
  if "${PSQL[@]}" -f "$suite"; then
    echo "    PASS $name"
  else
    echo "    FAIL $name" >&2
    failed=1
  fi
done

echo ""
if [[ $failed -eq 0 ]]; then
  echo "All SQL rule suites passed."
else
  echo "SQL rule suites FAILED." >&2
fi
exit $failed
