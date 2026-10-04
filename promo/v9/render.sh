#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p output evidence
if [[ -x ../node_modules/.bin/hyperframes ]]; then
  hf=../node_modules/.bin/hyperframes
else
  hf=./node_modules/.bin/hyperframes
fi
PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS=600 HF_CAPTURE_PARALLEL_STREAM=true \
  "$hf" render . --fps 120 --quality high --low-memory-mode --workers 4 \
  --output "$PWD/output/Mochi_V9_2K120_4m46s.mp4"
