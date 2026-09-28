# Voltius feature catalog

This is the canonical catalog of Voltius capabilities and planned product work. It describes the repository baseline without treating older marketing copy or comparison tables as implementation evidence.

## Status legend

| Status | Meaning |
| --- | --- |
| **Implemented** | A user-facing path or supporting implementation exists in this repository. |
| **Experimental / Unverified** | A guarded user-facing path exists, but live interoperability or a production boundary is not verified. |
| **Planned** | The direction is agreed, but the feature is not implemented yet. |
| **Investigate** | The behavior or protocol needs a focused design/prototype before it can be promised. |

## Implemented

### Connections and sessions

- **SSH** — Interactive SSH sessions with configurable credentials, jump hosts, environment variables, keepalives, host-key handling, and optional legacy algorithms.
- **Persistent SSH sessions** — A remote shell can be wrapped in a private `tmux` session, with `screen` as fallback. Reconnect and workspace restore can reattach to the multiplexer and replay scrollback. The remote host must provide the selected multiplexer.
- **Auto-reconnect** — SSH and serial sessions have reconnect paths and backoff state; persistent SSH sessions can reattach rather than create a replacement session.
- **Jump hosts** — Connections can resolve a chain of jump-host connections.
- **Known hosts** — Known-host records can be listed, trusted, and removed through the application and its local plugin surface.
- **SSH agent forwarding** — Voltius can request forwarding of the operating system's SSH agent for a remote session. This is forwarding, not a built-in Voltius agent; see [SSH agent security](#ssh-agent-security).
- **Port forwarding** — Saved forwarding rules, active tunnel state, and tunnel lifecycle controls are present.
- **SFTP** — Local/remote and host-to-host browsing and transfers use a dual-pane file-transfer surface. Directory transfers have a tar-accelerated path where supported.
- **Serial** — Serial connections expose port, baud, framing, flow-control, and optional serial auto-reconnect settings.

### Terminal and workspace

- **Terminal emulator** — SSH, local-shell, and serial sessions are rendered through the xterm-based terminal surface.
- **Split panes and broadcast** — Sessions can be split, moved, detached, maximized, and broadcast input to writable panes.
- **Workspace restore** — Tabs, pane layout, active sessions, and persistent-session output are restored through the existing workspace/session machinery when the underlying session is available.
- **Shell integration: OSC 7** — Voltius tracks the working directory using OSC 7 hooks/wrappers for supported local and remote shells. `tmux` and `screen` have separate cwd/scrollback handling because they do not always pass OSC 7 through.
- **OSC 133 command blocks** — Supported bash, zsh, fish, and PowerShell integrations emit best-effort prompt/command markers. Voltius parses bounded A/B/C/D markers defensively, tracks local block metadata and exit codes, and provides marker navigation. Multiplexers, replay, alternate-screen applications, serial sessions, unsupported shells, and wrapper failures remain capability-degraded.
- **Command palette** — The omni/command palette can search hosts, active sessions, snippets, settings, local shells, quick-connect intents, and actions.
- **Managed snippets** — Snippets support variables, dynamic connection context, typed prompts, secret-aware input, explicit display-safe previews (including scripts with no variables), multi-step sequences, insertion or execution, and broadcast-aware injection from the existing snippet surfaces. Insert and Execute remain separate actions; sequence snippets keep their existing sequence modal/path.
- **Command history** — Voltius records locally persisted submitted command lines for its history panel. The panel provides a fuzzy subsequence picker, connection filtering, copy, insertion, execution, removal, and clear-all. It is Voltius local history, not shell-native history; see [the feature note](features/snippets-history.md).
- **Client-side terminal suggestions** — An explicit insert-only picker combines privacy-filtered local history with opt-in remote path names from a bounded SFTP listing on the active SSH session. Remote completion is off by default and never presses Enter or opens a second SSH connection. See [the feature note](features/autocomplete.md).
- **Local session logging** — Explicitly opt-in, output-only recordings for SSH, local-shell, and serial terminal sessions. Recordings use a Rust-resolved app-data default, support a custom native-picked directory, bounded rotation/retention, listing, clear-one, clear-all, and failure isolation. See [the feature note](features/session-logging.md).
- **Notifications** — Toasts, banners, and a notification center exist for application/plugin events. Terminal lifecycle signals can independently use terminal feedback, the in-app center/toast, and the OS notification service when available. The OSC 133 command-block slice is implemented as a separate best-effort capability and does not turn unsupported or unknown states into successful lifecycle notifications. See [terminal lifecycle notifications](features/notifications.md).

### Host tools and extensibility

