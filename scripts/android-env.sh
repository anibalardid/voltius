#!/usr/bin/env bash
# Loads the Android toolchain for the current shell (sourced, not executed).
# The SDK and AVDs live on an external volume, exposed via symlinks in $HOME:
#   ~/android-sdk -> /Volumes/X9 Pro/Android/sdk
#   ~/android-avd -> /Volumes/X9 Pro/Android/avd
# Usage: source scripts/android-env.sh
#
# Uses Java 21 (Zulu) for Android builds only, leaving the system Java alone.

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/android-avd}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$HOME/.android}"

# Java 21 only for Android builds.
if [ -d "/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home" ]; then
  JAVA_HOME="/Library/Java/JavaVirtualMachines/zulu-21.jdk/Contents/Home"
elif [ -x "/usr/libexec/java_home" ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null)"
fi
export JAVA_HOME

export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

if [ ! -x "$ANDROID_HOME/platform-tools/adb" ]; then
  echo "Android SDK not found at $ANDROID_HOME" >&2
  echo "Expected a symlink to the external SDK ($HOME/android-sdk -> /Volumes/X9 Pro/Android/sdk)." >&2
  return 1 2>/dev/null || exit 1
fi

if [ ! -x "$ANDROID_HOME/emulator/emulator" ]; then
  echo "Emulator not found at $ANDROID_HOME/emulator/emulator" >&2
  return 1 2>/dev/null || exit 1
fi

if [ ! -d "$ANDROID_AVD_HOME" ]; then
  echo "AVD directory not found at $ANDROID_AVD_HOME" >&2
  echo "Expected a symlink to the external AVDs ($HOME/android-avd -> /Volumes/X9 Pro/Android/avd)." >&2
  return 1 2>/dev/null || exit 1
fi
