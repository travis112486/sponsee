#!/bin/sh
# Run API and web tests sequentially with correct environments.
# API tests use node env and must run sequentially because PGlite WASM
# cannot handle concurrent initialisation across test files.
# Web tests use jsdom env for React component testing.

set -e

echo "Running API tests..."
npx vitest run apps/api/src --config=scripts/vitest-api.config.ts

echo "Running web tests..."
npx vitest run apps/web/src --config=scripts/vitest-web.config.ts

echo "All tests passed."
