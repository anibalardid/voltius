#!/usr/bin/env bash
# Build Voltius for iOS and install + launch it on the connected PHYSICAL device
# (iPhone/iPad). This is the workaround for tauri-cli 2.11.x's broken export step
# (`tauri ios run` fails with "Couldn't load -exportOptionsPlist ... no such file",
# see tauri-apps/tauri#14593): this script asks tauri to only archive, then exports
# and installs the app itself.
#
#   scripts/ios-run-device.sh                    # auto-detect the physical iPhone/iPad
#   scripts/ios-run-device.sh "iPhone Anibal"    # target a specific device name
#
# Local only. Signs with the DEVELOPMENT_TEAM from src-tauri/gen/apple/project.yml.
# The device must be reachable over USB or Xcode wireless pairing, unlocked, and trusted.
#
# Why not `--open` + manual Cmd+R: in tauri-cli 2.11.x the `--open` variants open
# Xcode but do NOT start the CLI options server, so the Rust build phase dies with
# "failed to build WebSocket client … Connection refused". This script instead drives
# the build itself, which keeps the CLI alive for its own build.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

APP_ID="com.voltius.app"
APPLE_DIR="$REPO/src-tauri/gen/apple"
BUILD_DIR="$APPLE_DIR/build"
EXPORT_DIR="$BUILD_DIR/device-export"
EXPORT_OPTIONS="$APPLE_DIR/ExportOptions.plist"
XCARCHIVE="$BUILD_DIR/voltius_iOS.xcarchive"

DEVICE_NAME="${1:-}"

command -v xcrun >/dev/null || { echo "ERROR: xcrun not found — install Xcode." >&2; exit 1; }

# Fresh clones have no Xcode project: `src-tauri/gen/` is gitignored.
if [ ! -f "$APPLE_DIR/voltius.xcodeproj/project.pbxproj" ]; then
  echo "==> No src-tauri/gen/apple — generating the iOS project…"
  pnpm tauri ios init
fi

# ── pick a physical device ────────────────────────────────────────────────────
# `xctrace list devices` emits one line per device/simulator, physical iOS devices
# look like `iPhone Anibal (27.0) (UDID)` with no "Simulator" marker. With no
# explicit name, prefer an iPhone: xctrace can list an unavailable iPad first.
pick_device() {
  xcrun xctrace list devices 2>/dev/null \
    | { if [ -n "$DEVICE_NAME" ]; then grep -i -E 'iphone|ipad' | grep -i -F "$DEVICE_NAME" || true; else grep -i 'iphone'; fi; } \
    | grep -v -i -E 'simulator|My Mac' \
    | head -1
}

LINE="$(pick_device)"
if [ -z "$LINE" ]; then
  echo "ERROR: no physical iPhone/iPad detected. Connect or pair it with Xcode, then unlock it." >&2
  exit 1
fi
DEV_NAME="$(printf '%s' "$LINE" | sed -E 's/ \([^()]*\) \([^()]*\)$//')"   # "iPhone Anibal"
DEV_UDID="$(printf '%s' "$LINE" | sed -E 's/^.* \(([^()]*)\)$/\1/')"       # the last (…)

echo "==> Device: ${DEV_NAME} (${DEV_UDID})"

# ── build + archive (skip tauri's broken export) ──────────────────────────────
# A leftover Voltius.app from a previous run aborts the archive with
# "Directory not empty (os error 66)", so clear the build dir first (it is a build
# artifact and gitignored) — same reason ios-emulator.sh clears it.
rm -rf "$BUILD_DIR"
echo "==> Building + archiving for ${DEV_NAME} (this compiles the frontend and Rust)…"
pnpm tauri ios build --debug --target aarch64 --archive-only
[ -d "$XCARCHIVE" ] || { echo "ERROR: no archive at $XCARCHIVE" >&2; exit 1; }

# ── export (stable ExportOptions.plist — avoids tauri#14593's deleted temp file) ──
if [ ! -f "$EXPORT_OPTIONS" ]; then
  echo "ERROR: $EXPORT_OPTIONS not found — is the project generated?" >&2
  exit 1
fi
echo "==> Exporting archive…"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$XCARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS"

IPA="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' | head -1)"
[ -f "$IPA" ] || { echo "ERROR: no .ipa exported in $EXPORT_DIR" >&2; exit 1; }

# ── install + launch on the device ────────────────────────────────────────────
echo "==> Installing ${IPA} on ${DEV_NAME}…"
xcrun devicectl device install app --device "$DEV_UDID" "$IPA"

echo "==> Launching…"
xcrun devicectl device process launch --device "$DEV_UDID" "$APP_ID"

cat <<EOF

Running on ${DEV_NAME}.

  App logs:   xcrun devicectl device process launch --console --device ${DEV_UDID} ${APP_ID}
  Reload:     re-run this script; it rebuilds, reinstalls, and relaunches.

EOF
