// Per-shell setup for invisible OSC 7 emission. Used by both local PTY spawn
// (via temp rcfile + custom shell args) and remote SSH (via an exec wrapper
// script that detects the user's shell at runtime).
//
// The strategy mirrors iTerm/ghostty/kitty shell integration: rather than
// echoing setup commands into a running shell (visible), we control the
// shell's *spawn* so it starts already-hooked.

use std::path::{Path, PathBuf};

/// Files/dirs to clean up when the session ends.
pub struct LocalIntegration {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub tempfiles: Vec<PathBuf>,
}

/// Inspect a shell path and prepare a local PTY spawn that injects OSC 7 and
/// best-effort OSC 133 emission. Returns `Ok(None)` for shells that cannot be
/// hooked safely (cmd, wsl, and unknown shells).
pub fn prepare_local(shell: &str, session_id: &str) -> std::io::Result<Option<LocalIntegration>> {
    let shell_name = Path::new(shell)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let temp_dir = std::env::temp_dir();

    match shell_name.as_str() {
        "bash" | "sh" => {
            let rc_path = temp_dir.join(format!("voltius-bashrc-{session_id}"));
            std::fs::write(&rc_path, format!("{BASH_RC}{BASH_NATIVE_COMPLETION}"))?;
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                // GNU bash requires long options before short options;
                // `bash -i --rcfile FILE` errors with "--: invalid option".
                args: vec![
                    "--rcfile".into(),
                    rc_path.to_string_lossy().into_owned(),
                    "-i".into(),
                ],
                env: vec![],
                tempfiles: vec![rc_path],
            }))
        }
        "zsh" => {
            let zdotdir = temp_dir.join(format!("voltius-zdotdir-{session_id}"));
            std::fs::create_dir_all(&zdotdir)?;
            std::fs::write(
                zdotdir.join(".zshenv"),
                format!("{ZSH_ZSHENV}{ZSH_NATIVE_COMPLETION}"),
            )?;
            let orig = std::env::var("ZDOTDIR")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_default();
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec!["-l".into(), "-i".into()],
                env: vec![
                    ("ZDOTDIR".into(), zdotdir.to_string_lossy().into_owned()),
                    ("ZDOTDIR_ORIG".into(), orig),
                ],
                tempfiles: vec![zdotdir],
            }))
        }
        "pwsh" | "powershell" => {
            let script_path = temp_dir.join(format!("voltius-pwsh-{session_id}.ps1"));
            std::fs::write(
                &script_path,
                format!("{PWSH_SCRIPT}{PWSH_NATIVE_COMPLETION}"),
            )?;
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec![
                    "-NoExit".into(),
                    "-File".into(),
                    script_path.to_string_lossy().into_owned(),
                ],
                env: vec![],
                tempfiles: vec![script_path],
            }))
        }
        "cmd" => {
            // cmd's PROMPT command supports $E (escape) and $P (cwd with
            // backslashes). We emit OSC 7 via the prompt directly — no
            // function hook needed. $E\ is ESC + backslash = ST terminator.
            let bat_path = temp_dir.join(format!("voltius-cmd-{session_id}.bat"));
            std::fs::write(&bat_path, CMD_BAT)?;
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec!["/k".into(), bat_path.to_string_lossy().into_owned()],
                env: vec![],
                tempfiles: vec![bat_path],
            }))
        }
        "wsl" => {
            // wsl.exe spawns the user's default WSL distro. The WSL wrapper
            // differs from the SSH one only in its printf format: paths are
            // emitted with host=wsl.localhost and the distro as the first
            // path segment so the frontend can build a UNC path that
            // Windows' fs API can read (`\\wsl.localhost\<distro>\path`).
            // The rcfile lives inside the WSL filesystem; no Windows-side
            // temp files.
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec!["--".into(), "sh".into(), "-c".into(), wsl_exec_command()],
                env: vec![],
                tempfiles: vec![],
            }))
        }
        "fish" => {
            // fish already emits OSC 7 on every prompt. --init-command adds
            // event hooks without replacing the user's config or prompt.
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec![
                    "-l".into(),
                    "-i".into(),
                    "-C".into(),
                    format!("{FISH_INIT_COMMAND}; {FISH_NATIVE_COMPLETION}"),
                ],
                env: vec![],
                tempfiles: vec![],
            }))
        }
        // Unknown shells fall through with no integration.
        _ => Ok(None),
    }
}

/// Best-effort cleanup. Files may already be gone if user wiped /tmp.
pub fn cleanup(tempfiles: &[PathBuf]) {
    for p in tempfiles {
        if p.is_dir() {
            let _ = std::fs::remove_dir_all(p);
        } else {
            let _ = std::fs::remove_file(p);
        }
    }
}

const BASH_RC: &str = "if [ -r /etc/profile ]; then . /etc/profile; fi\n\
if [ -r \"$HOME/.bash_profile\" ]; then . \"$HOME/.bash_profile\"\n\
elif [ -r \"$HOME/.bash_login\" ]; then . \"$HOME/.bash_login\"\n\
elif [ -r \"$HOME/.profile\" ]; then . \"$HOME/.profile\"\n\
else\n\
  [ -r /etc/bash.bashrc ] && . /etc/bash.bashrc\n\
  [ -r \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"\n\
