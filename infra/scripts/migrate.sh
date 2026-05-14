#!/usr/bin/env bash
set -euo pipefail

DSN="${POSTGRES_DSN:-postgresql://postgres:postgres@localhost:5432/patristic}"
MIGRATIONS_DIR="$(dirname "$0")/../migrations"

echo "Applying migrations to $DSN..."
for f in "$MIGRATIONS_DIR"/*.sql; do
    echo "  -> $(basename "$f")"
    psql "$DSN" -v ON_ERROR_STOP=1 -f "$f"
done
echo "Done."