- **Docker and Proxmox** — Remote Docker containers and Proxmox LXC resources can be browsed and opened for terminal/resource operations through the plugin surfaces.
- **Metrics and process management** — Connected hosts expose live system metrics and process listing/termination surfaces.
- **MCP server** — A local MCP surface exposes Voltius operations to compatible local clients. It is a local integration surface, not the future AI assistant described below.
- **Themes** — Built-in theme selection, custom theme editing, terminal palettes, and theme automation are present.
- **Plugins** — Voltius has a permissioned plugin/runtime surface with plugin-provided commands, panels, tools, and integrations.
- **Import and configuration tooling** — Import/export handlers cover connection and related vault objects, including snippets and forwarding rules; application configuration and connection settings are persisted locally.

## Planned and under investigation

These items are intentionally separated from the implemented catalog. The ordered execution plan, acceptance criteria, dependencies, and risks live in [the roadmap](roadmap.md).

| Status | Capability | Boundary for the first design |
| --- | --- | --- |
| **Implemented** | Client-side autocomplete | Explicit insert-only local suggestions plus opt-in active-session remote path names; remote requests are off by default and gated to trusted interactive SSH contexts. |
| **Implemented** | OSC 133 command blocks | Bounded xterm parsing, local marker state, safe navigation, and best-effort bash/zsh/fish/PowerShell wrappers with capability degradation. |
| **Experimental / Unverified** | [Zmodem](features/zmodem.md) | Desktop-only explicit opt-in Send/Receive for non-persistent interactive SSH sessions; live `rz`/`sz` interoperability remains unverified and mobile SAF/ownership-sensitive session types remain gated. |
| **Planned** | [Built-in SSH agent](features/ssh-agent.md) | Local owner-only socket/pipe, explicit signature confirmation and destination constraints; FIDO2 adapters come later. |
| **Planned** | [AI assistant](features/ai-assistant.md) | Local model first, optional remote providers behind a provider-neutral interface, read-only tools first, previews and approvals, privacy controls, and auditability. |
| **Investigate** | Universal shell-native completion | `/Var` + Tab → `/var` remains remote shell behavior. Voltius only intercepts Tab for opt-in trusted remote path drafts and does not claim exact shell-native completion on every SSH host. |

## Shell completion versus client suggestions

The `/Var` + Tab → `/var` example is shell-side behavior: the remote shell, its completion configuration, and the remote filesystem decide whether that completion is valid. A client-side layer can still observe local terminal input and history, rank suggestions, and optionally use shell integration when available. It must not present those suggestions as universal remote completion.

The Voltius approach is additive:

1. Keep the remote shell authoritative for execution and shell-native completion.
2. Offer client-side suggestions from local input/history and, when explicitly enabled, bounded SFTP names from the active SSH session.
3. Detect whether optional shell integration is available before asking for richer signals.
4. Degrade to ordinary terminal input when the remote shell, wrapper, or capability probe does not cooperate.

## Shell integration boundary

The current integration includes **OSC 7 cwd tracking** and an implemented,
capability-aware **OSC 133** slice. Command blocks are not assumed from OSC 7:

- probe or negotiate support where possible;
- provide bash, zsh, fish, and PowerShell wrappers where wrappers are safe and applicable;
- parse xterm OSC markers defensively;
- use explicit markers and command history as fallbacks;
- preserve a normal terminal when a shell or host rejects the integration.

OSC 133 degrades to ordinary terminal behavior for unsupported shells, wrapper
failures, multiplexers, replay output, alternate-screen applications, and serial
raw-byte sessions.

## Privacy and security notes

### Session logging

Session logging is **Implemented** for the common SSH, local-shell, and serial output path. It is local-only, opt-in, and output-only. It provides a user-selectable directory, retention and rotation controls, clear-one and clear-all controls, and a prominent warning that terminal output may contain secrets. Recordings are excluded from sync, telemetry, and bug-report bundles. A logging failure does not interrupt or fail the terminal session. Plugin-owned terminal surfaces that bypass `useTerminal.ts` are not covered by this slice.

### Terminal lifecycle notifications

Lifecycle destinations are device-local settings and are off by default. The current
signals are explicit terminal bells plus local, serial, and SSH session close events.
A disconnect is reported as a disconnect with unknown command completion; it is never
reported as a successful command. OS notification permission denial or platform
unavailability is isolated and falls back to the other destinations the user enabled.
The notification router deduplicates close events across reconnect/reattach and bell
events across split/broadcast delivery. OSC 133 block state is deliberately
separate from lifecycle notifications; disconnects and unknown blocks never
produce a successful command notification.

### Snippets and command history

Snippet selection now opens an explicit preview for script snippets before either
Insert or Execute, including scripts with no variables. The resolved payload used for
injection is kept separate from the rendered preview; password variables and
secret-like names are masked in the preview. Multi-step snippets continue through
the existing sequence prompt and run path. Execute rechecks the active session and
the current broadcast topology when the action is pressed, and the preview shows the
current execute target count when more than one target is involved.

