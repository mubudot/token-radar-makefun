#!/usr/bin/env bash
set -euo pipefail
task_repo=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
task_input=${1:-/input/snapshot.json}
task_tmp=$(mktemp -d /tmp/radar-determinism.XXXXXX)
trap 'rm -rf -- "$task_tmp"' EXIT
node "$task_repo/main.ts" --input "$task_input" --output "$task_tmp/first"
node "$task_repo/main.ts" --input "$task_input" --output "$task_tmp/second"
diff --recursive --brief -- "$task_tmp/first" "$task_tmp/second"
printf '%s\n' 'PASS: both output trees contain the same paths and byte-identical files.'
