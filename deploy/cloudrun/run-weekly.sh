#!/usr/bin/env bash
set -euo pipefail

DATA_CWD="${GOOSE_AEO_DATA_CWD:-/var/lib/goose-aeo}"
CONFIG_PATH="${GOOSE_AEO_CONFIG_PATH:-$DATA_CWD/.goose-aeo.yml}"
QUERY_LIMIT="${GOOSE_AEO_QUERY_LIMIT:-25}"
RUN_CONCURRENCY="${GOOSE_AEO_RUN_CONCURRENCY:-1}"
BUDGET_LIMIT_USD="${GOOSE_AEO_BUDGET_LIMIT_USD:-20}"
AUDIT_PAGES="${GOOSE_AEO_AUDIT_PAGES:-25}"

mkdir -p "${DATA_CWD}"
cd "${DATA_CWD}"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "Missing config at ${CONFIG_PATH}. Initialize Goose AEO first."
  exit 1
fi

echo "Running weekly Goose AEO pipeline..."
echo "Working directory: $(pwd)"
echo "Config path: ${CONFIG_PATH}"

status_output="$(goose-aeo status --config "${CONFIG_PATH}")"
printf '%s\n' "${status_output}"

company_line="$(printf '%s\n' "${status_output}" | grep '^Company:' || true)"
db_line="$(printf '%s\n' "${status_output}" | grep '^DB:' || true)"

if [[ -z "${company_line}" || "${company_line}" == 'Company: ' ]]; then
  echo "Status preflight failed: company is missing."
  exit 1
fi

if [[ -z "${db_line}" ]]; then
  echo "Status preflight failed: DB path was not reported."
  exit 1
fi

db_path="${db_line#DB: }"
db_path="${db_path%% (*}"

case "${db_path}" in
  "${DATA_CWD}"/*) ;;
  *)
    echo "Status preflight failed: DB path ${db_path} is not under ${DATA_CWD}."
    exit 1
    ;;
esac

goose-aeo queries generate --limit "${QUERY_LIMIT}" --config "${CONFIG_PATH}"
goose-aeo run --confirm --concurrency "${RUN_CONCURRENCY}" --budget-limit "${BUDGET_LIMIT_USD}" --config "${CONFIG_PATH}"
goose-aeo analyze --config "${CONFIG_PATH}"
goose-aeo audit --pages "${AUDIT_PAGES}" --json --config "${CONFIG_PATH}"
goose-aeo report --format markdown --config "${CONFIG_PATH}"

echo "Weekly pipeline completed."
