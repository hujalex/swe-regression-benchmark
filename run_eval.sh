#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

MODEL="${MODEL:-gpt-5.5}"
NUM_EXAMPLES="${NUM_EXAMPLES:-5}"
ROLLOUTS="${ROLLOUTS:-1}"
CONCURRENCY="${CONCURRENCY:-1}"
API_BASE="${API_BASE:-https://api.openai.com/v1}"
API_KEY_VAR="${API_KEY_VAR:-OPENAI_API_KEY}"

if [ -f .env ]; then
    OPENAI_API_KEY="$(grep '^OPENAI_API_KEY' .env | sed 's/.*= *//' | tr -d '"'\''')"
    export OPENAI_API_KEY
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
    echo "error: OPENAI_API_KEY not set (looked in .env and environment)" >&2
    exit 1
fi

if ! docker ps --filter name=dev-container --format '{{.Names}}' | grep -q '^dev-container$'; then
    echo "==> starting dev-container"
    docker compose up -d
    docker exec dev-container bash -c "cd /workspace && npm ci && npx prisma migrate deploy"
fi

if ! ./venv/bin/python -c "import code_agent" >/dev/null 2>&1; then
    echo "==> installing environments/code_agent"
    ./venv/bin/pip install -e environments/code_agent >/dev/null
fi

echo "==> running vf-eval (model=$MODEL n=$NUM_EXAMPLES r=$ROLLOUTS c=$CONCURRENCY)"
exec ./venv/bin/vf-eval code_agent \
    -p environments \
    -m "$MODEL" \
    -k "$API_KEY_VAR" \
    -b "$API_BASE" \
    -n "$NUM_EXAMPLES" \
    -r "$ROLLOUTS" \
    -c "$CONCURRENCY" \
    "$@"
