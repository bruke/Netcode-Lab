#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

finish() {
  local exit_code="$1"
  echo
  echo "The server has stopped. Review the output above."
  if [[ -t 0 ]]; then
    read -r -p "Press Enter to close..." </dev/tty
  fi
  exit "$exit_code"
}

fail() {
  echo "[ERROR] $1"
  finish 1
}

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js was not found on PATH. Install Node.js 18+ first, then run this script again."
fi

if ! command -v npm >/dev/null 2>&1; then
  fail "npm was not found on PATH. Install Node.js 18+ first, then run this script again."
fi

if [[ ! -f package.json ]]; then
  fail "package.json was not found in $SCRIPT_DIR."
fi

if [[ ! -d node_modules ]]; then
  echo "Dependencies not found. Installing them now..."
  echo
  npm ci --no-fund --no-audit || fail "Failed to install dependencies. Run \"npm ci\" manually to see the full error."
  echo
fi

echo "Starting Netcode Lab..."
echo "Open http://localhost:3000/ after the server is ready."
echo "Press Ctrl+C once to stop the server."
echo "After the server exits, this window will stay open."
echo

node server/src/index.js
finish "$?"
