# OSC 133 command blocks

Voltius treats OSC 133 as an optional terminal signal, not as a requirement
for an interactive session. Supported shell integrations emit best-effort A,
B, C, and D markers:

- **A** starts prompt metadata.
- **B** starts a command block and records local metadata.
- **C** marks command execution.
- **D;N** finishes a block with an exit code from 0 through 255.

The client parser bounds payloads, rejects control characters and malformed exit
codes, tolerates out-of-order markers, and never executes marker payloads. Each
cached terminal owns its block generation. Reconnect starts a new generation;
disconnect is not interpreted as command success.

Markers are navigable with **Alt+PageUp** and **Alt+PageDown** when known block
markers are available. Navigation uses xterm markers and scrolls the ordinary
scrollback buffer. It is not available in alternate-screen applications or
while mouse tracking is active.

## Capability degradation

Bash, zsh, fish, and PowerShell use startup wrappers that append hooks without
replacing the user's prompt/profile hooks. Wrapper setup failure falls back to
an ordinary terminal. Windows OpenSSH, tmux/screen, serial sessions, restore
replay, unsupported shells, and malformed or hostile OSC are treated as
unknown/degraded. Restore replay is rendered once as terminal output and does
not create new block state.

Command blocks do not change shell execution, remote history, session logging,
or lifecycle notification semantics. Universal command detection is not
claimed.
