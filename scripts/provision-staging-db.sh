#!/usr/bin/env bash
# scripts/provision-staging-db.sh
# Run once after DATABASE_URL is available.
# Usage: DATABASE_URL=postgresql://... ./scripts/provision-staging-db.sh

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is not set. Export it and retry."
  exit 1
fi

echo "🗄️  Provisioning Sponsee staging database..."
echo "   URL: ${DATABASE_URL%%@*}@***"

cd "$(dirname "$0")/.."

# Ensure packages are built
echo ""
echo "📦 Building workspace..."
pnpm install --frozen-lockfile
pnpm run -r build

# Run Drizzle migrations
echo ""
echo "🛫 Running migrations..."
cd packages/db
npx drizzle-kit migrate

# Seed demo data
echo ""
echo "🌱 Seeding demo data..."
DATABASE_URL="$DATABASE_URL" npx tsx src/seed.ts

echo ""
echo "✅ Staging database ready."
