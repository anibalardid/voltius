#!/usr/bin/env bash
# Build RoMix for iOS and install + launch it on the connected PHYSICAL device
# (iPhone/iPad). This is the workaround for tauri-cli 2.11.x's broken export step
# (`tauri ios run` fails with "Couldn't load -exportOptionsPlist ... no such file",
# see tauri-apps/tauri#14593): this script asks tauri to only archive, then exports
# and installs the app itself.
#
#   scripts/ios-run-device.sh                    # auto-detect the physical iPhone/iPad
#   scripts/ios-run-device.sh "iPhone Anibal"    # target a specific device name
#
# Local only. Signs with the DEVELOPMENT_TEAM from src-tauri/gen/apple/project.yml.
# The device must be unlocked and trusted. USB is optional: Xcode wireless pairing
# is enough (devicectl "available").
#
# Rust is compiled by scripts/ios-xcode-build.sh inside the Xcode phase. That script
# does not talk to tauri's options server, so a hand-opened Archive works too.
set -euo pipefail
echo "==> RoMix device install starting"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

APP_ID="com.romix.app"
APPLE_DIR="$REPO/src-tauri/gen/apple"
BUILD_DIR="$APPLE_DIR/build"
EXPORT_DIR="$BUILD_DIR/device-export"
EXPORT_OPTIONS="$APPLE_DIR/ExportOptions.plist"
XCARCHIVE="$BUILD_DIR/romix_iOS.xcarchive"

DEVICE_NAME="${1:-}"

command -v xcrun >/dev/null || { echo "ERROR: xcrun not found — install Xcode." >&2; exit 1; }

# Fresh clones have no Xcode project: `src-tauri/gen/` is gitignored.
if [ ! -f "$APPLE_DIR/romix.xcodeproj/project.pbxproj" ]; then
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

# pipefail would abort here before the error below if xctrace prints nothing.
LINE="$(pick_device || true)"
if [ -z "$LINE" ]; then
  echo "ERROR: no physical iPhone/iPad detected. Connect or pair it with Xcode, then unlock it." >&2
  exit 1
fi
DEV_NAME="$(printf '%s' "$LINE" | sed -E 's/ \([^()]*\) \([^()]*\)$//')"   # "iPhone Anibal"
DEV_UDID="$(printf '%s' "$LINE" | sed -E 's/^.* \(([^()]*)\)$/\1/')"       # the last (…)

echo "==> Device: ${DEV_NAME} (${DEV_UDID})"
# xctrace lists paired phones that are asleep or off Wi-Fi. devicectl is what
# install actually uses. "unavailable" contains the substring "available".
DEV_STATE="$(xcrun devicectl list devices 2>/dev/null | grep -F "${DEV_UDID}" | head -1 || true)"
# "unavailable" contains the substring "available", so that case has to be first.
# A cable shows "connected". Wi-Fi pairing shows "available (paired)". Both can install.
case "${DEV_STATE}" in
  *unavailable*|"")
    echo "ERROR: ${DEV_NAME} is paired but not reachable." >&2
    echo "Unlock it and leave it on Wi-Fi, or plug in the cable." >&2
    echo "devicectl: ${DEV_STATE:-not listed}" >&2
    exit 1
    ;;
  *connected*|*available*) ;;
  *)
    echo "ERROR: ${DEV_NAME} is not reachable." >&2
    echo "devicectl: ${DEV_STATE}" >&2
    exit 1
    ;;
esac
echo "==> Device is reachable. Cable is optional."

# ── build + archive (skip tauri's broken export) ──────────────────────────────
# A leftover RoMix.app from a previous run aborts the archive with
# "Directory not empty (os error 66)", so clear the build dir first (it is a build
# artifact and gitignored) — same reason ios-emulator.sh clears it.
rm -rf "$BUILD_DIR"
echo "==> Building + archiving for ${DEV_NAME} (this compiles the frontend and Rust)…"
# Not --debug. A debug iOS build proxies the UI to http://localhost:1420 and
# dies with Tauri's "local network permissions" screen unless the Vite dev
# server is running. TestFlight is a release build with the UI embedded.
pnpm tauri ios build --target aarch64 --archive-only
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

echo "==> Launching (unlock the iPhone; a cable is not required)…"
if ! xcrun devicectl device process launch --terminate-existing --device "$DEV_UDID" "$APP_ID"; then
  echo "Installed, but launch failed. Unlock the iPhone and open RoMix from the home screen." >&2
  exit 1
fi

cat <<EOF

Running on ${DEV_NAME}.

  App logs:   xcrun devicectl device process launch --console --device ${DEV_UDID} ${APP_ID}
  Reload:     re-run this script; it rebuilds, reinstalls, and relaunches.

EOF
