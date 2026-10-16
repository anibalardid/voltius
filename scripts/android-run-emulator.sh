#!/usr/bin/env bash
# Boots a native Android emulator (phone or tablet) and runs RoMix on it in dev
# mode, using the SDK/AVDs on the external volume (see android-env.sh).
#
#   scripts/android-run-emulator.sh phone    # pixel_phone on emulator-5556
#   scripts/android-run-emulator.sh tablet   # pixel_tablet on emulator-5558
#
# `tauri android dev` builds the frontend + Rust and deploys to the booted
# emulator. This is the native path (no Docker); the Docker-based headless
# emulator lives in scripts/android-emulator.sh.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

KIND="${1:-phone}"
case "$KIND" in
  phone)  AVD="pixel_phone";  PORT=5556 ;;
  tablet) AVD="pixel_tablet"; PORT=5558 ;;
  *) echo "Usage: $0 [phone|tablet]" >&2; exit 1 ;;
esac

# shellcheck disable=SC1091
source "$REPO/scripts/android-env.sh"

SERIAL="emulator-$PORT"

if adb devices | grep -q "$SERIAL"; then
  echo "==> $SERIAL already connected."
else
  echo "==> Booting $AVD ($SERIAL)..."
  nohup emulator -avd "$AVD" -port "$PORT" -no-snapshot -no-boot-anim \
    -use-keycode-forwarding -audio coreaudio > "/tmp/voltius-$AVD.log" 2>&1 &
  adb -s "$SERIAL" wait-for-device
  for _ in $(seq 1 72); do
    booted="$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
    if [ "$booted" = "1" ]; then
      echo "==> $SERIAL booted."
      break
    fi
    sleep 5
  done
fi

# adb and cargo-mobile2 honor ANDROID_SERIAL to target a specific device when
# more than one emulator/device is connected.
export ANDROID_SERIAL="$SERIAL"

echo "==> Running RoMix on $AVD (tauri android dev)..."
pnpm tauri android dev
