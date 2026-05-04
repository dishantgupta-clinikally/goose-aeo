#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"

ensure_secret() {
  local secret_name="$1"
  local secret_value="$2"

  if [[ -z "${secret_value}" ]]; then
    echo "Skipping ${secret_name} (empty value)."
    return
  fi

  gcloud secrets create "${secret_name}" --replication-policy=automatic --project "${PROJECT_ID}" 2>/dev/null || true
  printf "%s" "${secret_value}" | gcloud secrets versions add "${secret_name}" --data-file=- --project "${PROJECT_ID}"
}

ensure_secret "GOOSE_AEO_OPENAI_API_KEY" "${GOOSE_AEO_OPENAI_API_KEY:-}"
ensure_secret "GOOSE_AEO_PERPLEXITY_API_KEY" "${GOOSE_AEO_PERPLEXITY_API_KEY:-}"
ensure_secret "GOOSE_AEO_CLAUDE_API_KEY" "${GOOSE_AEO_CLAUDE_API_KEY:-}"
ensure_secret "GOOSE_AEO_GEMINI_API_KEY" "${GOOSE_AEO_GEMINI_API_KEY:-}"
ensure_secret "GOOSE_AEO_GROK_API_KEY" "${GOOSE_AEO_GROK_API_KEY:-}"
ensure_secret "GOOSE_AEO_DASHBOARD_ALLOWED_EMAIL_DOMAIN" "${GOOSE_AEO_DASHBOARD_ALLOWED_EMAIL_DOMAIN:-}"
ensure_secret "GOOSE_AEO_DASHBOARD_GOOGLE_CLIENT_ID" "${GOOSE_AEO_DASHBOARD_GOOGLE_CLIENT_ID:-}"
ensure_secret "GOOSE_AEO_DASHBOARD_GOOGLE_CLIENT_SECRET" "${GOOSE_AEO_DASHBOARD_GOOGLE_CLIENT_SECRET:-}"
ensure_secret "GOOSE_AEO_DASHBOARD_SESSION_SECRET" "${GOOSE_AEO_DASHBOARD_SESSION_SECRET:-}"
ensure_secret "GOOSE_AEO_DASHBOARD_BASE_URL" "${GOOSE_AEO_DASHBOARD_BASE_URL:-}"

echo "Secrets setup complete."
