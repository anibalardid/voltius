#!/usr/bin/env bash
# Build Voltius for iOS and run it on an iPhone or iPad simulator.
#
#   scripts/ios-emulator.sh                      # iPhone 17 Pro
#   scripts/ios-emulator.sh "iPad Pro 11-inch (M5)"
#   scripts/ios-emulator.sh --no-build          # just reinstall + relaunch
#   scripts/ios-emulator.sh --list
#   VOLTIUS_IOS_SIM_UDID=... scripts/ios-emulator.sh
#
# Local only: no signing, no CI, no upload. Simulator builds skip signing
# entirely (`--no-sign`), so this needs no Apple account. `DEVELOPMENT_TEAM` in
# src-tauri/gen/apple/project.yml is only consulted for device builds.
#
# Why one script and not ios-iphone.sh + ios-ipad.sh: they are the same
# operation with a different device name. Two copies is how you end up with the
# iPad path quietly not inheriting a fix to the iPhone one.
#
# The Rust half of the build is NOT reachable by calling xcodebuild directly:
# `tauri ios xcode-script` dials back into the parent `tauri` process over a
# WebSocket, so a standalone xcodebuild dies with "Connection refused". This
# script therefore always goes through `tauri ios build`.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

APP_ID="com.voltius.app"
APP_BUNDLE="$REPO/src-tauri/gen/apple/build/arm64-sim/Voltius.app"
GEN_DIR="$REPO/src-tauri/gen/apple"
STATE_DIR="$REPO/target"

DEVICE_NAME=""
FORCE_UDID="${VOLTIUS_IOS_SIM_UDID:-}"
DO_BUILD=1

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# `simctl list devices --json` keys its device map by runtime identifier and the
# device objects themselves carry no runtime field, so read the key:
# com.apple.CoreSimulator.SimRuntime.iOS-26-5 -> 26.5. One helper emits the whole
# table; every lookup below filters it, so the JSON shape is parsed in one place.
# Defined before the arg loop because --list needs it.
device_table() {
  xcrun simctl list devices --json | python3 -c '
import json, re, sys
for runtime, devices in json.load(sys.stdin)["devices"].items():
    m = re.search(r"iOS-([0-9-]+)$", runtime)
    ver = m.group(1).replace("-", ".") if m else runtime
    for d in devices:
        if not d.get("isAvailable"):
            continue
        print("%s|%s|%s|%s" % (d["udid"], d["name"], d["state"], ver))'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) DO_BUILD=0 ;;
    --list)
      echo "Available iOS simulators (name  |  udid  |  state  |  runtime):"
      device_table | awk -F'|' '{ printf "  %-26s %s  %-9s iOS %s\n", $2, $1, $3, $4 }'
      exit 0
      ;;
    -h|--help) usage 0 ;;
    -*) echo "ERROR: unknown option $1" >&2; usage 1 ;;
    *)  DEVICE_NAME="$1" ;;
  esac
  shift
done
DEVICE_NAME="${DEVICE_NAME:-iPhone 17 Pro}"

command -v xcrun >/dev/null || { echo "ERROR: xcrun not found — install Xcode." >&2; exit 1; }

# `src-tauri/gen/` is gitignored, so a fresh clone has no Xcode project at all.
if [ ! -d "$GEN_DIR" ]; then
  echo "==> No src-tauri/gen/apple — generating the iOS project…"
  pnpm tauri ios init
fi

# ── pick a simulator ────────────────────────────────────────────────────────
# Order: explicit --udid > pinned UDID from a previous run > unique name match.
# A pin is honoured rather than silently replaced: booting a different device
# means a different data container, and a half-migrated vault is worse than an
# error message.
device_field() { # udid -> "name|state|runtime"
  device_table | awk -F'|' -v u="$1" '$1 == u { print $2 "|" $3 "|" $4 }'
}

resolve_by_name() {
  device_table | awk -F'|' -v want="$1" '
    tolower($2) == tolower(want) {
      # Prefer an already-booted device so we never open a second Simulator
      # window or migrate data between two same-named devices.
      if ($3 == "Booted") { print $0; found = 1; exit }
      if (!best) best = $0
    }
    END { if (!found && best) print best }'
}

slug() { printf '%s' "$1" | tr -cs 'A-Za-z0-9' '-' | tr 'A-Z' 'a-z' | cut -c1-40; }
PIN_FILE="$STATE_DIR/ios-sim-$(slug "$DEVICE_NAME").udid"

