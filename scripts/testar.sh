#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
npx vitest run
node --no-warnings --test tests/*.test.mjs
