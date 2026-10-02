#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node build.mjs
../node_modules/.bin/hyperframes check .
mkdir -p output
PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS=600 HF_CAPTURE_PARALLEL_STREAM=true \
  ../node_modules/.bin/hyperframes render . --fps 120 --quality high --low-memory-mode --workers 4 \
  --output "$PWD/output/Mochi_V10_原组件动效样片_30s_2K120.mp4"
