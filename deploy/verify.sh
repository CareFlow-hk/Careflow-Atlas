#!/usr/bin/env bash
# Creates and destroys only an isolated test Compose project, including its test volume.
set -euo pipefail
cd "$(dirname "$0")/.."
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/atlas-accounts-XXXXXXXX")"
RUN_ID="$(basename "$RUN_DIR" | tr '[:upper:]' '[:lower:]')"
export APP_ORIGIN="http://127.0.0.1:${VERIFY_PORT:-18082}"
export WEB_PORT="${VERIFY_PORT:-18082}" ALLOW_INSECURE_LOCALHOST=true
export ATLAS_WEB_IMAGE="${RUN_ID}-web" ATLAS_AUTH_IMAGE="${RUN_ID}-auth"
compose() { docker compose -p "$RUN_ID" "$@"; }
cleanup() {
  compose down --volumes >/dev/null 2>&1 || true
  docker image rm "$ATLAS_WEB_IMAGE" "$ATLAS_AUTH_IMAGE" >/dev/null 2>&1 || true
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT
compose up -d --build --wait --wait-timeout 90
compose exec -T web nginx -t
curl -fsS "$APP_ORIGIN/api/health"
test "$(curl -s -o /dev/null -w '%{http_code}' "$APP_ORIGIN/api/admin/users")" = 401
printf '\nPASS health and unauthenticated rejection\n'
compose exec -T auth node server/manage.mjs bootstrap atlas-test@example.test 'Test Admin' > "$RUN_DIR/setup.txt"
chmod 600 "$RUN_DIR/setup.txt"
if compose exec -T auth node server/manage.mjs bootstrap duplicate@example.test 'Duplicate' >/dev/null 2>&1; then
  echo 'FAIL repeated bootstrap accepted'; exit 1
fi
compose restart auth
compose up -d --wait --wait-timeout 90
printf 'PASS restart and duplicate bootstrap protection\n'
if [ "${VERIFY_BROWSER:-0}" = 1 ]; then
  node deploy/verify-accounts-browser.mjs "$APP_ORIGIN" "$RUN_DIR/setup.txt"
  AUTH_TEST_EMAIL=atlas-test@example.test AUTH_TEST_PASSWORD='Atlas browser test passphrase 2026!' node deploy/verify-browser.mjs "$APP_ORIGIN"
else
  echo 'MANUAL browser account flows not run; set VERIFY_BROWSER=1 with Playwright installed'
fi
compose exec -T auth node server/backup.mjs /app/data/verification-backup.sqlite
compose exec -T auth node --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const d=new DatabaseSync("/app/data/verification-backup.sqlite"); if(d.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")process.exit(1); console.log("PASS consistent account backup"); d.close();'
printf 'PASS isolated account stack verification\n'
