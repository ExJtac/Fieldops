#!/bin/zsh
set -e
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22.13 or newer, then open this launcher again.'
  read '?Press Enter to close.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci
fi
echo 'CAS FieldOps: http://127.0.0.1:4328'
echo 'Keep this window open while using the application. Press Ctrl+C to stop.'
exec npm run dev
