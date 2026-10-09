#!/usr/bin/env bash
# Verify the iOS build end-to-end before claiming the device/simulator flow works.
#
#   scripts/ios-build-check.sh
#
# Runs, in order:
#   1. frontend build (tsc + vite)                 — catches TypeScript errors
#   2. device Rust build (aarch64-apple-ios)       — catches Rust errors for the device
#   3. full simulator bundle (frontend + Rust + .app) — the same build ios-emulator.sh runs
#
# The Xcode "open project" flow (option 10, `tauri ios build --open`) cannot be fully
# verified from a script: it needs a human to press Cmd+R inside Xcode while this CLI
# stays alive serving the options server. This script covers everything that CAN be
# checked headlessly.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "==> 1/3 frontend build (tsc + vite)"
pnpm build

echo "==> 2/3 device Rust build (aarch64-apple-ios)"
cargo build \
  --package voltius \
  --manifest-path src-tauri/Cargo.toml \
  --target aarch64-apple-ios \
  --features "tauri/custom-protocol tauri/custom-protocol" \
  --lib

echo "==> 3/3 full simulator bundle"
# Tauri renames the archived .app into build/arm64-sim/; a leftover Voltius.app from a
# previous run aborts with "Directory not empty (os error 66)". Clear it first, exactly
# like ios-emulator.sh does.
rm -rf src-tauri/gen/apple/build
pnpm tauri ios build --debug --target aarch64-sim --no-sign

echo ""
echo "OK: iOS build verified (frontend + device Rust + simulator .app)."
