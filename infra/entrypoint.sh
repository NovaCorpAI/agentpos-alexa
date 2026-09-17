#!/bin/sh
# Maps App Runner's PORT to each service's own variable and starts the one named by SERVICE.
set -eu
mkdir -p "${DATA_DIR:-/tmp/agentpos-data}"
case "${SERVICE:-bridge}" in
  bridge)
    export BRIDGE_DB_PATH="${BRIDGE_DB_PATH:-${DATA_DIR:-/tmp/agentpos-data}/bridge.sqlite}"
    exec node_modules/.bin/tsx packages/bridge/src/main.ts ;;
  simulator)
    export SIMULATOR_PORT="$PORT"
    export SIMULATOR_DATA_DIR="${SIMULATOR_DATA_DIR:-${DATA_DIR:-/tmp/agentpos-data}}"
    exec node_modules/.bin/tsx apps/simulator/src/server/main.ts ;;
  fixture-store)
    export FIXTURE_STORE_PORT="$PORT"
    exec node_modules/.bin/tsx packages/fixture-store/src/main.ts ;;
  *)
    echo "unknown SERVICE=${SERVICE}; use bridge, simulator or fixture-store" >&2
    exit 64 ;;
esac
