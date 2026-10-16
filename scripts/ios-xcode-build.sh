#!/usr/bin/env bash
# Xcode "Build Rust Code" phase.
#
# Product → Archive does not keep tauri's options server alive. The stock
# `tauri ios xcode-script` then dies with "Connection refused" and the archive
# never links. This script compiles libapp.a itself. Cable, Wi-Fi, and a
# hand-opened Xcode all take the same path.
set -euo pipefail

: "${SRCROOT:?}"
: "${SDKROOT:?}"
: "${CONFIGURATION:?}"
: "${PLATFORM_NAME:?}"
: "${ARCHS:?}"

REPO="$(cd "${SRCROOT}/../../.." && pwd)"

export PATH="${HOME}/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"
if [ -f "${HOME}/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.cargo/env"
fi
# Xcode's PATH stops at /usr/bin. Do not pick the lexicographically last nvm
# install: v24 sorts after v22 and has node but no pnpm. Use a Node that
# actually ships pnpm, plus the standalone pnpm the login shell uses.
node_bin=""
if [ -d "${HOME}/.nvm/versions/node" ]; then
  for dir in "${HOME}/.nvm/versions/node"/*; do
    if [ -x "${dir}/bin/node" ] && [ -x "${dir}/bin/pnpm" ]; then
      node_bin="${dir}/bin"
    fi
  done
fi
if [ -n "${node_bin}" ]; then
  export PATH="${node_bin}:${PATH}"
fi
if [ -x "${HOME}/Library/pnpm/bin/pnpm" ]; then
  export PATH="${HOME}/Library/pnpm/bin:${PATH}"
fi
command -v cargo >/dev/null 2>&1 || { echo "error: cargo is not on PATH (HOME=${HOME:-unset})" >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "error: pnpm is not on PATH (HOME=${HOME:-unset})" >&2; exit 1; }
command -v rustup >/dev/null 2>&1 || { echo "error: rustup is not on PATH" >&2; exit 1; }
echo "==> toolchain pnpm=$(command -v pnpm) node=$(command -v node) cargo=$(command -v cargo)"

echo "==> Frontend (pnpm build)"
(cd "${REPO}" && pnpm build)

sim=0
case "${PLATFORM_NAME}" in
  *simulator*) sim=1 ;;
esac

profile_flag=()
cargo_profile="debug"
case "$(printf '%s' "${CONFIGURATION}" | tr '[:upper:]' '[:lower:]')" in
  release)
    profile_flag=(--release)
    cargo_profile="release"
    ;;
esac

# Xcode passes ARCHS as a space-separated list. Device builds are arm64 only.
for arch in ${ARCHS}; do
  case "${arch}" in
    arm64)
      arch_dir="arm64"
      if [ "${sim}" -eq 1 ]; then
        triple="aarch64-apple-ios-sim"
        env_triple="aarch64_apple_ios_sim"
      else
        triple="aarch64-apple-ios"
        env_triple="aarch64_apple_ios"
      fi
      ;;
    x86_64)
      arch_dir="x86_64"
      triple="x86_64-apple-ios"
      env_triple="x86_64_apple_ios"
      ;;
    *)
      echo "error: unknown arch ${arch}" >&2
      exit 1
      ;;
  esac

  export "CFLAGS_${env_triple}=-isysroot ${SDKROOT}"
  export "CXXFLAGS_${env_triple}=-isysroot ${SDKROOT}"
  export "OBJC_INCLUDE_PATH_${env_triple}=${SDKROOT}/usr/include"
  # Project setting is 15.0. Tauri's Swift static lib is built for Xcode's
  # recommended target, 17.0. Linking at 15.0 drops that object and the
  # swift-rs cdecl symbols (_release_object and friends) disappear.
  case "${IPHONEOS_DEPLOYMENT_TARGET:-15.0}" in
    15|15.*|16|16.*) export IPHONEOS_DEPLOYMENT_TARGET=17.0 ;;
  esac

  if ! rustup target list --installed | grep -qx "${triple}"; then
    rustup target add "${triple}"
  fi

  echo "==> cargo build ${triple} (${CONFIGURATION})"
  (
    cd "${REPO}"
    # Without tauri/custom-protocol, Tauri treats the binary as a dev build and
    # proxies the UI to http://localhost:1420. That is the "local network" screen.
    # TestFlight enables this feature; a bare cargo build does not.
    cargo build --manifest-path src-tauri/Cargo.toml -p romix --lib --target "${triple}" \
      --features tauri/custom-protocol "${profile_flag[@]}"
  )

  lib=""
  for candidate in \
    "${REPO}/target/${triple}/${cargo_profile}/libvoltius_lib.a" \
    "${REPO}/src-tauri/target/${triple}/${cargo_profile}/libvoltius_lib.a"
  do
    if [ -f "${candidate}" ]; then
      lib="${candidate}"
      break
    fi
  done
  [ -n "${lib}" ] || { echo "error: libvoltius_lib.a was not produced for ${triple}" >&2; exit 1; }

  dest="${SRCROOT}/Externals/${arch_dir}/${CONFIGURATION}"
  mkdir -p "${dest}"
  cp "${lib}" "${dest}/libapp.a"
  echo "==> ${dest}/libapp.a"
done
