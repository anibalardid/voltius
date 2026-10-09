#!/usr/bin/env bash
# Builds the Android release APK/AAB natively, using the external-volume SDK
# (see android-env.sh). The Docker-based debug build lives in android-build.sh.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# shellcheck disable=SC1091
source "$REPO/scripts/android-env.sh"

echo "==> Building Android release (APK/AAB)..."
pnpm tauri android build
