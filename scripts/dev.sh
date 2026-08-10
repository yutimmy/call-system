#!/usr/bin/env sh
set -eu

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

. .venv/bin/activate

if [ ! -d "node_modules" ]; then
  npm install
fi

npm run dev
