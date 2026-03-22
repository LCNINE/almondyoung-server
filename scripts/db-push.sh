#!/bin/bash
set -euo pipefail

# Usage: ./scripts/db-push.sh <env-file> <drizzle-config>
# Example: ./scripts/db-push.sh apps/wms/.env apps/wms/database/drizzle/drizzle.config.ts

ENV_FILE="$1"
CONFIG="$2"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: env file not found: $ENV_FILE"
  exit 1
fi

# Extract DATABASE_URL from .env file
DB_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"')

if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL not found in $ENV_FILE"
  exit 1
fi

export DATABASE_URL="$DB_URL"

# 1. Run drizzle-kit push
./scripts/with-ipv4.sh drizzle-kit push --config "$CONFIG"

# 2. Run auth schema migration (uses DATABASE_URL from env)
echo ""
echo "Running auth schema migration..."
./scripts/with-ipv4.sh ts-node -r tsconfig-paths/register libs/authorization/scripts/migrate-auth-schema.ts "$DB_URL"