UDID="$FORCE_UDID"
if [ -z "$UDID" ] && [ -f "$PIN_FILE" ]; then
  UDID="$(cat "$PIN_FILE")"
  if ! device_field "$UDID" >/dev/null 2>&1; then
    echo "ERROR: pinned simulator $UDID for '$DEVICE_NAME' is gone." >&2
    echo "       Delete $PIN_FILE to pick another device." >&2
    exit 1
  fi
fi
if [ -z "$UDID" ]; then
  RESOLVED="$(resolve_by_name "$DEVICE_NAME" || true)"
  if [ -z "$RESOLVED" ]; then
    echo "ERROR: no simulator named '$DEVICE_NAME'. Run with --list." >&2
    exit 1
  fi
  IFS='|' read -r UDID FOUND_NAME _ _ <<<"$RESOLVED"
  DEVICE_NAME="$FOUND_NAME"
fi

IFS='|' read -r REAL_NAME STATE RUNTIME_NAME <<<"$(device_field "$UDID")"
echo "==> $REAL_NAME  ($UDID)"
echo "    runtime: $RUNTIME_NAME  state: $STATE"
mkdir -p "$STATE_DIR"; printf '%s' "$UDID" >"$PIN_FILE"

# ── build ───────────────────────────────────────────────────────────────────
if [ "$DO_BUILD" = 1 ]; then
  # Tauri finishes the archive by rename()ing the bundled .app into
  # build/arm64-sim/. rename(2) onto a directory requires the destination to be
  # empty, so a leftover Voltius.app from the previous run aborts the build with
  # "Directory not empty (os error 66)". Clear the whole output dir; it is a
  # build artifact and gitignored.
  rm -rf "$REPO/src-tauri/gen/apple/build"
  echo "==> Building Voltius for iOS simulator (this compiles Rust + Swift)…"
  pnpm tauri ios build --debug --target aarch64-sim --no-sign
  [ -d "$APP_BUNDLE" ] || { echo "ERROR: no app at $APP_BUNDLE" >&2; exit 1; }
fi
[ -d "$APP_BUNDLE" ] || { echo "ERROR: no app at $APP_BUNDLE (drop --no-build?)" >&2; exit 1; }

# ── boot, install, launch ───────────────────────────────────────────────────
if [ "$STATE" != "Booted" ]; then
  echo "==> Booting…"
  xcrun simctl boot "$UDID" 2>&1 | grep -v 'current state: Booted' || true
  # On failure, stop. Do NOT delete and recreate: that throws away the app's
  # data container, which holds the vault.
  for _ in $(seq 1 60); do
    [ "$(xcrun simctl list devices --json | python3 -c '
import json,sys
for dev in json.load(sys.stdin)["devices"].values():
    for d in dev:
        if d.get("udid") == sys.argv[1]: print(d["state"]); sys.exit(0)' "$UDID")" = "Booted" ] && break
    sleep 2
  done
fi

# Xcode 27 removed Simulator.app and moved the UI to Device Hub, which sits one
# level ABOVE `xcode-select -p`. Probe the known locations, then fall back to the
# bundle id, and finally give up quietly — the device is booted either way, so
# failing here would only block install/launch.
open_simulator_ui() {
  local dev contents
  dev="$(xcode-select -p 2>/dev/null || true)"
  contents="$(dirname "$dev")"
  for app in \
    "$contents/Applications/DeviceHub.app" \
    "$contents/Applications/Simulator.app" \
    "$dev/Applications/Simulator.app" \
    "$dev/Applications/DeviceHub.app"; do
    if [ -e "$app" ]; then open "$app" 2>/dev/null && return 0; fi
  done
  for bid in com.apple.dt.Devices com.apple.iphonesimulator; do
    open -b "$bid" 2>/dev/null && return 0
  done
  return 0
}
open_simulator_ui || true
sleep 3

echo "==> Installing…"
xcrun simctl install "$UDID" "$APP_BUNDLE"
xcrun simctl terminate "$UDID" "$APP_ID" 2>/dev/null || true
xcrun simctl launch "$UDID" "$APP_ID"

cat <<EOF

Running on $REAL_NAME ($RUNTIME_NAME).

  App logs:   xcrun simctl spawn $UDID log stream --predicate 'process == "Voltius"'
  Screenshot: xcrun simctl io $UDID screenshot /tmp/voltius-ios.png
  Reload webview (R + R in the Simulator): it re-runs the JS bundle without a
  full cargo rebuild.

Pin for this device: $PIN_FILE
EOF