Command history remains device-local and bounded to the existing 500-entry store
policy. Search ranks command text first, then session/connection labels, using
subsequence, word-boundary, contiguous-match, and recency signals. The picker does
not claim shell-native reverse search and deliberately does not bind Ctrl+R, so the
remote shell keeps that shortcut. Existing removal, clear-all, copy, Insert, and
Execute actions remain available.

The bounded local policy does not solve detection or redaction of secrets entered at
remote password prompts. Users should continue to avoid treating local command
history as a secret store.

### SSH agent security

The current agent-forwarding feature proxies the operating system's SSH agent through the SSH connection. Private keys do not leave the agent, but a trusted remote can request signatures from that agent; forwarding must therefore be treated as a trust decision per host.

A future built-in Voltius agent is a different feature. It should use a local owner-only socket/pipe, require explicit confirmation and destination constraints for signing, and add FIDO2 adapters only in a later step. It must not silently replace or broaden current OS-agent forwarding.

### Zmodem

Zmodem is **Experimental / Unverified** within a deliberately narrow desktop
boundary. The opt-in runtime path uses a standards-oriented CRC16 parser and
keeps live SSH transport bytes ahead of terminal rendering, logging, history,
and broadcast. Restore/replay output is historical UI rendering, not a live
protocol guarantee. Remote metadata is untrusted; offers are validated and
written through an opaque, session-bound native temporary handle before
no-overwrite finalization. Live interoperability with standard `rz`/`sz` has
not been proven because neither binary is installed locally. The remaining
verification command is to install a standard implementation (for example,
`brew install lrzsz` on macOS), then run reciprocal `rz` and `sz` transfers
against a supported interactive SSH session. Serial, local PTY,
multiplayer/broadcast, persistent tmux/screen, Android/iOS, CRC32, resume,
directory, and overwrite paths are not implemented. Source metadata and each
read are revalidated, but filesystem changes can still create TOCTOU failures.

### AI assistant

The AI assistant is **Planned**. The initial design must prefer a local model, permit optional remote providers through a provider-neutral interface, start with read-only tools, preview commands/actions before execution, and require per-action approval. Users need controls for secrets, host data, and terminal output, plus an audit log. The assistant must not receive automatic private-key or vault access.

## What is explicitly not implemented

- Universal command start/finish detection. OSC 133 is best-effort and does not cover every shell, multiplexer, replay stream, TUI, or serial protocol.
- OSC 133 command-finished notifications. Existing lifecycle notifications remain separate; an unknown/disconnected command is never reported as successful.
- Shell-native history synchronization or a guarantee that password prompts are redacted from local history.
- Universal remote shell autocomplete. The implemented picker combines local history with opt-in remote path suggestions, inserts text only, and only claims Tab in safe trusted SSH path contexts.
- Inline terminal snippet expansion as a separate input feature; explicit previews are implemented through the existing managed-snippet surfaces.
- Zmodem live interoperability with standard `rz`/`sz` is not yet verified; serial, local PTY, multiplayer/broadcast, persistent tmux/screen, or mobile sessions; CRC32, resume, directory, and overwrite paths remain outside the boundary. Filesystem TOCTOU changes remain possible despite source revalidation.
- A built-in Voltius SSH agent or FIDO2 adapter.
- An AI assistant with model providers, command approval, or assistant-specific privacy controls.
- A guarantee of `/Var` + Tab → `/var` completion on arbitrary remote shells.

## Repository anchors

These are verification anchors for maintainers, not an exhaustive API index.

| Area | Representative paths |
| --- | --- |
| SSH, persistence, forwarding, reconnect | `src/services/ssh.ts`, `src-tauri/src/ssh/client.rs`, `src-tauri/src/shell_integration.rs`, `src/stores/reconnectBackoff.ts` |
| Terminal, panes, broadcast, history, lifecycle notifications | `src/hooks/useTerminal.ts`, `src/services/terminalLifecycleNotifications.ts`, `src/components/panes/`, `src/components/terminal/HistoryPanel.tsx`, `src/stores/commandHistoryStore.ts` |
| Snippets and variables | `src/services/snippetParser.ts`, `src/services/snippetInject.ts`, `src/services/snippetSequence.ts`, `src/components/snippets/` |
| SFTP and tar transfers | `src/components/filetransfer/`, `src/services/sftpTransferCore.ts` |
| Host tools and integrations | `src/plugins/docker/`, `src/plugins/proxmox/`, `src/plugins/monitoring/`, `src/plugins/process-manager/`, `src/mcp/` |
| Themes, known hosts, import/config | `src/components/theme-creator/`, `src/services/knownHosts.ts`, `src/services/import-export/`, `src-tauri/src/storage/config.rs` |
