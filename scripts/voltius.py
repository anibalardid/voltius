#!/usr/bin/env python3
"""Voltius developer menu.

A single executable helper to inspect the toolchain, install Rust/Cargo in an
OS-aware way, and build or run Voltius for the current or a target platform.

Safety model: every command that mutates the machine is printed first and must
be confirmed. Pass --dry-run to only print the commands, or --yes to skip the
per-command confirmation (the command is still printed).
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import textwrap
import time

BANNER = r"""
 __     __    _ _   _
 \ \   / /__ | | |_(_)_   _ ___
  \ \ / / _ \| | __| | | | / __|
   \ V / (_) | | |_| | |_| \__ \
    \_/ \___/|_|\__|_|\__| |___/

        local-first SSH / SFTP / Serial client
"""

WINDOWS = os.name == "nt"


def color(code: str, text: str) -> str:
    if WINDOWS or not sys.stdout.isatty():
        return text
    return f"\033[{code}m{text}\033[0m"


def bold(text: str) -> str:
    return color("1", text)


def dim(text: str) -> str:
    return color("2", text)


def ok(text: str) -> str:
    return color("32", text)


def warn(text: str) -> str:
    return color("33", text)


def err(text: str) -> str:
    return color("31", text)


def detect_os() -> str:
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    if system == "linux":
        return "linux"
    if system == "windows":
        return "windows"
    return system


def detect_arch() -> str:
    machine = platform.machine().lower()
    if machine in ("arm64", "aarch64"):
        return "arm64"
    if machine in ("x86_64", "amd64"):
        return "x86_64"
    return machine


def which(*names: str) -> str | None:
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return None


class Runner:
    """Prints every command; confirms and/or dry-runs mutating ones."""

    def __init__(self, dry_run: bool, assume_yes: bool) -> None:
        self.dry_run = dry_run
        self.assume_yes = assume_yes

    def show(self, command: str) -> None:
        print(f"  {dim('$')} {command}")

    def confirm(self, prompt: str) -> bool:
        if self.assume_yes:
            return True
        try:
            answer = input(f"  {prompt} [{bold('y')}/N]: ").strip().lower()
        except EOFError:
            return False
        return answer in ("y", "yes", "s", "si", "sí")

    def run(
        self,
        args: list[str],
        *,
        cwd: str | None = None,
        confirm: bool = True,
        check: bool = True,
    ) -> int:
        printable = " ".join(self.quote(a) for a in args)
        self.show(printable)
        if self.dry_run:
            print(f"  {warn('[dry-run]')} not executed")
            return 0
        if confirm and not self.confirm("Run this command?"):
            print(f"  {dim('skipped')}")
            return 0
        try:
            completed = subprocess.run(args, cwd=cwd)
        except FileNotFoundError as exc:
            print(f"  {err('command not found:')} {exc.filename}")
            if check:
                raise SystemExit(1) from exc
            return 127
        if check and completed.returncode != 0:
            print(f"  {err('command failed with exit code')} {completed.returncode}")
            raise SystemExit(completed.returncode)
        return completed.returncode

    def shell(self, command: str, *, confirm: bool = True, check: bool = True) -> int:
        self.show(command)
        if self.dry_run:
            print(f"  {warn('[dry-run]')} not executed")
            return 0
        if confirm and not self.confirm("Run this command?"):
            print(f"  {dim('skipped')}")
            return 0
        shell = "cmd" if WINDOWS else "/bin/sh"
        flag = "/c" if WINDOWS else "-c"
        completed = subprocess.run([shell, flag, command])
        if check and completed.returncode != 0:
            print(f"  {err('command failed with exit code')} {completed.returncode}")
            raise SystemExit(completed.returncode)
        return completed.returncode

    @staticmethod
    def quote(arg: str) -> str:
        if not arg or any(ch in arg for ch in " \t\"'\\|&;<>()$`"):
            return "'" + arg.replace("'", "'\\''") + "'"
        return arg


def environment_report() -> None:
    rows = [
        ("OS", f"{detect_os()} ({platform.release()})"),
        ("Arch", detect_arch()),
        ("Python", platform.python_version()),
        ("node", which("node") or warn("missing")),
        ("pnpm", which("pnpm") or warn("missing")),
        ("cargo", which("cargo") or warn("missing")),
        ("rustc", which("rustc") or warn("missing")),
        ("git", which("git") or warn("missing")),
    ]
    print(bold("\nEnvironment"))
    for label, value in rows:
        print(f"  {label:<8} {value}")
    print()


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def require_tools(runner: Runner, tools: list[tuple[str, str]]) -> bool:
    missing = [(label, hint) for label, hint in tools if not which(label)]
    if not missing:
        return True
    print(warn("Missing required tools:"))
    for label, hint in missing:
        print(f"  - {label}: {hint}")
    print(f"\nUse the {bold('Prerequisites')} menu to install them, then try again.\n")
    return False


def ensure_node(runner: Runner) -> None:
    if not require_tools(runner, [("node", "https://nodejs.org"), ("pnpm", "corepack enable")]):
        return
    runner.run(["pnpm", "install"], cwd=repo_root())


# ── Rust / Cargo ─────────────────────────────────────────────────────────────


def install_cargo(runner: Runner) -> None:
    print(bold("\nInstall Rust / Cargo"))
    print("  The installation method depends on your operating system.\n")
    os_name = detect_os()

    if os_name == "macos":
        options = [
            ("rustup (official, recommended)", "rustup"),
            ("Homebrew (brew install rust)", "brew"),
        ]
    elif os_name == "linux":
        options = [
            ("rustup (official, recommended)", "rustup"),
        ]
    elif os_name == "windows":
        options = [
            ("winget (Rustlang.Rustup)", "winget"),
            ("rustup-init.exe (official downloader)", "rustup-init"),
        ]
    else:
        print(err(f"Unsupported operating system: {os_name}"))
        return

    for index, (label, _key) in enumerate(options, start=1):
        print(f"  {index}. {label}")
    print("  b. Back")

    choice = input(f"\n  Choice: {bold('1')}> ").strip() or "1"
    if choice.lower() == "b":
        return
    try:
        method = options[int(choice) - 1][1]
    except (ValueError, IndexError):
        print(err("Invalid choice."))
        return

    if method == "rustup":
        # The official installer is the portable, OS-independent path.
        if os_name == "windows":
            runner.shell(
                "winget install --id Rustlang.Rustup -e",
                confirm=True,
            )
        else:
            runner.shell(
                "curl --proto '=https' --tlsv1.2 -sSf "
                "https://sh.rustup.rs | sh -s -- -y",
                confirm=True,
            )
            print(
                dim(
                    "  After it finishes, open a new shell or run "
                    "`source \"$HOME/.cargo/env\"`."
                )
            )
    elif method == "brew":
        if not which("brew"):
            print(err("Homebrew is not installed: https://brew.sh"))
            return
        runner.run(["brew", "install", "rust"], confirm=True)
    elif method == "winget":
        runner.run(["winget", "install", "--id", "Rustlang.Rustup", "-e"], confirm=True)
    elif method == "rustup-init":
        print(
            dim(
                "  Download https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/"
                "rustup-init.exe and run it."
            )
        )


def install_node(runner: Runner) -> None:
    print(bold("\nInstall Node.js / pnpm"))
    os_name = detect_os()
    if os_name == "macos":
        if which("brew"):
            runner.run(["brew", "install", "node"], confirm=True)
        else:
            print(err("Install Homebrew first: https://brew.sh"), )
            return
    elif os_name == "linux":
        print("  Examples:")
        print("    Debian/Ubuntu: sudo apt install -y nodejs npm")
        print("    Fedora:        sudo dnf install -y nodejs")
        if runner.confirm("Run the Debian/Ubuntu command?"):
            runner.shell("sudo apt install -y nodejs npm")
        else:
            return
    elif os_name == "windows":
        runner.run(["winget", "install", "OpenJS.NodeJS.LTS", "-e"], confirm=True)
    else:
        print(err(f"Unsupported operating system: {os_name}"))
        return
    runner.run(["corepack", "enable"], confirm=True, check=False)
    runner.run(["corepack", "prepare", "pnpm@11.5.2", "--activate"], confirm=True, check=False)


# ── Build / run ──────────────────────────────────────────────────────────────


def tauri(options: list[str], *, extra_env: dict[str, str] | None = None) -> list[str]:
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    return ["pnpm", "tauri", *options]


def run_dev(runner: Runner) -> None:
    if not require_tools(runner, [("pnpm", "Prerequisites menu")]):
        return
    print(
        dim(
            "  `pnpm tauri dev` runs the Vite dev server and the Rust app together. "
            "The first run compiles Rust and can take several minutes."
        )
    )
    runner.run(tauri(["dev"]), cwd=repo_root(), confirm=True)


def build_current(runner: Runner) -> None:
    if not require_tools(runner, [("pnpm", "Prerequisites menu")]):
        return
    print(dim("  Building installers for the current operating system."))
    runner.run(tauri(["build"]), cwd=repo_root(), confirm=True)


def build_macos(runner: Runner, universal: bool) -> None:
    if detect_os() != "macos":
        print(warn("  macOS bundles must be built on macOS."))
        return
    if not require_tools(runner, [("pnpm", "Prerequisites menu")]):
        return
    options = ["build", "--bundles", "app,dmg"]
    if universal:
        options += ["--target", "universal-apple-darwin"]
        print(dim("  Universal build needs both apple-darwin targets installed (rustup target add)."))
    runner.run(tauri(options), cwd=repo_root(), confirm=True)


def build_linux(runner: Runner) -> None:
    if detect_os() != "linux":
        print(warn("  Linux bundles must be built on Linux (or a container)."))
        return
    if not require_tools(runner, [("pnpm", "Prerequisites menu")]):
        return
    runner.run(tauri(["build", "--bundles", "deb,rpm,appimage"]), cwd=repo_root(), confirm=True)


def build_windows(runner: Runner) -> None:
    if detect_os() != "windows":
        print(warn("  Windows installers must be built on Windows."))
        return
    if not require_tools(runner, [("pnpm", "Prerequisites menu")]):
        return
    runner.run(tauri(["build", "--bundles", "nsis,msi"]), cwd=repo_root(), confirm=True)


def build_android(runner: Runner) -> None:
    if not require_tools(runner, [("pnpm", "Prerequisites menu")]):
        return
    print(dim("  Requires Android SDK/NDK + JDK 21. See docs/android-dev.md."))
    print("  1. Android dev run")
    print("  2. Android release build (APK/AAB)")
    choice = input(f"\n  Choice: {bold('2')}> ").strip() or "2"
    if choice == "1":
        runner.run(tauri(["android", "dev"]), cwd=repo_root(), confirm=True)
    else:
        runner.run(tauri(["android", "build"]), cwd=repo_root(), confirm=True)


def frontend_checks(runner: Runner) -> None:
    if not require_tools(runner, [("pnpm", "Prerequisites menu")]):
        return
    print(bold("\nFrontend checks"))
    runner.run(["pnpm", "exec", "tsc", "--noEmit"], cwd=repo_root(), confirm=True)
    runner.run(["pnpm", "test"], cwd=repo_root(), confirm=True)
    runner.run(["pnpm", "build"], cwd=repo_root(), confirm=True)


# ── App data ─────────────────────────────────────────────────────────────────


def app_data_paths() -> list[str]:
    """Every on-disk location Voltius writes to, per OS.

    Config (connections, keys, local_keys.json) and the encrypted secrets store
    live in the user's home; the webview keeps localStorage/IndexedDB (vault
    selection, UI prefs) in a separate per-app directory.
    """
    home = os.path.expanduser("~")
    os_name = detect_os()

    if os_name == "macos":
        return [
            os.path.join(home, "Library/Application Support/voltius"),
            os.path.join(home, "Library/Application Support/com.voltius.app"),
            os.path.join(home, "Library/WebKit/voltius"),
            os.path.join(home, "Library/WebKit/com.voltius.app"),
            os.path.join(home, "Library/Caches/voltius"),
            os.path.join(home, "Library/Caches/com.voltius.app"),
        ]
    if os_name == "linux":
        return [
            os.path.join(home, ".config/voltius"),
            os.path.join(home, ".local/share/voltius"),
            os.path.join(home, ".local/share/com.voltius.app"),
            os.path.join(home, ".cache/voltius"),
            os.path.join(home, ".cache/com.voltius.app"),
        ]
    if os_name == "windows":
        roots = [os.environ.get("APPDATA", ""), os.environ.get("LOCALAPPDATA", "")]
        return [
            os.path.join(root, name)
            for root in roots
            if root
            for name in ("voltius", "com.voltius.app")
        ]
    return []


def reset_app_data(runner: Runner) -> None:
    print(bold("\nReset app data (fresh install)"))
    existing = [p for p in app_data_paths() if os.path.exists(p)]
    if not existing:
        print(dim("  Nothing to reset — no Voltius data found.\n"))
        return

    print("  This backs up and clears the app's local data, so the next launch")
    print("  behaves like a first run (no account, no hosts, no keys).")
    print(warn("  Quit Voltius before continuing.\n"))
    for path in existing:
        print(f"  {path}")

    if runner.dry_run:
        print(f"\n  {warn('[dry-run]')} nothing moved; a real run renames each path")
        print(dim("  to <name>.backup-<timestamp>."))
        return
    if not runner.confirm("Back up and clear this data?"):
        print(f"  {dim('skipped')}")
        return

    stamp = time.strftime("%Y%m%d-%H%M%S")
    for path in existing:
        backup = f"{path}.backup-{stamp}"
        try:
            shutil.move(path, backup)
            print(f"  moved  {path}\n      →  {backup}")
        except OSError as exc:
            print(f"  {err('failed')} {path}: {exc}")
    print(dim("\n  Done. Launch the app again to start from scratch.\n"))


# ── Menu ─────────────────────────────────────────────────────────────────────


MENU = [
    ("Build desktop app (current OS)", lambda r: build_current(r)),
    ("Run desktop app in dev mode", lambda r: run_dev(r)),
    ("Build macOS .app + .dmg", lambda r: build_macos(r, universal=False)),
    ("Build macOS universal (.app + .dmg)", lambda r: build_macos(r, universal=True)),
    ("Build Linux (deb, rpm, AppImage)", lambda r: build_linux(r)),
    ("Build Windows (nsis, msi)", lambda r: build_windows(r)),
    ("Build / run Android", lambda r: build_android(r)),
    ("Frontend checks (tsc, tests, build)", lambda r: frontend_checks(r)),
]


def prerequisites_menu(runner: Runner) -> None:
    while True:
        print(bold("\nPrerequisites"))
        print("  1. Install Rust / Cargo (OS-aware)")
        print("  2. Install Node.js / pnpm (OS-aware)")
        print("  3. Show environment report")
        print("  b. Back")
        choice = input(f"\n  Choice: {bold('3')}> ").strip().lower() or "3"
        if choice == "b":
            return
        if choice == "1":
            install_cargo(runner)
        elif choice == "2":
            install_node(runner)
        elif choice == "3":
            environment_report()
        else:
            print(err("Invalid choice."))


def main_menu(runner: Runner) -> None:
    while True:
        print(bold("\nVoltius"))
        for index, (label, _action) in enumerate(MENU, start=1):
            print(f"  {index}. {label}")
        print("  p. Prerequisites (install Rust/Cargo, Node/pnpm)")
        print("  e. Environment report")
        print("  r. Reset app data (fresh install)")
        print("  q. Quit")

        flags = []
        if runner.dry_run:
            flags.append("dry-run")
        if runner.assume_yes:
            flags.append("auto-confirm")
        suffix = f"  {dim('[' + ', '.join(flags) + ']')}" if flags else ""

        choice = input(f"\n  Choice: {bold('q')}>{suffix} ").strip().lower() or "q"
        if choice in ("q", "quit", "exit"):
            print(dim("\nBye.\n"))
            return
        if choice == "p":
            prerequisites_menu(runner)
            continue
        if choice == "e":
            environment_report()
            continue
        if choice == "r":
            reset_app_data(runner)
            input(dim("\n  Press Enter to continue..."))
            continue
        try:
            _label, action = MENU[int(choice) - 1]
        except (ValueError, IndexError):
            print(err("Invalid choice."))
            continue
        try:
            action(runner)
        except SystemExit:
            print(warn("\nCommand failed. Returning to the menu."))
        input(dim("\n  Press Enter to continue..."))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="voltius.py",
        description="Voltius build/run helper with an interactive menu.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent(
            """\
            Examples:
              ./scripts/voltius.py                 # interactive menu
              ./scripts/voltius.py --dry-run       # print commands only
              ./scripts/voltius.py --yes           # do not confirm each command
              ./scripts/voltius.py --no-menu       # just print the environment report
              ./scripts/voltius.py --reset-data    # back up and clear app data, then exit
            """
        ),
    )
    parser.add_argument("--dry-run", action="store_true", help="print commands without executing")
    parser.add_argument("--yes", "-y", action="store_true", help="skip per-command confirmation")
    parser.add_argument("--no-menu", action="store_true", help="print the environment report and exit")
    parser.add_argument("--reset-data", action="store_true", help="back up and clear the app's local data, then exit")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    print(bold(BANNER))
    runner = Runner(dry_run=args.dry_run, assume_yes=args.yes)

    if args.dry_run:
        print(warn("DRY-RUN: no command will actually run.\n"))

    if args.reset_data:
        reset_app_data(runner)
        return 0

    if args.no_menu:
        environment_report()
        return 0

    print(f"  repo   {repo_root()}")
    if not os.path.isfile(os.path.join(repo_root(), "package.json")):
        print(warn("  warning: package.json not found; run this from the repository."))

    try:
        main_menu(runner)
    except KeyboardInterrupt:
        print(dim("\n\nInterrupted."))
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