fi\n\
__voltius_pwd() { printf '\\e]7;file://%s%s\\a' \"$HOSTNAME\" \"$PWD\"; }\n\
__voltius_osc133_prompt() { local __voltius_status=$?; printf '\\e]133;D;%s\\a' \"$__voltius_status\"; }\n\
PS0=\"${PS0-}$(printf '\\e]133;C\\a')\"\n\
PS1=\"$(printf '\\e]133;A\\a\\e]133;B\\a')${PS1:-$ }\"\n\
case \";${PROMPT_COMMAND-};\" in\n\
  *\";__voltius_osc133_prompt;\"*) ;;\n\
  *) PROMPT_COMMAND=\"__voltius_osc133_prompt${PROMPT_COMMAND:+;${PROMPT_COMMAND}}\" ;;\n\
esac\n\
case \";${PROMPT_COMMAND-};\" in\n\
  *\";__voltius_pwd;\"*) ;;\n\
  *) PROMPT_COMMAND=\"__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}\" ;;\n\
esac\n\
__voltius_pwd 2>/dev/null\n";

/// Bash's contribution to native completion. The script is uploaded separately
/// so its size does not inflate the nested persistent exec payload.
/// What each part is for:
///
/// * `__voltius_native_complete` runs on Tab via `bind -x` and streams the
///   shell's own candidates over OSC 9280 as hex, so the frontend can offer
///   them without the remote ever writing to the command line.
/// * tmux filters unknown OSC codes. `__voltius_native_osc` wraps OSC 9280 in
///   a tmux DCS passthrough sequence when Voltius created the multiplexer.
/// * `__voltius_native_ci_scan` is the case-insensitive retry. `compgen -f VAR`
///   matches nothing when the directory holds `var`, which is how a wrong-case
///   path gets typed: zero matches, and the shell rings the bell. `nocasematch`
///   is what makes the scan match, and it only applies to `[[ ]]`/`case` - NOT
///   to pathname expansion, which is why this enumerates the directory instead
///   of globbing `VAR*`.
/// * `__voltius_native_bind` re-asserts the Tab keymap at every prompt. A host
///   PROMPT_COMMAND that calls `bind` runs left to right, so this one is
///   APPENDED: prepended, the host clobbers Tab again on the same prompt and
///   readline takes it back, ringing the bell with nothing to show Voltius.
/// * `__voltius_native_report` announces arming from the first PROMPT rather
///   than at load time. The frontend registers its OSC handlers when the
///   terminal mounts, which is after the startup banner, so a load-time marker
///   is dropped by the same no-listener race that once left a live shell
///   showing a blank terminal. Its absence is then real evidence.
const BASH_NATIVE_COMPLETION: &str = r#"
__voltius_native_hex() { LC_ALL=C printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n'; }
__voltius_native_osc() {
  if [[ "${VOLTIUS_MUX:-}" == tmux ]]; then
    printf '\ePtmux;\e\e]9280;%s\a\e\\' "$1"
  else
    printf '\e]9280;%s\a' "$1"
  fi
}
__voltius_native_ci_scan() {
  local word="$1" dir="" base="$word" scan_dir hit name
  [[ "$word" == */* ]] && { dir="${word%/*}/"; base="${word##*/}"; }
  if [[ -z "$dir" ]]; then scan_dir="."; else scan_dir="${dir%/}"; [[ -z "$scan_dir" ]] && scan_dir="/"; fi
  local restore_nocasematch=0
  shopt -q nocasematch || restore_nocasematch=1
  shopt -s nocasematch
  for hit in "$scan_dir"/*; do
    [[ -e "$hit" || -L "$hit" ]] || continue
    name="${hit##*/}"
    [[ $name == $base* ]] || continue
    [[ -d "$hit" ]] && name="$name/"
    printf '%s%s\n' "$dir" "$name"
  done
  ((restore_nocasematch)) && shopt -u nocasematch
}
__voltius_native_complete() {
  local line="$READLINE_LINE" compspec func reply
  local -a words replies out
  if ((${#line} <= 1024)); then
    __voltius_native_osc "A;$(__voltius_native_hex "$line");${READLINE_POINT:-${#line}}"
  else
    __voltius_native_osc A
  fi
  local IFS=$' \t\n'
  read -ra words <<< "$line"
  [[ "$line" == *[[:space:]] ]] && words+=("")
  if ((${#words[@]} == 0)); then __voltius_native_osc B; return; fi
  local cword=$((${#words[@]} - 1)) cmd="${words[0]}"
  compspec="$(complete -p "$cmd" 2>/dev/null)"
  func=""
  local i
  read -ra replies <<< "$compspec"
  for ((i = 0; i < ${#replies[@]}; i++)); do
    if [[ "${replies[$i]}" == "-F" ]]; then func="${replies[$((i + 1))]}"; break; fi
  done
  out=()
  if [[ -n "$func" ]] && declare -F "$func" >/dev/null 2>&1; then
    local COMPREPLY=() COMP_WORDS=("${words[@]}") COMP_CWORD=$cword COMP_LINE="$line"
    local COMP_POINT=${#line}
    "$func" "$cmd" "${words[$cword]}" "${words[$((cword > 0 ? cword - 1 : 0))]}" 2>/dev/null
    out=("${COMPREPLY[@]}")
  elif ((cword == 0)); then
    out=( $(compgen -c -- "${words[0]}") )
  else
    out=( $(compgen -f -- "${words[$cword]}") )
  fi
  if ((${#out[@]} == 0)) && ((cword > 0)); then
    out=( $(__voltius_native_ci_scan "${words[$cword]}") )
  fi
  local count=0 hex
  for reply in "${out[@]}"; do
    [[ -n "$reply" ]] || continue
    hex="$(__voltius_native_hex "$reply")"
    __voltius_native_osc "C;$hex"
    ((++count >= 200)) && break
  done
  __voltius_native_osc B
}
__voltius_native_bind() {
  bind -x '"\C-I":__voltius_native_complete' 2>/dev/null ||
    bind -m emacs-standard -x '"\C-I":__voltius_native_complete' 2>/dev/null ||
    bind -m viins -x '"\C-I":__voltius_native_complete' 2>/dev/null || :
}
__voltius_native_bind
case ";${PROMPT_COMMAND-};" in
  *";__voltius_native_bind;"*) ;;
  *) PROMPT_COMMAND="${PROMPT_COMMAND:+${PROMPT_COMMAND};}__voltius_native_bind" ;;
esac
__voltius_native_report() {
  [ -n "${__voltius_native_reported-}" ] && return 0
  __voltius_native_reported=1
  __voltius_native_osc R
}
case ";${PROMPT_COMMAND-};" in
  *";__voltius_native_report;"*) ;;
  *) PROMPT_COMMAND="${PROMPT_COMMAND:+${PROMPT_COMMAND};}__voltius_native_report" ;;
esac
"#;

// .zshenv trampoline (kitty/ghostty technique): restores ZDOTDIR from
// ZDOTDIR_ORIG then sources the real .zshenv so zsh continues startup with
// the user's files. Fixes configs like zsh4humans that define functions in
// ~/.zshenv before .zshrc runs. The hook installs at .zshenv time, so rc
// files that overwrite precmd_functions (instead of appending) drop cwd
// tracking — accepted trade-off shared with kitty/ghostty.
const ZSH_ZSHENV: &str =
    "if [ -n \"${ZDOTDIR_ORIG-}\" ]; then ZDOTDIR=\"$ZDOTDIR_ORIG\"; else unset ZDOTDIR; fi\n\
unset ZDOTDIR_ORIG\n\
[ -f \"${ZDOTDIR:-$HOME}/.zshenv\" ] && source \"${ZDOTDIR:-$HOME}/.zshenv\"\n\
__voltius_pwd() { printf '\\e]7;file://%s%s\\a' \"${HOST}\" \"$PWD\"; }\n\
__voltius_osc133_precmd() { local __voltius_status=$?; print -n \"\\e]133;D;${__voltius_status}\\a\\e]133;A\\a\\e]133;B\\a\"; }\n\
__voltius_osc133_preexec() { print -n \"\\e]133;C\\a\"; }\n\
typeset -ag precmd_functions\n\
(($precmd_functions[(I)__voltius_pwd])) || precmd_functions+=(__voltius_pwd)\n\
(($precmd_functions[(I)__voltius_osc133_precmd])) || precmd_functions+=(__voltius_osc133_precmd)\n\
typeset -ag preexec_functions\n\
(($preexec_functions[(I)__voltius_osc133_preexec])) || preexec_functions+=(__voltius_osc133_preexec)\n\
__voltius_pwd 2>/dev/null\n";

const ZSH_NATIVE_COMPLETION: &str = r#"
function __voltius_native_hex() { printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n'; }
function __voltius_native_osc() {
  if [[ "${VOLTIUS_MUX:-}" == tmux ]]; then
    printf '\ePtmux;\e\e]9280;%s\a\e\\' "$1"
  else
    printf '\e]9280;%s\a' "$1"
  fi
}
function compadd() {
  if [[ "${__voltius_native_capture:-0}" != 1 || "$*" == *" -A "* || "$*" == *" -D "* || "$*" == *" -O "* ]]; then
    builtin compadd "$@"; return $?
  fi
  local -a hits
  builtin compadd -A hits "$@"
  [[ -n "$hits" ]] || return 0
  local LC_ALL=C prefix="${PREFIX:-}" start=$(( ${#BUFFER} - ${#PREFIX} )) hit hex
  ((start < 0)) && start=0
  __voltius_native_osc "S;$start,${#prefix}"
  for hit in $hits; do
    hex="$(__voltius_native_hex "$hit")"
    __voltius_native_osc "C;$hex"
  done
}
function __voltius_native_completer() { compstate[list_max]=-1; _main_complete; }
function __voltius_native_widget() {
  __voltius_native_osc A
  __voltius_native_capture=1
  if (( ! $+functions[_main_complete] )); then autoload -Uz compinit; compinit -u >/dev/null 2>&1; fi
  (( $+functions[_main_complete] )) && zle __voltius_native_complete_internal
  __voltius_native_capture=0
  __voltius_native_osc B
}
zle -C __voltius_native_complete_internal list-choices __voltius_native_completer 2>/dev/null
zle -N __voltius_native_widget 2>/dev/null
bindkey '^I' __voltius_native_widget 2>/dev/null
bindkey -M viins '^I' __voltius_native_widget 2>/dev/null
function __voltius_native_rebind() {
  bindkey '^I' __voltius_native_widget 2>/dev/null
  bindkey -M viins '^I' __voltius_native_widget 2>/dev/null
  # Report from the first prompt, not from load time: the frontend only
  # registers its OSC handlers once the terminal mounts, after the banner.
  if [[ -z "${__voltius_native_reported-}" ]]; then
    __voltius_native_reported=1
    __voltius_native_osc R
  fi
}
typeset -ag precmd_functions
(($precmd_functions[(I)__voltius_native_rebind])) || precmd_functions+=(__voltius_native_rebind)
"#;

/// fish's event hooks append to the existing prompt/preexec/postexec events.
/// They do not replace the user's prompt function or install a key handler.
const FISH_INIT_COMMAND: &str = "function __voltius_osc133_prompt --on-event fish_prompt; printf '\\e]133;A\\a\\e]133;B\\a'; end; function __voltius_osc133_preexec --on-event fish_preexec; printf '\\e]133;C\\a'; end; function __voltius_osc133_postexec --on-event fish_postexec; printf '\\e]133;D;%s\\a' $status; end";

const FISH_NATIVE_COMPLETION: &str = r#"function __voltius_native_hex
  printf '%s' "$argv[1]" | od -An -v -tx1 | string replace -a ' ' '' | string join ''
end
function __voltius_native_osc
  if test "$VOLTIUS_MUX" = tmux
    printf '\ePtmux;\e\e]9280;%s\a\e\\' "$argv[1]"
  else
    printf '\e]9280;%s\a' "$argv[1]"
  end
end
function __voltius_native_complete
  set -l line (commandline)
  __voltius_native_osc A
  for row in (complete -C -- "$line")
    set -l parts (string split -m 1 \t -- $row)
    set -l hex (__voltius_native_hex "$parts[1]")
    __voltius_native_osc "C;$hex"
    if test (count $parts) -gt 1
      set -l desc (__voltius_native_hex "$parts[2]")
      __voltius_native_osc "D?description;$desc"
    end
  end
  __voltius_native_osc B
end
bind \t __voltius_native_complete
function __voltius_rebind_native_completion --on-event fish_prompt
  bind \t __voltius_native_complete
  if not set -q __voltius_native_reported
    set -g __voltius_native_reported 1
    __voltius_native_osc R
  end
end"#;

const PWSH_NATIVE_COMPLETION: &str = r#"
function __voltius_native_hex([string]$value) { [Convert]::ToHexString([Text.Encoding]::UTF8.GetBytes($value)).ToLowerInvariant() }
function global:__voltius_native_complete {
  $line = ''; $cursor = 0
  [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
  [Console]::Write("`e]9280;A`a")
  try {
    if ($line.Length -gt 0) {
      $completion = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $cursor, $null)
      if ($completion.ReplacementIndex -ge 0) {
        $utf8 = [Text.Encoding]::UTF8
        $start = $utf8.GetByteCount($line.Substring(0, $completion.ReplacementIndex))
        $endIndex = [Math]::Min($completion.ReplacementIndex + $completion.ReplacementLength, $line.Length)
        $length = $utf8.GetByteCount($line.Substring(0, $endIndex)) - $start
        [Console]::Write("`e]9280;S;$start,$length`a")
      }
      foreach ($match in $completion.CompletionMatches) {
        $text = __voltius_native_hex $match.CompletionText
        [Console]::Write("`e]9280;C;$text`a")
        if ($match.ToolTip -and $match.ToolTip -ne $match.CompletionText) {
          $description = (($match.ToolTip -split '\r?\n' | Where-Object { $_.Trim() }) -join ' ')
          $desc = __voltius_native_hex $description
          [Console]::Write("`e]9280;D?description;$desc`a")
        }
      }
    }
  } finally { [Console]::Write("`e]9280;B`a") }
}
if (Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue) { Set-PSReadLineKeyHandler -Chord Tab -ScriptBlock { __voltius_native_complete } }
"#;

/// The native script directory is baked in as a literal, never read from the
/// environment. A PERSISTENT session runs the pane through tmux, and a tmux
/// server that is already running builds new panes from its OWN environment,
/// not the client's: `update-environment` only applies to attached sessions. So
/// an exported `VOLTIUS_NATIVE_COMPLETION_DIR` reaches the first connect of a
/// fresh server and silently vanishes on every later one - the script sits
/// readable on disk while the shell sources nothing, which is indistinguishable
/// from the shell ignoring us. A literal in the payload cannot be lost that way.
const BASH_NATIVE_SOURCE: &str = r#"if [ -r "$D/bash" ]; then . "$D/bash"; fi"#;
const ZSH_NATIVE_SOURCE: &str = r#"if [ -r "$D/zsh" ]; then source "$D/zsh"; fi"#;

/// Per-session directory for the uploaded completion scripts.
///
/// The name is deliberately short. The persistent payload base64-encodes the
/// shell wrapper a second time, so every character of this path costs 16/9
/// times. At the full 62-char `/tmp/.voltius-native-voltius_<uuid>_v2` form the
/// persistent command came to 8578 bytes, past [`MAX_EXEC_COMMAND_LEN`], and the
/// client silently drops over-long exec commands: the session then falls back to
/// a plain login shell with no integration at all, and nothing in the log says
/// why. The version marker deliberately stays on the tmux session key, not here:
/// this directory is rewritten on every connect, so it does not need to
/// distinguish builds.
pub fn native_completion_dir(session_id: &str) -> String {
    let sanitized: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let short: String = sanitized.chars().take(16).collect();
    format!("/tmp/.vn-{short}")
}

/// Same primitives the shell wrapper depends on, probed on the host itself.
///
/// The wrapper's own diagnostic could not ship: the persistent payload encodes
/// this script a second time (16/9) and the wire budget had no room. The upload
/// channel has no such limit, and it already runs on the same connection before
/// the shell starts, so it is the cheap place to answer the only question that
/// matters when the native hook never arms: does this host actually have the
/// tools the wrapper assumes?
pub fn native_completion_diagnostic_command(session_id: &str) -> String {
    let dir = native_completion_dir(session_id);
    format!(
        r#"{{
  printf 'sh=%s bash=%s mktemp=%s base64=%s od=%s\n' \
    "$(basename "$(readlink -f /bin/sh 2>/dev/null || echo "$0")" 2>/dev/null)" \
    "$(command -v bash 2>/dev/null || echo MISSING)" \
    "$(command -v mktemp 2>/dev/null || echo MISSING)" \
    "$(command -v base64 2>/dev/null || echo MISSING)" \
    "$(command -v od 2>/dev/null || echo MISSING)"
  tmux -V 2>/dev/null || true
  T=$(mktemp 2>/dev/null) && printf 'mktemp=ok\n' || printf 'mktemp=FAILED\n'
  if [ -n "$T" ]; then
    printf 'a\nb\n' > "$T" 2>/dev/null && printf 'write=ok bytes=%s\n' "$(wc -c <"$T" 2>/dev/null || echo 0)" || printf 'write=FAILED\n'
    rm -f "$T" 2>/dev/null
  fi
  [ -d "{dir}" ] && printf 'dir=ok\n' || printf 'dir=MISSING\n'
  [ -r "{dir}/bash" ] && printf 'script=ok\n' || printf 'script=MISSING\n'
}} > "{dir}/diag" 2>&1; cat "{dir}/diag" 2>/dev/null | base64 -w0 2>/dev/null || true"#
    )
}

pub fn native_completion_upload_commands(session_id: &str) -> Vec<String> {
    use base64::engine::general_purpose;
    use base64::Engine;

    let dir = native_completion_dir(session_id);
    vec![
        ("bash", BASH_NATIVE_COMPLETION.to_string()),
        ("zsh", ZSH_NATIVE_COMPLETION.to_string()),
        ("fish", FISH_NATIVE_COMPLETION.to_string()),
    ]
    .into_iter()
    .map(|(shell, script)| {
        let encoded = general_purpose::STANDARD.encode(script.as_bytes());
        format!("mkdir -p {dir} && echo {encoded} | base64 -d > {dir}/{shell}")
    })
    .collect()
}

// $E = ESC, $P = path with backslashes, $G = >, $S = space. The $E\\ sequence
// is ESC + backslash = ST (string terminator), closing the OSC 7. The path
// uses backslashes; the frontend OSC handler normalizes to forward slashes.
const CMD_BAT: &str = "@echo off\r\nprompt $E]7;file://localhost/$P$E\\$P$G$S\r\n";

const PWSH_SCRIPT: &str = "if (Test-Path $PROFILE) { . $PROFILE }\n\
$global:__voltiusOldPrompt = if (Test-Path Function:\\prompt) { $function:prompt } else { $null }\n\
function global:prompt {\n\
  $exitCode = if ($?) { 0 } else { 1 }\n\
  [Console]::Write([char]27 + ']133;D;' + $exitCode + [char]7 + [char]27 + ']133;A' + [char]7 + [char]27 + ']133;B' + [char]7)\n\
  $cwd = (Get-Location).Path -replace '\\\\', '/'\n\
  $hostName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'localhost' }\n\
  [Console]::Write([char]27 + ']7;file://' + $hostName + '/' + $cwd + [char]7)\n\
  if ($global:__voltiusOldPrompt) { & $global:__voltiusOldPrompt } else { \"PS $cwd> \" }\n\
}\n";

/// POSIX wrapper that detects $SHELL at runtime, writes a per-session rcfile
/// under /tmp, and execs into a hooked interactive shell. NOT invoked
/// directly — `ssh_exec_command` wraps it in a base64 bootstrap so it's
/// safe to send regardless of the remote login shell's syntax (fish/csh
/// would otherwise choke on POSIX case/heredoc).
///
/// The `<&2` on every exec is load-bearing: when run via
/// `echo b64 | base64 -d | sh`, the inner sh's stdin is the pipe from
/// base64. After exec, the new shell would inherit that already-closed pipe
/// and immediately exit on EOF (printing "exit" and looping reconnect).
/// Duplicating stderr — which still holds the pty file description sshd
/// created — restores the real PTY.
///
/// Do NOT reopen by path (`</dev/tty`): that creates a *different* file
/// description of the tty, and sudo's `use_pty` mode (default on modern
/// Ubuntu/Debian) then fails to recognize the shell's stdin as the user's
/// terminal. Input handling splits between sudo's pty relay and the command,
/// and most keystrokes are silently lost inside `sudo -i` (a key had to be
/// pressed several times for one to register). Same reasoning as the
/// persistent wrapper's `<&2` (see `persistent_exec_command`).
///
/// The temp file leaks intentionally — /tmp is cleared on reboot, and trying
/// to rm it from inside the rcfile races with bash/zsh reading it.
/// Comments are deliberately kept OUT of this string. It is base64'd onto the
/// wire and every byte counts against [`MAX_EXEC_COMMAND_LEN`], so a paragraph
/// of rationale here costs ~1.3 bytes on a router's exec limit. The notes that
/// used to live inside the payload:
///
/// * The generated bash rcfile replicates bash's own startup, because
///   `--rcfile` otherwise skips `/etc/profile`, `/etc/bash.bashrc` and the
///   profile chain — which is where PS1 and welcome text live.
/// * An empty `--rcfile` is worse than none: bash would start interactive while
///   skipping the user's own bashrc, losing their prompt, history and aliases.
///   Hence the `[ -s ]` guard that falls back to a plain login shell.
/// * The final branch exists for busybox/dash-only hosts with no bash: hooking
///   OSC 7 through `$ENV` keeps integration working, and without it `exec bash`
///   would fail 127, the sh would exit, and the session would reconnect-loop.
const SSH_WRAPPER: &str = r#"export D=__VOLTIUS_NATIVE_DIR__
case "$(basename "${SHELL:-/bin/sh}")" in
zsh)
  ZDOTDIR_TMP=$(mktemp -d 2>/dev/null) || exec zsh -l -i <&2
  export ZDOTDIR_ORIG="${ZDOTDIR:-$HOME}"
  cat > "$ZDOTDIR_TMP/.zshenv" <<'EOF'
if [ -n "${ZDOTDIR_ORIG-}" ]; then ZDOTDIR="$ZDOTDIR_ORIG"; else unset ZDOTDIR; fi
unset ZDOTDIR_ORIG
[ -f "${ZDOTDIR:-$HOME}/.zshenv" ] && source "${ZDOTDIR:-$HOME}/.zshenv"
__voltius_pwd() { printf '\e]7;file://%s%s\a' "${HOST}" "$PWD"; }
__v133p() { local s=$?; print -n "\e]133;D;${s}\a\e]133;A\a\e]133;B\a"; }
__v133x() { print -n "\e]133;C\a"; }
typeset -ag precmd_functions
(($precmd_functions[(I)__voltius_pwd])) || precmd_functions+=(__voltius_pwd)
 (($precmd_functions[(I)__v133p])) || precmd_functions+=(__v133p)
typeset -ag preexec_functions
(($preexec_functions[(I)__v133x])) || preexec_functions+=(__v133x)
__VOLTIUS_NATIVE_ZSH__
__voltius_pwd 2>/dev/null
EOF
  ZDOTDIR="$ZDOTDIR_TMP" exec zsh -l -i <&2
  ;;
  fish)
   exec fish -l -i -C "test -r \"$D/fish\"; and source \"$D/fish\"; function __v133p --on-event fish_prompt; printf '\e]133;A\a\e]133;B\a'; end; function __v133x --on-event fish_preexec; printf '\e]133;C\a'; end; function __v133d --on-event fish_postexec; printf '\e]133;D;%s\a' \$status; end" <&2
   exec fish -l -i <&2
   ;;
 *)
  if command -v bash >/dev/null 2>&1; then
  RCFILE_TMP=$(mktemp 2>/dev/null) || exec bash -l -i <&2
  cat > "$RCFILE_TMP" <<'EOF'
if [ -r /etc/profile ]; then . /etc/profile; fi
if [ -r "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"
elif [ -r "$HOME/.bash_login" ]; then . "$HOME/.bash_login"
elif [ -r "$HOME/.profile" ]; then . "$HOME/.profile"
else
  [ -r /etc/bash.bashrc ] && . /etc/bash.bashrc
  [ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"
fi
__voltius_pwd() { printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"; }
v() { local s=$?; printf '\e]133;D;%s\a' "$s"; }
PROMPT_COMMAND="v${PROMPT_COMMAND:+;${PROMPT_COMMAND}}"
PS0="${PS0-}"$'\e]133;C\a'
PS1=$'\e]133;A\a\e]133;B\a'"${PS1:-$ }"
 case ";${PROMPT_COMMAND-};" in
  *";__voltius_pwd;"*) ;;
  *) PROMPT_COMMAND="__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;
 esac
__VOLTIUS_NATIVE_BASH__
 __voltius_pwd 2>/dev/null
EOF
  if [ -s "$RCFILE_TMP" ]; then exec bash --rcfile "$RCFILE_TMP" -i <&2; fi
  exec bash -l -i <&2
  else
  ENVF=$(mktemp 2>/dev/null) || exec sh -i <&2
  cat > "$ENVF" <<'EOF'
__voltius_pwd() { printf '\033]7;file://%s%s\007' "${HOSTNAME:-}" "$PWD"; }
PS1='$(__voltius_pwd)'"${PS1:-$ }"
EOF
  ENV="$ENVF" exec sh -i <&2
  fi
  ;;
esac
"#;

/// sshd emits the MOTD only for an interactive `shell` request, not the `exec`
/// path integration/persistence use, so reproduce it. Single quote-free line so
/// it can embed in the persist inner; respects ~/.hushlogin.
pub const MOTD_PREAMBLE: &str = "[ ! -e $HOME/.hushlogin ] && { [ -r /run/motd.dynamic ] && cat /run/motd.dynamic; [ -r /etc/motd ] && cat /etc/motd; }";

/// Build the SSH exec payload. The remote login shell (whatever it may be:
/// bash, zsh, fish, csh, dash) only needs to parse `echo ... | base64 -d |
/// sh` — a syntax common to every Unix shell. The decoded POSIX wrapper then
/// runs under /bin/sh and execs into the user's actual shell with OSC 7
/// emission hooked.
///
/// `prefix` (a `cd` into the session's starting directory, or empty) runs
/// inside the decoded wrapper. Prefixing the outer payload instead would put it
/// in front of the login shell, which may be csh or fish; inside, it is /bin/sh.
/// Shell startup references the scripts uploaded on a separate channel. Both
/// flat and persistent payloads use the same source, so the persistent wrapper
/// stays within the exec-command limit.
fn ssh_wrapper_with_native_completion(native_dir: &str) -> String {
    SSH_WRAPPER
        .replace("__VOLTIUS_NATIVE_ZSH__", ZSH_NATIVE_SOURCE)
        .replace("__VOLTIUS_NATIVE_BASH__", BASH_NATIVE_SOURCE)
        // Last: the dir placeholder also lives inside the two source snippets
        // inserted above, so replacing it earlier would leave them literal.
        .replace("__VOLTIUS_NATIVE_DIR__", native_dir)
}

pub fn ssh_exec_command(prefix: &str) -> String {
    let wrapper = ssh_wrapper_with_native_completion("");
    encode_wrapper(&format!("{prefix}\n{MOTD_PREAMBLE}\n{wrapper}"))
}

pub fn ssh_exec_command_for_session(prefix: &str, session_id: &str) -> String {
    let wrapper = ssh_wrapper_with_native_completion(&native_completion_dir(session_id));
    encode_wrapper(&format!("{prefix}\n{MOTD_PREAMBLE}\n{wrapper}"))
}

/// Persistent tmux/screen sessions keep only the OSC 133 prompt boundary.
/// Multiplexers can replay or filter command lifecycle markers, so B/C/D would
/// create duplicate or stale blocks after reattachment. The A marker is safe:
/// it re-establishes the frontend's trusted empty command line for each prompt.
pub fn ssh_exec_command_without_blocks(prefix: &str) -> String {
    ssh_exec_command_without_blocks_for_dir(prefix, "")
}

pub fn ssh_exec_command_without_blocks_for_dir(prefix: &str, native_dir: &str) -> String {
    let mut wrapper = ssh_wrapper_with_native_completion(native_dir);
    wrapper = wrapper.replace(
        "__v133p() { local s=$?; print -n \"\\e]133;D;${s}\\a\\e]133;A\\a\\e]133;B\\a\"; }\n",
        "__v133p() { print -n \"\\e]133;A\\a\"; }\n",
    );
    wrapper = wrapper.replace(
        "function __v133p --on-event fish_prompt; printf '\\e]133;A\\a\\e]133;B\\a'; end; function __v133x --on-event fish_preexec; printf '\\e]133;C\\a'; end; function __v133d --on-event fish_postexec; printf '\\e]133;D;%s\\a' \\$status; end",
        "function __v133p --on-event fish_prompt; printf '\\e]133;A\\a'; end",
    );
    wrapper = wrapper.replace(
        "PS1=$'\\e]133;A\\a\\e]133;B\\a'\"${PS1:-$ }\"\n",
        "PS1=$'\\e]133;A\\a'\"${PS1:-$ }\"\n",
    );
    for marker in [
        "__v133x() { print -n \"\\e]133;C\\a\"; }\n",
        "typeset -ag preexec_functions\n",
        "(($preexec_functions[(I)__v133x])) || preexec_functions+=(__v133x)\n",
        "v() { local s=$?; printf '\\e]133;D;%s\\a' \"$s\"; }\n",
        "PROMPT_COMMAND=\"v${PROMPT_COMMAND:+;${PROMPT_COMMAND}}\"\n",
        "PS0=\"${PS0-}\"$'\\e]133;C\\a'\n",
    ] {
        wrapper = wrapper.replace(marker, "");
    }
    encode_wrapper(&format!("{prefix}\n{MOTD_PREAMBLE}\n{wrapper}"))
}

pub fn ssh_exec_command_without_blocks_for_session(prefix: &str, session_id: &str) -> String {
    ssh_exec_command_without_blocks_for_dir(prefix, &native_completion_dir(session_id))
}

/// Longest `exec` payload we will put on the wire. dropbear's `MAX_STRING_LEN`
/// is `MAX(MAX_CMD_LEN, 2400)` = 9000, and passing it is not a rejected request
/// but `dropbear_exit("String too long")` — the connection dies right after
/// auth succeeds (#85). Kept under that with room for the session key.
pub const MAX_EXEC_COMMAND_LEN: usize = 8192;

const TMUX_SOCKET: &str = "voltius";
const TMUX_PASSTHROUGH_CONFIG: &str = "set -g allow-passthrough on";

/// Prepended to the pane command so the session shell no longer looks like it
/// is inside a multiplexer (#159). The persistence wrapper is an implementation
/// detail, but tmux exports `$TMUX` into the shell it starts, and a tmux client
/// with no `-L`/`-S` takes its socket from `$TMUX` — so a user's own `tmux ls`
/// listed Voltius's private socket instead of their sessions, and `tmux attach`
/// refused outright ("sessions should be nested with care, unset $TMUX to
/// force"). Nothing in Voltius reads these back: every control path names the
/// socket and session explicitly.
const TMUX_ENV_STRIP: &str = "unset TMUX TMUX_PANE; ";

/// screen's equivalent of [`TMUX_ENV_STRIP`]. `screen -x` inside a session
/// would otherwise join the wrapper rather than the user's own session.
const SCREEN_ENV_STRIP: &str = "unset STY WINDOW; ";

/// Shown once, inside the new window, when a session lands on a GNU screen
/// older than 5.0. Those parse `ESC[38;2;r;g;b` and emit nothing, so TrueColor
/// TUIs (btop) draw solid blocks instead of shaded braille (#118) — there is no
/// termcap/terminfo setting that recovers it. screen 5.0 added a `truecolor`
/// command (off by default) which does pass RGB through; the rc below enables
/// it, so 5.x reaches this notice only when mktemp gave us no rc to write.
const SCREEN_DEGRADED_NOTICE: &str = "[voltius] tmux not found - using GNU screen without TrueColor. TUIs like btop may render as solid blocks. Install tmux or GNU screen 5.0+, or turn off persistent sessions for this host to connect without a multiplexer.";

/// Notice printed on the raw pty: CR before each LF because the terminal is
/// still in raw mode at this point, so a bare LF would stair-step.
fn notice_printf(message: &str) -> String {
    format!("printf '\\r\\n{message}\\r\\n'")
}

/// Short fingerprint of the shell integration, folded into the session name.
///
/// A persistent session reuses whatever shell is already running inside
/// tmux/screen, so a pane created by an older build keeps that build's shell
/// integration forever: the wrapper never re-runs, the completion hook never
/// arms, and reconnecting just re-attaches to a shell that will never work. The
/// symptom is indistinguishable from "the remote ignores us" - no OSC 133, no
/// arming marker, no completion.
///
/// Include the scripts and tmux passthrough configuration too: changing a shell
/// hook without changing the outer wrapper must also replace the running pane.
fn wrapper_fingerprint() -> String {
    // FNV-1a: cheap, stable across runs, and collisions here would only mean a
    // pane is reused when it could have been rebuilt.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for script in [
        SSH_WRAPPER,
        BASH_NATIVE_COMPLETION,
        ZSH_NATIVE_COMPLETION,
        FISH_NATIVE_COMPLETION,
        TMUX_PASSTHROUGH_CONFIG,
    ] {
        for byte in script.bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    let hex = format!("{hash:016x}");
    hex[..8].to_string()
}

/// tmux/screen session name for a session id, sanitized to `[A-Za-z0-9_-]`.
/// Stable across reconnect so the multiplexer re-attaches the live session —
/// and keyed to the wrapper so a pane from a different build is never reused.
pub fn tmux_session_key(session_id: &str) -> String {
    let sanitized: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("voltius_{sanitized}_{}", wrapper_fingerprint())
}

/// Wrap `inner` (the existing exec bootstrap) in tmux, else screen, else a
/// plain shell. `inner` must contain no double quotes: it is embedded in the
/// double-quoted multiplexer command. The outer sh's stdin is the base64
/// pipe, so the pty is re-attached with `<&2`: stderr still holds the
/// original pty file description sshd created. Re-opening the device by path
/// (`</dev/tty` or the pts path) breaks modern tmux — 3.4+ rejects
/// `/dev/tty` outright ("can't use /dev/tty"), and a fresh open of the pts
/// makes the server's redraw writes vanish, leaving a connected-but-blank
/// terminal. Duplicating the inherited description avoids both.
///
/// The screen branch first self-heals: `screen -wipe` clears `Dead ???`
/// entries left by abrupt drops, and any same-named duplicates are collapsed to
/// one server. Unlike tmux's server-serialized `new-session -A`, `screen -D -R`
/// has no name-collision protection — concurrent connects can create duplicates,
/// and once two exist `-D -R` refuses to attach ("several suitable screens"),
/// which closes the channel and feeds the reconnect loop into spawning more.
///
/// It then version-gates `truecolor on`, which only screen 5.0+ understands:
/// older screens print `unknown command 'truecolor'` and get
/// `SCREEN_DEGRADED_NOTICE` instead. `persistent_attach_command` needs no such
/// gate — `screen -x` joins the running server, which keeps the setting this rc
/// gave it at create time.
///
/// Create path only: session keys derive from fresh UUIDs, so `-A`/`-D -R`
/// never meet a session another device is attached to. Re-attach and
/// cross-device join go through `persistent_attach_command`.
///
/// The screen branch gives up its escape key the same way the tmux branch gives
/// up its prefix, so a user's own screen inside ours keeps `C-a` (#159 follow-up:
/// a bare `C-a d` used to detach *our* wrapper, which the app then silently
/// reconnected). screen has no `prefix None` equivalent — `escape` always names
/// some key — so it is pointed at `\377`, a byte no key produces in a UTF-8
/// terminal. The one theoretical cost is a latin-1 session where 0xFF is `ÿ`;
/// that is worth trading for a wrapper the user's own screen can nest inside.
/// Unlike the tmux prefix this needs no version gate: `escape` and octal escapes
/// long predate any screen still in use, and a screen that did reject the line
/// would simply keep its default key.
///
/// Both multiplexer configs override the outer terminal's `cnorm` (cursor
/// normal) capability to plain `\E[?25h`. xterm-256color's stock cnorm is
/// `\E[?12l\E[?25h`, and the `?12l` half is "stop cursor blinking" — xterm.js
/// maps DECRST 12 straight onto `options.cursorBlink = false`, so every
/// multiplexer redraw silently turned off the user's cursor-blink setting in
/// SSH sessions (local sessions, with no multiplexer, kept blinking). Remote
/// apps that explicitly request a blinking cursor (cvvis / DECSCUSR) still
/// work; only the implicit blink-off on redraw is dropped.
///
/// The wrapper is meant to be invisible to whatever the user runs inside it, so
/// it also gives up the prefix key: `prefix None` leaves `C-b` to the user's own
/// tmux instead of being swallowed by ours (#159). Nothing here needs a prefix —
/// the status line is off and every Voltius command addresses the session by
/// name over the `-L voltius` socket. It is set two ways because a config file
/// is only read when the server starts: `-f` covers a cold server, and the
/// `set -g` push covers one an earlier session already left running. Both are
/// version-gated to tmux 2.1+, the first release that accepts `None` as a key.
///
/// `inner` is bound once to `$V` rather than inlined at each of the five call
/// sites. Inlining made the exec payload ~21.7 KB, over dropbear's 9000-byte
/// `MAX_STRING_LEN`, so dropbear killed the channel with "String too long" the
/// instant authentication succeeded (#85). `V="…"` is double-quoted, so `inner`
/// still expands in this outer shell exactly as when it was inlined.
pub fn persistent_exec_command(session_key: &str, inner: &str) -> String {
    let script = format!(
        r#"V="{inner}"
if command -v tmux >/dev/null 2>&1; then
  V="{tmux_strip}export VOLTIUS_MUX=tmux; $V"
  TMUX_PASSTHROUGH=
  case "$(tmux -V 2>/dev/null)" in
    *"tmux "3.[3-9]*|*"tmux "3.[1-9][0-9]*|*"tmux "[4-9]*)
      tmux -L {socket} {tmux_passthrough} >/dev/null 2>&1
      TMUX_PASSTHROUGH=1 ;;
  esac
  TMUX_PREFIX_NONE=
  case "$(tmux -V 2>/dev/null)" in
    *"tmux "[3-9]*|*"tmux "[1-9][0-9]*|*"tmux "2.[1-9]*)
      tmux -L {socket} set -g prefix None >/dev/null 2>&1
      TMUX_PREFIX_NONE=1 ;;
  esac
  TMUX_CONF=$(mktemp 2>/dev/null)
  if [ -n "$TMUX_CONF" ]; then
    cat > "$TMUX_CONF" <<'EOF'
set -g status off
set -g mouse on
set -g default-terminal "xterm-256color"
set -g history-limit 50000
set -sg escape-time 0
set -g destroy-unattached off
set -ga terminal-overrides ',*:cnorm=\E[?25h'
EOF
    [ -n "$TMUX_PASSTHROUGH" ] && echo '{tmux_passthrough}' >> "$TMUX_CONF"
    [ -n "$TMUX_PREFIX_NONE" ] && echo "set -g prefix None" >> "$TMUX_CONF"
    exec tmux -L {socket} -f "$TMUX_CONF" new-session -A -s {key} "$V" <&2
  fi
  exec tmux -L {socket} new-session -A -s {key} "$V" <&2
elif command -v screen >/dev/null 2>&1; then
  V="{screen_strip}$V"
  screen -wipe >/dev/null 2>&1
  for d in $(screen -ls 2>/dev/null | grep -F .{key} | awk '{{print $1}}' | tail -n +2); do
    screen -S "$d" -X quit >/dev/null 2>&1
  done
  SCREEN_RC=$(mktemp 2>/dev/null)
  if [ -n "$SCREEN_RC" ]; then
    cat > "$SCREEN_RC" <<'EOF'
startup_message off
msgwait 0
msgminwait 0
vbell off
defscrollback 50000
escape \377\377
termcapinfo xterm* ti@:te@:ve=\E[?25h
EOF
    case "$(screen --version 2>/dev/null)" in
      *"Screen version "[5-9]*|*"Screen version "[1-9][0-9]*)
        echo truecolor on >> "$SCREEN_RC" ;;
      *) V="{screen_notice}; $V" ;;
    esac
    exec screen -c "$SCREEN_RC" -S {key} -D -R sh -c "$V" <&2
  fi
  V="{screen_notice}; $V"
  exec screen -S {key} -D -R sh -c "$V" <&2
else
  {no_mux_notice}
  exec sh -c "$V" <&2
fi
"#,
        socket = TMUX_SOCKET,
        key = session_key,
        inner = inner,
        tmux_strip = TMUX_ENV_STRIP,
        tmux_passthrough = TMUX_PASSTHROUGH_CONFIG,
        screen_strip = SCREEN_ENV_STRIP,
        screen_notice = notice_printf(SCREEN_DEGRADED_NOTICE),
        no_mux_notice =
            notice_printf("[voltius] tmux/screen not found - session will not survive disconnects"),
    );
    encode_wrapper(&script)
}

/// Attach-only wrapper: co-attaches a live session (tmux plain attach, screen
/// `-x` multi-display) and NEVER creates one — `persistent_probe_command` runs
/// first, so reaching the fallthrough means the session died in between; the
/// exit just closes the channel and the caller re-probes.
pub fn persistent_attach_command(session_key: &str) -> String {
    let script = format!(
        r#"if command -v tmux >/dev/null 2>&1 && tmux -L {socket} has-session -t {key} 2>/dev/null; then
  exec tmux -L {socket} attach-session -t {key} <&2
elif command -v screen >/dev/null 2>&1; then
  exec screen -x -S {key} <&2
fi
printf '\r\n[voltius] session has ended\r\n'
exit 97
"#,
        socket = TMUX_SOCKET,
        key = session_key,
    );
    encode_wrapper(&script)
}

/// One-shot existence probe mirroring the wrapper's tmux-first order. Prints
/// VOLTIUS_PRESENT when the session is alive; `screen -wipe` first so a dead
/// entry left by a crash doesn't read as present.
pub fn persistent_probe_command(session_key: &str) -> String {
    let script = format!(
        r#"if command -v tmux >/dev/null 2>&1 && tmux -L {socket} has-session -t {key} 2>/dev/null; then
  printf VOLTIUS_PRESENT
elif command -v screen >/dev/null 2>&1; then
  screen -wipe >/dev/null 2>&1
  screen -ls 2>/dev/null | grep -qF .{key} && printf VOLTIUS_PRESENT
fi
true"#,
        socket = TMUX_SOCKET,
        key = session_key,
    );
    encode_wrapper(&script)
}

/// One-shot exec that dumps the scrollback history of a persistent session,
/// picking the backend at runtime to mirror `persistent_exec_command`.
///
/// tmux: `capture-pane -peJ -S -50000 -E -1` — history from 50k lines back up
/// to just above the visible screen (`-E -1`), which the attach redraw repaints
/// anyway. `-p` prints to stdout, `-e` preserves SGR attributes, `-J` joins
/// wrapped lines.
///
/// screen: no stdout dump exists, so `hardcopy -h` writes the scrollback (plus
/// the live screen) to a temp file. `-X` is async — the session backend writes
/// the file — so we poll until its size settles before reading. The dump is
/// plain text (screen strips SGR) and includes the visible viewport, so
/// `head -n -<rows>` trims the last `pty_rows` lines to match tmux's `-E -1`
/// and avoid duplicating the redraw. `head -n -N` is GNU coreutils; on BSD head
/// it no-ops harmlessly (no trim).
///
/// Exits silently when the multiplexer or session is gone (host rebooted): the
/// capture is empty and the caller skips replay.
pub fn capture_history_command(session_key: &str, pty_rows: u32) -> String {
    format!(
        r#"if command -v tmux >/dev/null 2>&1 && tmux -L {socket} has-session -t {key} 2>/dev/null; then
  tmux -L {socket} capture-pane -t {key} -peJ -S -50000 -E -1 2>/dev/null
elif command -v screen >/dev/null 2>&1; then
  f=$(mktemp 2>/dev/null) || exit 0
  screen -S {key} -X hardcopy -h "$f" 2>/dev/null
  for i in $(seq 1 15); do
    a=$(wc -c <"$f" 2>/dev/null); sleep 0.1; b=$(wc -c <"$f" 2>/dev/null)
    [ "$a" = "$b" ] && break
  done
  head -n -{rows} "$f" 2>/dev/null
  rm -f "$f"
fi
true"#,
        socket = TMUX_SOCKET,
        key = session_key,
        rows = pty_rows,
    )
}

/// One-shot exec that resolves the current working directory of a persistent
/// session, used to drive the SFTP panel's "follow cwd" when the multiplexer
/// swallows the shell's OSC 7: GNU screen never forwards OSC 7 to the outer
/// terminal, and tmux consumes it for `#{pane_current_path}` rather than
/// passing it through. tmux is queried directly; screen has no cwd query, so we
/// descend the session's process tree to the foreground process and read
/// `/proc/<pid>/cwd` (Linux only — screen+cwd on macOS has no /proc and is
/// unsupported). Prints the absolute path on success, nothing otherwise.
pub fn cwd_probe_command(session_key: &str) -> String {
    let script = format!(
        r#"if command -v tmux >/dev/null 2>&1 && tmux -L {socket} has-session -t {key} 2>/dev/null; then
  tmux -L {socket} display-message -p -t {key} '#{{pane_current_path}}'
elif command -v screen >/dev/null 2>&1; then
  spid=$(screen -ls 2>/dev/null | grep -F .{key} | head -n1 | awk '{{print $1}}' | cut -d. -f1)
  if [ -n "$spid" ]; then
    pid=$spid
{descent}
    [ -n "$cwd" ] && printf '%s\n' "$cwd"
  fi
fi
true"#,
        socket = TMUX_SOCKET,
        key = session_key,
        descent = SCREEN_CWD_DESCENT,
    );
    encode_wrapper(&script)
}

/// Walks from `$pid` down to the foreground process, leaving the deepest usable
/// cwd in `$cwd`. The window's wrapper sh pipes into the real shell, so the
/// interactive shell is a grandchild — the direct child keeps a stale login cwd.
/// Only directories that still exist count: `/proc/<pid>/cwd` resolves to
/// `<path> (deleted)` once the directory is unlinked, so a long-lived program
/// pinned to a since-removed directory would otherwise report a path no `cd` can
/// reach, silently landing a session duplicated from it in the home directory.
const SCREEN_CWD_DESCENT: &str = r#"cwd=""
    while :; do
      c=$(pgrep -P "$pid" 2>/dev/null | tail -n1)
      [ -n "$c" ] || c=$(ps -o pid= --ppid "$pid" 2>/dev/null | tail -n1 | tr -d ' ')
      [ -n "$c" ] || break
      pid=$c
      cur=$(readlink /proc/$pid/cwd 2>/dev/null)
      [ -n "$cur" ] && [ -d "$cur" ] && cwd=$cur
    done"#;

/// Whether a cwd reported by [`cwd_probe_command`] can be handed to a `cd`.
/// The probe's own `[ -d ]` guard drops unlinked directories, but a host whose
/// `/proc` or `readlink` behaves differently can still surface the kernel's
/// `<path> (deleted)` form; taking it would strand a duplicated session in the
/// home directory rather than keeping the last live cwd.
pub fn is_live_probe_cwd(path: &str) -> bool {
    path.starts_with('/') && !path.ends_with(" (deleted)")
}

/// Conditional kill for a shared session. Kills only when at most
/// `max_clients` clients are attached (1 when the closer's own channel is
/// still attached, 0 when it already dropped) — another device's live attach
/// must survive a local tab close. Prints VOLTIUS_KILLED on confirmed kill,
/// and also when the session is already gone (host rebooted: tombstoning it
/// is accurate). No portable client count exists for screen; the frontend's
/// manifest gate is the only protection there. Socket/server flags MUST
/// mirror `persistent_exec_command`.
pub fn persistent_kill_command(session_key: &str, max_clients: usize) -> String {
    let script = format!(
        r#"K=0
if command -v tmux >/dev/null 2>&1 && tmux -L {socket} has-session -t {key} 2>/dev/null; then
  if [ "$(tmux -L {socket} list-clients -t {key} 2>/dev/null | grep -c .)" -le {max} ]; then
    tmux -L {socket} kill-session -t {key} 2>/dev/null && K=1
  fi
elif command -v screen >/dev/null 2>&1 && screen -ls 2>/dev/null | grep -qF .{key}; then
  screen -S {key} -X quit >/dev/null 2>&1 && K=1
else
  K=1
fi
[ "$K" = "1" ] && printf VOLTIUS_KILLED
true"#,
        socket = TMUX_SOCKET,
        key = session_key,
        max = max_clients,
    );
    encode_wrapper(&script)
}

/// Client count no real session reaches; keeps the `-le` guard in
/// `persistent_kill_command` always true so a manual kill destroys the
/// multiplexer regardless of who is attached. Stays under 2^63 for POSIX `[ ]`.
const FORCE_KILL_CLIENTS: usize = 1_000_000;

/// Unconditional variant of `persistent_kill_command` for an explicit,
/// user-initiated destroy of a session this device is not attached to.
pub fn force_kill_command(session_id: &str) -> String {
    persistent_kill_command(&tmux_session_key(session_id), FORCE_KILL_CLIENTS)
}

/// Same shape as `ssh_exec_command` but encodes the WSL-flavored wrapper,
/// which emits OSC 7 with the distro name so the frontend can route the
/// panel to a `\\wsl.localhost\<distro>\` UNC path.
pub fn wsl_exec_command() -> String {
    encode_wrapper(WSL_WRAPPER)
}

fn encode_wrapper(script: &str) -> String {
    use base64::engine::general_purpose;
    use base64::Engine;
    let encoded = general_purpose::STANDARD.encode(script);
    format!("echo {encoded} | base64 -d | sh")
}

/// Container wrapper (docker exec / pct exec). Like SSH_WRAPPER, but:
///   - It must survive minimal images: bash often isn't present, so the
///     fallback is a POSIX `sh` whose `$ENV` startup file hooks OSC 7 into PS1
///     via command substitution (`$(__voltius_pwd)` re-runs every prompt and
///     emits the sequence — portable across dash and busybox ash).
///   - No `</dev/tty` is needed: it's run via `eval "$(… | base64 -d)"`, so the
///     wrapping shell keeps the container TTY on stdin and `exec sh -i`
///     inherits it directly (no pipe to escape from).
const CONTAINER_WRAPPER: &str = r#"if command -v bash >/dev/null 2>&1; then
  RC=$(mktemp 2>/dev/null || echo /tmp/.voltius_rc)
  cat > "$RC" <<'EOF'
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
__voltius_pwd() { printf '\033]7;file://%s%s\007' "${HOSTNAME:-}" "$PWD"; }
case ";${PROMPT_COMMAND-};" in
  *";__voltius_pwd;"*) ;;
  *) PROMPT_COMMAND="__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;
esac
__voltius_pwd 2>/dev/null
EOF
  exec bash --rcfile "$RC" -i
else
  ENVF=$(mktemp 2>/dev/null || echo /tmp/.voltius_env)
  cat > "$ENVF" <<'EOF'
__voltius_pwd() { printf '\033]7;file://%s%s\007' "${HOSTNAME:-}" "$PWD"; }
PROMPT_COMMAND="__voltius_pwd"
PS1='$(__voltius_pwd)'"${PS1:-$ }"
EOF
  ENV="$ENVF" exec sh -i
fi
"#;

/// Build the argument for `sh -c '<…>'` inside a container (the caller prefixes
/// `docker exec -it <cid>` or `pct exec <vmid> --`). Base64-decodes the wrapper
/// and `eval`s it (keeping the container TTY on stdin); if `base64` is missing,
/// falls back to a plain interactive shell so the session still opens.
pub fn container_exec_payload() -> String {
    use base64::engine::general_purpose;
    use base64::Engine;
    let encoded = general_purpose::STANDARD.encode(CONTAINER_WRAPPER);
    // Single-quote-free (only double quotes + base64 alphabet) so the caller can
    // safely wrap the whole thing in single quotes for the host shell.
    format!(
        "if command -v base64 >/dev/null 2>&1; then eval \"$(printf %s \"{encoded}\" | base64 -d)\"; else exec sh -i; fi"
    )
}

/// WSL flavor: same structure as SSH_WRAPPER but the printf format embeds
/// the distro into the OSC 7 path. The frontend recognizes the
/// `wsl.localhost` host and constructs a UNC path Windows can read.
const WSL_WRAPPER: &str = r#"WSL_DISTRO_NAME="${WSL_DISTRO_NAME:-Linux}"
export WSL_DISTRO_NAME
case "$(basename "${SHELL:-/bin/sh}")" in
zsh)
  ZDOTDIR_TMP=$(mktemp -d 2>/dev/null) || exec zsh -i <&2
  export ZDOTDIR_ORIG="${ZDOTDIR:-$HOME}"
  cat > "$ZDOTDIR_TMP/.zshenv" <<'EOF'
if [ -n "${ZDOTDIR_ORIG-}" ]; then ZDOTDIR="$ZDOTDIR_ORIG"; else unset ZDOTDIR; fi
unset ZDOTDIR_ORIG
[ -f "${ZDOTDIR:-$HOME}/.zshenv" ] && source "${ZDOTDIR:-$HOME}/.zshenv"
__voltius_pwd() { printf '\e]7;file://wsl.localhost/%s%s\a' "$WSL_DISTRO_NAME" "$PWD"; }
typeset -ag precmd_functions
(($precmd_functions[(I)__voltius_pwd])) || precmd_functions+=(__voltius_pwd)
__voltius_pwd 2>/dev/null
EOF
  ZDOTDIR="$ZDOTDIR_TMP" exec zsh -i <&2
  ;;
fish)
  exec fish -i -C 'function __voltius_wsl_pwd --on-event fish_prompt; printf "\e]7;file://wsl.localhost/%s%s\a" "$WSL_DISTRO_NAME" "$PWD"; end' <&2
  ;;
*)
  RCFILE_TMP=$(mktemp 2>/dev/null) || exec bash -i <&2
  cat > "$RCFILE_TMP" <<'EOF'
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
__voltius_pwd() { printf '\e]7;file://wsl.localhost/%s%s\a' "$WSL_DISTRO_NAME" "$PWD"; }
case ";${PROMPT_COMMAND-};" in
  *";__voltius_pwd;"*) ;;
  *) PROMPT_COMMAND="__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;
esac
__voltius_pwd 2>/dev/null
EOF
  exec bash --rcfile "$RCFILE_TMP" -i <&2
  ;;
esac
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose;
    use base64::Engine;

    fn decode_bootstrap(cmd: &str) -> String {
        let b64 = cmd
            .strip_prefix("echo ")
            .and_then(|s| s.split(" |").next())
            .expect("bootstrap shape");
        String::from_utf8(general_purpose::STANDARD.decode(b64).unwrap()).unwrap()
    }

    #[test]
    fn session_key_sanitizes_unsafe_chars() {
        let fingerprint = wrapper_fingerprint();
        assert_eq!(
            tmux_session_key("abc-123"),
            format!("voltius_abc-123_{fingerprint}")
        );
        assert_eq!(
            tmux_session_key("a.b:c d"),
            format!("voltius_a_b_c_d_{fingerprint}")
        );
    }

    #[test]
    fn the_session_key_is_keyed_to_the_wrapper_so_a_stale_pane_is_never_reused() {
        // A persistent session reuses the shell already running in tmux, so a
        // pane started by an older build keeps that build's integration forever
        // and never converges. The fingerprint of the wrapper is part of the
        // session name, so any edit to the wrapper is automatically a different
        // session - there is no hand-maintained version string to forget.
        let key = tmux_session_key("s1");
        assert!(key.ends_with(&wrapper_fingerprint()));
        assert_eq!(wrapper_fingerprint().len(), 8);
        // The script directory is per session and short, and deliberately does
        // NOT carry the fingerprint: it is rewritten on every connect, so it
        // never needs to distinguish builds.
        assert!(native_completion_dir("s1").starts_with("/tmp/.vn-"));
        assert!(!native_completion_dir("s1").contains(&wrapper_fingerprint()));
    }

    #[test]
    fn persistent_wrapper_embeds_inner_and_all_branches() {
        let inner = ssh_exec_command("");
        let cmd = persistent_exec_command("voltius_s1", &inner);
        let script = decode_bootstrap(&cmd);
        assert!(script.contains("command -v tmux"));
        assert!(script.contains("tmux -L voltius"));
        assert!(script.contains("new-session -A -s voltius_s1"));
        // Shared sessions: creating must never detach another device's client.
        assert!(!script.contains(" -D -s"));
        assert!(script.contains("command -v screen"));
        assert!(script.contains("screen -S voltius_s1"));
        assert!(script.contains("screen -c"));
        // #118: screen 5.0+ passes RGB through once `truecolor` is on; older
        // screens drop `ESC[38;2;r;g;b` entirely and get the warning instead.
        // It is prepended to $V so it prints inside the window — screen's
        // startup clear would wipe anything written before the exec.
        assert!(script.contains(r#"echo truecolor on >> "$SCREEN_RC""#));
        assert!(script.contains(r#"*"Screen version "[5-9]*"#));
        assert!(script.contains(&format!(
            r#"V="{}; $V""#,
            notice_printf(SCREEN_DEGRADED_NOTICE)
        )));
        assert!(script.contains("without TrueColor"));
        // #159: the pane shell must not inherit multiplexer env, or the user's
        // own tmux talks to our socket and refuses to attach.
        assert!(script.contains(&format!(
            r#"V="{TMUX_ENV_STRIP}export VOLTIUS_MUX=tmux; $V""#
        )));
        assert!(script.contains(&format!(r#"V="{SCREEN_ENV_STRIP}$V""#)));
        // #159: C-b belongs to whatever the user runs inside, not to us. Set on
        // both a cold server (via -f) and one left running by a past session.
        assert!(script.contains(r#"tmux -L voltius set -g prefix None"#));
        assert!(script.contains(r#"echo "set -g prefix None" >> "$TMUX_CONF""#));
        assert!(script.contains(r#"*"tmux "2.[1-9]*"#));
        // #159 follow-up: screen's escape key belongs to whatever runs inside,
        // pointed at a byte no key produces rather than a real chord.
        assert!(script.contains(r"escape \377\377"));
        // Self-heal: wipe dead entries and collapse same-named duplicates so
        // -D -R can't fail into the "several suitable screens" reconnect loop.
        assert!(script.contains("screen -wipe"));
        assert!(script.contains("grep -F .voltius_s1"));
        assert!(script.contains("-X quit"));
        assert!(script.contains("msgwait 0"));
        // cnorm/ve stripped of ?12l so multiplexer redraws don't disable the
        // user's cursor-blink setting (xterm.js maps DECRST 12 to blink off).
        assert!(script.contains("cnorm=\\E[?25h"));
        assert!(script.contains("ti@:te@:ve=\\E[?25h"));
        assert!(script.contains("will not survive disconnects"));
        assert!(!inner.contains('"'));
        assert!(script.contains(&inner));
    }

    #[test]
    fn ssh_wrapper_reproduces_motd() {
        let decoded = decode_bootstrap(&ssh_exec_command(""));
        assert!(decoded.contains("/run/motd.dynamic"));
        assert!(decoded.contains("/etc/motd"));
        assert!(decoded.contains(".hushlogin"));
        // Quote-free so it can also be embedded in the persist inner.
        assert!(!MOTD_PREAMBLE.contains('"'));
    }

    #[test]
    fn ssh_wrapper_runs_the_cd_prefix_before_the_shell() {
        let decoded = decode_bootstrap(&ssh_exec_command("cd '/srv/app' 2>/dev/null; "));
        let cd = decoded
            .find("cd '/srv/app'")
            .expect("prefix is in the wrapper");
        // Inside the decoded /bin/sh wrapper, and before it execs the login shell.
        assert!(cd < decoded.find("case \"$(basename").unwrap());
        assert!(!decode_bootstrap(&ssh_exec_command("")).contains("cd '"));
    }

    #[test]
    fn persistent_attach_joins_without_stealing_or_creating() {
        let script = decode_bootstrap(&persistent_attach_command("voltius_s1"));
        assert!(script.contains("tmux -L voltius has-session -t voltius_s1"));
        assert!(script.contains("attach-session -t voltius_s1"));
        // Co-attach: never detach the other device, never create a session.
        assert!(!script.contains("new-session"));
        assert!(!script.contains("-D"));
        assert!(script.contains("screen -x -S voltius_s1"));
        // Re-attach over the stderr pty (`<&2`); modern tmux rejects `</dev/tty`.
        assert!(script.contains("<&2"));
    }

    #[test]
    fn persistent_probe_detects_both_multiplexers() {
        let script = decode_bootstrap(&persistent_probe_command("voltius_s1"));
        assert!(script.contains("tmux -L voltius has-session -t voltius_s1"));
        // Dead screen entries must not read as present (attach -x would fail).
        assert!(script.contains("screen -wipe"));
        assert!(script.contains("grep -qF .voltius_s1"));
        assert!(script.contains("VOLTIUS_PRESENT"));
        assert!(script.trim_end().ends_with("true"));
    }

    #[test]
    fn persistent_kill_is_conditional_and_reports() {
        let key = tmux_session_key("s1");
        let attached = decode_bootstrap(&persistent_kill_command(&key, 1));
        let detached = decode_bootstrap(&persistent_kill_command(&key, 0));
        // Kill only when no client beyond the closer's own is attached.
        assert!(attached.contains("-le 1"));
        assert!(detached.contains("-le 0"));
        let key = tmux_session_key("s1");
        assert!(attached.contains(&format!("list-clients -t {key}")));
        assert!(attached.contains(&format!("tmux -L voltius kill-session -t {key}")));
        assert!(attached.contains(&format!("screen -S {key} -X quit")));
        // Confirmed kill (or already gone) prints the sentinel for the tombstone.
        assert!(attached.contains("VOLTIUS_KILLED"));
        assert!(attached.trim_end().ends_with("true"));
    }

    #[test]
    fn force_kill_command_ignores_attached_clients() {
        let decoded = decode_bootstrap(&force_kill_command("s1"));
        // Unconditional: the client-count guard uses the force threshold.
        assert!(decoded.contains("-le 1000000"));
        let key = tmux_session_key("s1");
        assert!(decoded.contains(&format!("tmux -L voltius kill-session -t {key}")));
        assert!(decoded.contains(&format!("screen -S {key} -X quit")));
        assert!(decoded.contains("VOLTIUS_KILLED"));
    }

    #[test]
    fn persistent_wrapper_keeps_pty_redirects() {
        let inner = ssh_exec_command("");
        let cmd = persistent_exec_command("voltius_s1", &inner);
        let script = decode_bootstrap(&cmd);
        // The multiplexer re-attaches over the stderr pty (`<&2`), not `/dev/tty`.
        assert!(script.contains("<&2"));
        assert!(script.contains("exec sh -c \"$V\" <&2"));
        assert!(script.contains(&format!("V=\"{}\"", inner)));
    }

    #[test]
    fn ssh_wrapper_zsh_uses_zshenv_trampoline() {
        let decoded = decode_bootstrap(&ssh_exec_command(""));
        assert!(
            decoded.contains("$ZDOTDIR_TMP/.zshenv"),
            "SSH wrapper zsh branch must write .zshenv, got:\n{decoded}"
        );
        assert!(
            !decoded.contains("$ZDOTDIR_TMP/.zshrc"),
            "SSH wrapper must not write .zshrc, got:\n{decoded}"
        );
        assert!(
            decoded.contains("ZDOTDIR=\"$ZDOTDIR_ORIG\""),
            "SSH wrapper must restore ZDOTDIR from ZDOTDIR_ORIG, got:\n{decoded}"
        );
        assert!(
            decoded.contains("${ZDOTDIR:-$HOME}/.zshenv"),
            "SSH wrapper must source real .zshenv, got:\n{decoded}"
        );
        assert!(
            !decoded.contains("${ZDOTDIR_ORIG}/.zshrc"),
            "SSH wrapper must not manually source user .zshrc, got:\n{decoded}"
        );
        assert!(
            decoded.contains("file://%s%s") && decoded.contains("${HOST}"),
            "SSH wrapper must use HOST-based OSC 7 printf, got:\n{decoded}"
        );
    }

    #[test]
    fn ssh_wrapper_embeds_native_completion_for_supported_shells() {
        let decoded = decode_bootstrap(&ssh_exec_command_for_session("", "session/1"));
        let dir = native_completion_dir("session/1");
        // The path is a literal in the payload, never read from the
        // environment: a running tmux server builds new panes from its own
        // environment, so an exported variable silently vanishes on every
        // connect after the first.
        // Bound once as $D: the literal path is paid 16/9 times over in the
        // persistent payload, so repeating it per shell branch is what pushed
        // that command past the wire limit.
        assert_eq!(
            decoded.matches(&dir).count(),
            1,
            "the dir must be written once"
        );
        assert!(decoded.contains("if [ -r \"$D/bash\" ]"));
        assert!(decoded.contains("if [ -r \"$D/zsh\" ]"));
        // The fish snippet is passed as a double-quoted -C argument, so its
        // quotes are escaped in the payload; assert on the reference, not a path.
        assert!(decoded.contains("$D/fish"));
        assert!(
            !decoded.contains("VOLTIUS_NATIVE_COMPLETION_DIR"),
            "the native dir must not depend on an exported variable"
        );
    }

    #[test]
    fn native_completion_upload_commands_cover_posix_shells() {
        let commands = native_completion_upload_commands("session/1");
        let dir = native_completion_dir("session/1");
        assert_eq!(commands.len(), 3);
        assert!(commands.iter().all(|command| command.contains(&dir)));
        assert!(commands.iter().any(|command| command.ends_with("/bash")));
        assert!(commands.iter().any(|command| command.ends_with("/zsh")));
        assert!(commands.iter().any(|command| command.ends_with("/fish")));
    }

    #[test]
    fn bash_native_completion_rebinds_tab_after_the_host_prompt_command() {
        // A host PROMPT_COMMAND that calls `bind` runs left to right, so our
        // re-assert has to be APPENDED. Prepending it lets the host clobber Tab
        // again on the very same prompt: Tab falls through to readline, which
        // rings the bell on an ambiguous match and reports nothing to Voltius.
        assert!(BASH_NATIVE_COMPLETION.contains(
            "PROMPT_COMMAND=\"${PROMPT_COMMAND:+${PROMPT_COMMAND};}__voltius_native_bind\""
        ));
        assert!(!BASH_NATIVE_COMPLETION.contains("__voltius_native_bind${PROMPT_COMMAND"));
        // zsh equivalent, via precmd, already rebinds every prompt.
        assert!(ZSH_NATIVE_COMPLETION.contains("precmd_functions+=(__voltius_native_rebind)"));
    }

    #[test]
    fn every_supported_shell_announces_that_it_armed() {
        // The arming marker is the only signal that distinguishes "the remote
        // rcfile never ran" from "the remote shell ignores us" - the two look
        // identical from the app otherwise, and each costs a diagnostic round
        // trip with the user.
        for (name, script) in [
            ("bash", BASH_NATIVE_COMPLETION),
            ("zsh", ZSH_NATIVE_COMPLETION),
            ("fish", FISH_NATIVE_COMPLETION),
        ] {
            assert!(
                script.contains("__voltius_native_osc R"),
                "{name} must report arming through its OSC 9280 transport"
            );
        }
    }

    #[test]
    fn persistent_shell_passes_native_completion_through_tmux() {
        let id = "9ee3ce38-8a0d-4bef-aa89-917ce8fbf476";
        let inner = ssh_exec_command_without_blocks_for_session("", id);
        let outer = decode_bootstrap(&persistent_exec_command(&tmux_session_key(id), &inner));
        assert!(outer.contains(TMUX_PASSTHROUGH_CONFIG));
        assert!(outer.contains("tmux -L voltius set -g allow-passthrough on"));
        assert!(outer.contains("export VOLTIUS_MUX=tmux; $V"));
        // Ardid reports tmux 3.0a, which already understands DCS passthrough
        // but rejects the newer allow-passthrough option in its config file.
        assert!(outer.contains("*\"tmux \"3.[3-9]*"));
        assert!(
            outer.contains("[ -n \"$TMUX_PASSTHROUGH\" ] && echo 'set -g allow-passthrough on'")
        );
        assert!(!outer.contains("set -g destroy-unattached off\nset -g allow-passthrough on"));
        for (name, script) in [
            ("bash", BASH_NATIVE_COMPLETION),
            ("zsh", ZSH_NATIVE_COMPLETION),
            ("fish", FISH_NATIVE_COMPLETION),
        ] {
            assert!(script.contains("VOLTIUS_MUX"), "{name} must detect tmux");
            assert!(
                script.contains("\\ePtmux;\\e\\e]9280;%s\\a\\e\\\\"),
                "{name} must wrap OSC 9280 in tmux passthrough"
            );
        }
    }

    #[test]
    fn bash_native_completion_scans_case_insensitively() {
        // `compgen -f VAR` matches nothing when the directory holds `var`, so a
        // wrong-case path (how a Warp user types it) used to produce zero
        // matches and a bell. nocasematch is what makes the scan match, and it
        // only applies to `[[ ]]`/`case` - NOT to pathname expansion, which is
        // why this walks the directory instead of globbing `VAR*`.
        assert!(BASH_NATIVE_COMPLETION.contains("__voltius_native_ci_scan"));
        assert!(BASH_NATIVE_COMPLETION.contains("shopt -s nocasematch"));
        assert!(BASH_NATIVE_COMPLETION.contains("[[ $name == $base* ]]"));
        assert!(BASH_NATIVE_COMPLETION
            .contains("out=( $(__voltius_native_ci_scan \"${words[$cword]}\") )"));
    }

    #[test]
    fn the_bash_branch_never_starts_with_an_empty_rcfile() {
        let decoded = decode_bootstrap(&ssh_exec_command(""));
        // bash --rcfile "" starts interactive while skipping the user's own
        // bashrc: no prompt, no history, no aliases, and nothing to debug.
        assert!(decoded.contains("if [ -s \"$RCFILE_TMP\" ]; then exec bash --rcfile"));
    }

    #[test]
    fn the_generated_bash_rcfile_is_syntactically_whole() {
        // A malformed rcfile is invisible at runtime: bash discards the whole
        // file, the completion function never exists, and Tab falls back to a
        // bare readline that rings the bell. The regression that motivated this
        // was an `else <compound commands>; fi` - the `;` after a trailing
        // `esac` is a parse error, so the entire integration silently vanished.
        let decoded = decode_bootstrap(&ssh_exec_command(""));
        let rcfile = decoded
            .split("cat > \"$RCFILE_TMP\" <<'EOF'\n")
            .nth(1)
            .and_then(|rest| rest.split("\nEOF\n").next())
            .expect("wrapper writes a bash rcfile heredoc");
        // `; . /etc/profile; fi` is fine; the broken shape is a line that is
        // only `; fi`, i.e. a stray `;` right after the fallback's `esac`.
        assert!(
            !rcfile.lines().any(|line| line.trim() == "; fi"),
            "generated rcfile has a stray `; fi` line:\n{rcfile}"
        );
        // Sources the uploaded script, and nothing else: a bare `if` here with
        // no `else` cannot be broken by a stray `;` after a compound command.
        assert!(rcfile.contains("if [ -r \""));
        assert!(!rcfile.contains("else __voltius_native_hex()"));
    }

    #[test]
    fn both_exec_payload_shapes_fit_the_wire_limit() {
        // A realistic session id, not "s1": an overlong exec is silently
        // dropped by client.rs in favor of a plain, unintegrated login shell.
        // Include both the native directory and tmux passthrough setup.
        const REAL_ID: &str = "9ee3ce38-8a0d-4bef-aa89-917ce8fbf476";
        let flat = ssh_exec_command_for_session("", REAL_ID);
        assert!(
            flat.len() <= MAX_EXEC_COMMAND_LEN,
            "flat payload {} exceeds {MAX_EXEC_COMMAND_LEN}",
            flat.len()
        );
        assert!(decode_bootstrap(&flat).contains(&native_completion_dir(REAL_ID)));

        let key = tmux_session_key(REAL_ID);
        let persistent_inner = ssh_exec_command_without_blocks_for_session("", REAL_ID);
        let persistent = persistent_exec_command(&key, &persistent_inner);
        assert!(
            persistent.len() <= MAX_EXEC_COMMAND_LEN,
            "persistent payload {} exceeds {MAX_EXEC_COMMAND_LEN}",
            persistent.len()
        );
        assert!(decode_bootstrap(&persistent_inner).contains(&native_completion_dir(REAL_ID)));
        // The wrapper itself stays free of diagnostics: the persistent payload
        // base64-encodes this inner a second time (16/9), so every byte here is
        // charged twice and the budget has no room. Host diagnostics travel on
        // the upload channel instead, which has no such limit.
    }

    #[test]
    fn wsl_wrapper_zsh_uses_zshenv_trampoline() {
        let decoded = decode_bootstrap(&wsl_exec_command());
        assert!(
            decoded.contains("$ZDOTDIR_TMP/.zshenv"),
            "WSL wrapper zsh branch must write .zshenv, got:\n{decoded}"
        );
        assert!(
            !decoded.contains("$ZDOTDIR_TMP/.zshrc"),
            "WSL wrapper must not write .zshrc, got:\n{decoded}"
        );
        assert!(
            decoded.contains("ZDOTDIR=\"$ZDOTDIR_ORIG\""),
            "WSL wrapper must restore ZDOTDIR from ZDOTDIR_ORIG, got:\n{decoded}"
        );
        assert!(
            decoded.contains("${ZDOTDIR:-$HOME}/.zshenv"),
            "WSL wrapper must source real .zshenv, got:\n{decoded}"
        );
        assert!(
            !decoded.contains("${ZDOTDIR_ORIG}/.zshrc"),
            "WSL wrapper must not manually source user .zshrc, got:\n{decoded}"
        );
        assert!(
            decoded.contains("wsl.localhost"),
            "WSL wrapper must keep wsl.localhost printf, got:\n{decoded}"
        );
    }

    #[test]
    fn capture_history_dumps_tmux_history_excluding_visible_screen() {
        let cmd = capture_history_command("voltius_s1", 40);
        assert!(cmd.contains("tmux -L voltius capture-pane -t voltius_s1"));
        // History only: from 50k lines back (-S) to just above the visible
        // screen (-E -1) so the live redraw after attach doesn't duplicate.
        assert!(cmd.contains("-S -50000"));
        assert!(cmd.contains("-E -1"));
        // -p print to stdout, -e keep SGR colors, -J join wrapped lines.
        assert!(cmd.contains("-peJ"));
        // Only run tmux when the session actually exists on the socket.
        assert!(cmd.contains("tmux -L voltius has-session -t voltius_s1"));
        // Missing multiplexer/session must not error the channel.
        assert!(cmd.contains("2>/dev/null"));
        assert!(cmd.trim_end().ends_with("true"));
    }

    #[test]
    fn cwd_probe_queries_tmux_and_descends_screen_proc() {
        let script = decode_bootstrap(&cwd_probe_command("voltius_s1"));
        // tmux: query pane_current_path on our private socket/session.
        assert!(script.contains("tmux -L voltius has-session -t voltius_s1"));
        assert!(script.contains("display-message -p -t voltius_s1 '#{pane_current_path}'"));
        // screen has no cwd query: find the server pid, descend the process
        // tree, and read /proc/<pid>/cwd.
        assert!(script.contains("screen -ls"));
        assert!(script.contains("grep -F .voltius_s1"));
        assert!(script.contains("pgrep -P"));
        assert!(script.contains("ps -o pid= --ppid"));
        assert!(script.contains("readlink /proc/$pid/cwd"));
        // Track the last readable cwd so wrapper shells (stale login cwd) and
        // transient/dead leaves don't win over the real interactive shell, and
        // only count directories that still exist.
        assert!(script.contains("[ -n \"$cur\" ] && [ -d \"$cur\" ] && cwd=$cur"));
        // Never errors the channel; ends clean for the caller's read loop.
        assert!(script.contains("2>/dev/null"));
        assert!(script.trim_end().ends_with("true"));
    }

    /// The descent run for real against a three-level process tree whose deepest
    /// process sits in a directory that is then removed under it: `/proc/<pid>/cwd`
    /// starts resolving to `<path> (deleted)`, and reporting that would send a
    /// duplicated session's `cd` somewhere it can never reach.
    #[cfg(target_os = "linux")]
    #[test]
    fn descent_ignores_a_descendant_whose_directory_was_removed() {
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};

        fn descend(start: u32) -> String {
            let out = Command::new("sh")
                .arg("-c")
                .arg(format!(
                    "pid={start}\n{SCREEN_CWD_DESCENT}\nprintf '%s' \"$cwd\""
                ))
                .output()
                .expect("descent runs");
            String::from_utf8_lossy(&out.stdout).into_owned()
        }

        let root = std::env::temp_dir().join(format!("voltius-descent-{}", std::process::id()));
        let live = root.join("live");
        let doomed = root.join("doomed");
        std::fs::create_dir_all(&live).unwrap();
        std::fs::create_dir_all(&doomed).unwrap();

        // start -> shell in `live` -> sleep in `doomed`, mirroring screen's
        // wrapper -> interactive shell -> foreground program.
        let mut start = Command::new("sh")
            .arg("-c")
            .arg(format!(
                "sh -c 'cd \"{live}\"; sh -c \"cd \\\"{doomed}\\\"; exec sleep 30\"'\n:",
                live = live.display(),
                doomed = doomed.display(),
            ))
            .process_group(0)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("tree spawns");

        // The tree comes up asynchronously; it is fully built once the descent
        // reaches the deepest process. Reaching it is also what makes the rest
        // of this test meaningful.
        let mut built = false;
        for _ in 0..100 {
            if descend(start.id()) == doomed.to_string_lossy() {
                built = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        let result = if built {
            std::fs::remove_dir(&doomed).unwrap();
            Some(descend(start.id()))
        } else {
            None
        };

        // `process_group(0)` made the child its own group leader, so one signal
        // reaps the whole tree. `--` keeps the negative pgid out of kill's flags.
        let _ = Command::new("kill")
            .arg("--")
            .arg(format!("-{}", start.id()))
            .status();
        let _ = start.wait();
        let _ = std::fs::remove_dir_all(&root);

        assert!(built, "descent never reached the deepest process");
        // The removed directory is skipped, so the shell's live cwd stands.
        assert_eq!(result.unwrap(), live.to_string_lossy());
    }

    #[test]
    fn probe_cwd_must_be_an_absolute_live_path() {
        assert!(is_live_probe_cwd("/home/user/project"));
        // The kernel's marker for an unlinked directory — no `cd` can reach it.
        assert!(!is_live_probe_cwd("/home/user/worktrees/gone (deleted)"));
        // Probe output when the multiplexer or session is missing.
        assert!(!is_live_probe_cwd(""));
        assert!(!is_live_probe_cwd("screen: command not found"));
    }

    #[test]
    fn capture_history_falls_back_to_screen_hardcopy() {
        let cmd = capture_history_command("voltius_s1", 40);
        // screen has no stdout dump; hardcopy -h writes scrollback to a temp file.
        assert!(cmd.contains("screen -S voltius_s1 -X hardcopy -h"));
        // Trim the live viewport (pty_rows) so the attach redraw isn't duplicated.
        assert!(cmd.contains("head -n -40"));
        // Gated behind screen availability, after the tmux branch.
        assert!(cmd.contains("elif command -v screen >/dev/null 2>&1; then"));
    }

    #[test]
    fn prepare_local_zsh_writes_zshenv() {
        let session_id = format!("test-zshenv-{}", std::process::id());
        let result = prepare_local("/bin/zsh", &session_id).expect("prepare_local failed");
        let integration = result.expect("expected Some(LocalIntegration) for zsh");

        let zdotdir = integration
            .env
            .iter()
            .find(|(k, _)| k == "ZDOTDIR")
            .map(|(_, v)| std::path::PathBuf::from(v))
            .expect("ZDOTDIR env var not set");

        let zshenv_path = zdotdir.join(".zshenv");
        assert!(
            zshenv_path.exists(),
            ".zshenv must be written at {zshenv_path:?}"
        );
        assert!(
            !zdotdir.join(".zshrc").exists(),
            ".zshrc must not be written, got it at {:?}",
            zdotdir.join(".zshrc")
        );

        let content = std::fs::read_to_string(&zshenv_path).expect("failed to read .zshenv");
        assert!(
            content.contains("${ZDOTDIR:-$HOME}/.zshenv"),
            ".zshenv must source real .zshenv, got:\n{content}"
        );
        assert!(
            content.contains("ZDOTDIR=\"$ZDOTDIR_ORIG\""),
            ".zshenv must restore ZDOTDIR, got:\n{content}"
        );

        cleanup(&integration.tempfiles);
        assert!(!zdotdir.exists(), "cleanup must remove temp dir");
    }

    #[test]
    fn prepare_local_bash_passes_long_option_before_short() {
        // GNU bash rejects a `--long` option that appears after a short option
        // (`bash -i --rcfile FILE` => "bash: --: invalid option"). The rcfile
        // long option must come before `-i`.
        let session_id = format!("test-bashrc-{}", std::process::id());
        let integration = prepare_local("/usr/bin/bash", &session_id)
            .expect("prepare_local failed")
            .expect("expected Some(LocalIntegration) for bash");

        let rcfile_pos = integration
            .args
            .iter()
            .position(|a| a == "--rcfile")
            .expect("--rcfile arg missing");
        let i_pos = integration
            .args
            .iter()
            .position(|a| a == "-i")
            .expect("-i arg missing");
        assert!(
            rcfile_pos < i_pos,
            "--rcfile must precede -i, got args: {:?}",
            integration.args
        );

        cleanup(&integration.tempfiles);
    }

    #[test]
    fn supported_shell_wrappers_keep_user_hooks_and_add_bounded_markers() {
        assert!(BASH_RC.contains("PROMPT_COMMAND") && BASH_RC.contains("PS0"));
        assert!(
            ZSH_ZSHENV.contains("precmd_functions") && ZSH_ZSHENV.contains("preexec_functions")
        );
        assert!(
            FISH_INIT_COMMAND.contains("fish_preexec")
                && FISH_INIT_COMMAND.contains("fish_postexec")
        );
        assert!(PWSH_SCRIPT.contains("__voltiusOldPrompt") && PWSH_SCRIPT.contains("133;D;"));

        let fish = prepare_local(
            "/usr/bin/fish",
            &format!("test-fish-{}", std::process::id()),
        )
        .expect("prepare_local failed")
        .expect("fish should have a safe init-command wrapper");
        assert_eq!(fish.args[0], "-l");
        assert!(fish
            .args
            .windows(2)
            .any(|args| { args[0] == "-C" && args[1].starts_with(FISH_INIT_COMMAND) }));
        cleanup(&fish.tempfiles);
    }

    #[test]
    fn wrappers_reattach_pty_via_stderr_not_dev_tty() {
        // Reopening the tty by path (`</dev/tty`) yields a *different* file
        // description that sudo's `use_pty` relay fails to recognize, silently
        // losing most keystrokes inside `sudo -i`. Duplicating stderr (`<&2`)
        // keeps sshd's original pty fd. Mirrors `persistent_exec_command`.
        for (name, wrapper) in [("SSH_WRAPPER", SSH_WRAPPER), ("WSL_WRAPPER", WSL_WRAPPER)] {
            assert!(
                wrapper.contains("<&2"),
                "{name} must re-attach the pty via `<&2`"
            );
            assert!(
                !wrapper.contains("</dev/tty"),
                "{name} must not reopen the tty by path (`</dev/tty`) — it breaks sudo -i"
            );
        }
    }

    #[test]
    fn persistent_exec_command_fits_dropbear_max_string_len() {
        // dropbear exits the connection with "String too long" past 9000 bytes,
        // which surfaces as a hang just after auth (#85). Inlining `inner` at
        // each branch put this at ~21.7 KB against OpenWrt/ImmortalWrt routers.
        let key = tmux_session_key("0f8b1c22-4d7e-4a19-9f3b-2c6d5e8a7b41");
        for inner in [
            ssh_exec_command_without_blocks(""),
            format!("{MOTD_PREAMBLE}; exec ${{SHELL:-/bin/sh}} -l"),
        ] {
            let cmd = persistent_exec_command(&key, &inner);
            assert!(
                cmd.len() <= MAX_EXEC_COMMAND_LEN,
                "exec payload {} exceeds {MAX_EXEC_COMMAND_LEN}",
                cmd.len()
            );
        }
    }

    #[test]
    fn persistent_wrapper_keeps_prompt_start_osc133_without_command_blocks() {
        let decoded = decode_bootstrap(&ssh_exec_command_without_blocks(""));
        assert!(decoded.contains("file://"));
        assert!(decoded.contains("__v133p() { print -n \"\\e]133;A\\a\"; }"));
        assert!(decoded.contains("function __v133p --on-event fish_prompt"));
        assert!(decoded.contains("PS1=$'\\e]133;A\\a'"));
        assert!(decoded.contains("133;A"));
        assert!(!decoded.contains("133;B"));
        assert!(!decoded.contains("133;C"));
        assert!(!decoded.contains("133;D"));
        assert!(decoded.contains("exec fish -l -i <&2"));
    }

    #[test]
    fn persistent_exec_command_binds_inner_once() {
        // The size fix only holds while `inner` is referenced through `$V`;
        // re-inlining it at the five branches silently restores the overflow.
        let inner = "printf voltius-inner-marker";
        let decoded = decode_bootstrap(&persistent_exec_command(&tmux_session_key("abc"), inner));
        assert_eq!(
            decoded.matches(inner).count(),
            1,
            "inner must appear once (bound to $V), got:\n{decoded}"
        );
        assert!(
            decoded.matches("\"$V\"").count() >= 5,
            "each branch uses $V"
        );
    }
}
