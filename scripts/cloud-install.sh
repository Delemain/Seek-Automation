#!/usr/bin/env bash
set -euo pipefail
cd /workspace/Seek-Automation
export npm_config_cache=/workspace/.cache/npm
npm ci
node -e "require('node:fs').accessSync('/usr/bin/chromium', require('node:fs').constants.X_OK)"
npm run typecheck
