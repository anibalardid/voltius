# Voltius product roadmap

This roadmap turns the feature gaps in the [canonical feature catalog](features.md) into ordered implementation slices. **Implement one slice at a time.** A later slice may be designed early, but it should not be implemented in parallel with an earlier slice unless the slice explicitly says it is a dependency seam.

## How to read this roadmap

- `[x]` means the documentation/baseline item is complete in the repository.
- `[ ]` means planned work, not an existing capability.
- Acceptance checkboxes are completion criteria, not promises that the feature already exists.
- Dependencies name the smallest prior seam needed to start implementation.
- Risks are product and security risks to resolve during the slice, not reasons to skip the slice.

## Ordered slices

### 0. Documentation and baseline

- [x] Publish the canonical feature catalog and this ordered roadmap.
- [x] Separate **Implemented**, **Planned**, and **Investigate** status.
- [x] Record the current OSC 7 boundary, existing command history/snippet surfaces, and the security distinction between OS-agent forwarding and a future built-in agent.

**Acceptance criteria**

- [x] Every requested feature is classified without claiming an unimplemented feature exists.
- [x] The root README links to both canonical documents.
- [x] Privacy and security constraints are visible next to the affected roadmap items.

**Dependencies:** Repository inspection and current implementation anchors.

**Risks:** Documentation drift; update the catalog when a slice ships rather than silently changing the roadmap status.

### 1. Local session logging

- [x] Add an explicit opt-in setting and a clear privacy warning.
- [x] Log terminal output only in the first slice; do not capture input, keystrokes, or secrets by default.
- [x] Let the user select the app-data directory/path and show the active location.
- [x] Add retention and rotation controls plus clear-one and clear-all actions.
- [x] Keep logs local-only: exclude them from sync, telemetry, and bug-report inclusion.
- [x] Isolate failures so an unwritable path, full disk, or malformed output cannot break the terminal session.

**Acceptance criteria**

- [x] A new installation produces no log until the user opts in.
- [x] A user can identify, change, rotate, and delete log files from Terminal settings without leaving the application.
- [x] Tests cover raw bytes, path failure, rotation, clear operations, and the guarantee that terminal I/O continues when logging fails.
- [x] Privacy review confirms no log data crosses a sync, telemetry, or diagnostics boundary.

**Dependencies:** Existing terminal output event paths; slice 0 documentation baseline.

**Risks:** Secrets in command output, disk growth, filesystem permissions, platform-specific app-data paths, and accidental inclusion in support bundles.

### 2. Terminal lifecycle notifications

- [x] Define a terminal lifecycle signal contract independent of any one notification destination.
- [x] Support terminal, in-app, and system notification destinations as separate user-configurable choices.
- [x] Make notifications capability-aware and state clearly when a host/shell cannot provide reliable completion signals.
- [x] Start with safe local signals; use richer remote command lifecycle signals only when the command-block seam is available.
- [x] Deduplicate notifications across reconnects, persistent reattachments, and split/broadcast sessions.

**Acceptance criteria**

- [x] A user can enable or disable each destination independently.
- [x] A command that cannot be classified does not produce a false “finished successfully” notification.
- [x] Reconnect, persistent-session reattach, cancellation, and broadcast behavior are covered by tests.
- [x] System notification permission denial degrades to the configured in-app or terminal destination.

**Dependencies:** Existing notification center; the lifecycle signal contract. The
best-effort command-block seam is supplied by slice 4, but lifecycle notifications
still require an explicit notification signal before reporting command success.

**Risks:** False positives, duplicate alerts, platform permission differences, and confusing a remote disconnect with successful command completion. OSC 133 now supplies best-effort block state and explicit exit status where the shell cooperates; lifecycle notifications remain separate and do not claim success for unsupported or unknown states.

### 3. Terminal snippets and history

- [x] Design and implement a terminal-safe snippet expansion interaction using the existing managed snippets and variable model.
- [x] Keep expansion explicit and previewable; do not silently rewrite arbitrary terminal input.
- [x] Add a fuzzy history picker over the existing local command history.
- [x] Preserve connection/session context and make insert versus execute visibly distinct.
- [x] Document the bounded local retention policy and the remaining password-prompt redaction limitation.

**Acceptance criteria**

- [x] A user can invoke a picker, filter snippets/history fuzzily, preview the selected command, and choose insert or execute.
- [x] Variable prompts, password-like variables, multiline content, and broadcast targets have focused coverage.
- [x] History remains local and bounded by a documented policy; clear/remove actions remain available.
- [x] The UI distinguishes Voltius-local history from the remote shell's history.

**Dependencies:** Existing snippet parser/injection and command-history store/panel; slice 1 privacy policy where logging/history overlap.

**Risks:** Accidental execution, secret leakage into history (especially password prompts, which are not automatically redacted), multiline quoting, shell differences, and unintended broadcast execution. The shipped path revalidates targets at action time and does not add Ctrl+R interception.

### 4. OSC 133 command blocks

This slice is implemented. It is deliberately capability-degraded: supported
bash, zsh, fish, and PowerShell paths get bounded block state, while unsupported
shells, multiplexers, replay, alternate-screen applications, serial/raw-byte
sessions, and wrapper failures remain ordinary terminal behavior.

- [x] Add capability detection rather than assuming OSC 133 support.
- [x] Define command start, prompt/ready, command end, and exit-status semantics for supported shells.
- [x] Provide maintained wrappers or setup paths for bash, zsh, fish, and PowerShell where safe.
- [x] Parse xterm OSC markers defensively and preserve ordinary output when markers are malformed or absent.
- [x] Fall back through explicit markers and command history when wrappers or shell cooperation are unavailable.
- [x] Keep block state separate from lifecycle consumers without making blocks a prerequisite for ordinary terminal use.

**Acceptance criteria**

- [x] Supported shells expose best-effort block boundaries and exit status through wrapper and parser tests.
- [x] Unsupported shells, restricted shells, remote Windows sessions, serial/raw-byte sessions, and wrapper failures continue as normal terminals.
- [x] Malformed or hostile OSC input cannot corrupt the terminal state or execute a command.
- [x] Restore replay and reconnect generations do not create duplicate or stale block state; tmux/screen remains degraded/unknown.

**Dependencies:** Current OSC 7 shell-integration seam; slice 2 lifecycle contract; slice 3 history semantics.

**Risks:** Shell startup breakage, multiplexer filtering, prompt customization, OSC injection, and incorrect lifecycle state after reconnect.

### 5. Client-side autocomplete

- [x] Add a suggestion layer that observes local input and local history without taking ownership of shell execution.
- [x] Rank suggestions from the current input, local history, and connection context.
- [x] Treat optional shell integration as a capability, not a requirement.
- [x] Make acceptance, dismissal, and privacy boundaries keyboard-accessible and discoverable.
- [x] Add opt-in remote path completion through the active SSH session's bounded SFTP listing; safe unmodified Tab and the explicit picker share the insert-only trigger path.
- [x] Document that Tab remains owned by the remote shell outside the opt-in trusted interactive SSH path context because the client cannot safely distinguish every shell/TUI editing mode.

**Acceptance criteria**

- [x] Suggestions never modify or execute input without an explicit user action.
- [x] `/Var` + Tab → `/var` remains a remote-shell completion case; Voltius remote path completion uses safe opt-in Tab interception plus an explicit insert-only picker fallback.
- [x] Unknown shells, offline hosts, password prompts, full-screen TUIs, and raw-byte protocols receive a safe fallback.
- [x] Input/history privacy and secret filtering are covered by tests and visible local-only labeling.

**Dependencies:** Slice 3 history/picker semantics and slice 4 capability/lifecycle signals where available.

**Risks:** False confidence in suggestions, leaking sensitive input into local indexes, interference with readline/zsh/TUI editing, and latency while typing.

### Future host and global aliases — Roadmap only

- [ ] Allow aliases to be inserted into hosts.
- [ ] Make aliases configurable per host.
- [ ] Support global aliases.
- [ ] Let each host independently opt into global aliases.
- [ ] Keep global-alias use **OFF by default**.
- [ ] Design alias collision and precedence rules before implementation.

### 6. [Zmodem transfers](features/zmodem.md) — Experimental / Unverified

- [x] Add an explicit opt-in setting and a visible consent flow for remote offers.
- [x] Create a raw-byte xterm seam that can temporarily suspend ordinary text interpretation.
- [x] Treat remote offers as untrusted; validate protocol state and write only to safe temporary files.
- [x] Use the native save picker on desktop; gate Android SAF and iOS until the same safe destination contract exists.
- [x] Support cancellation, timeout, cleanup, and partial-transfer recovery semantics.
- [x] Keep broadcast and persistent-session support out of the first slice.
- [x] Add canonical CRC16/framing vectors for the guarded implementation.
- [ ] Prove reciprocal interoperability with standard `rz`/`sz` binaries.

**Acceptance criteria**

- [x] No receive transfer starts without explicit user consent and a selected destination; Send requires a native source selection.
- [x] Cancel, reject, malformed input, disconnect, and cleanup paths are bounded by the protocol adapter and native temp-file seam.
- [x] Normal terminal output resumes correctly after success, rejection, or failure.
- [x] The UI clearly says that persistent sessions, broadcast, non-SSH sessions, and mobile platforms are unsupported for the first release.
- [ ] Reciprocal `rz`/`sz` send and receive transfers pass on a supported desktop SSH session.

**Dependencies:** Terminal raw-byte seam and safe native file-picker abstractions. The guarded adapter intentionally supports CRC16 only; CRC32, resume, directory, and mobile document-provider work are later slices. Live verification requires a standard `rz`/`sz` installation; none is currently available in the development environment.

**Risks:** Remote-provided filenames, path traversal, terminal desynchronization, binary/text boundary errors, storage permission failures, unverified external interoperability, and ownership semantics in sessions shared through a multiplexer or broadcast. The first release bounds these by disabling the affected session types rather than guessing.

### 7. [Built-in SSH agent and later FIDO2 adapters](features/ssh-agent.md)

- [ ] Keep current OS-agent forwarding behavior documented as a separate capability.
- [ ] Design a built-in Voltius agent around a local owner-only socket/pipe.
- [ ] Require explicit signature confirmation and destination constraints for each signing request.
- [ ] Define key import, lifetime, locking, audit, and recovery behavior without exposing private keys to remote hosts.
- [ ] Add FIDO2 adapters only after the local agent contract and confirmation model are stable.

**Acceptance criteria**

- [ ] A trusted remote can never use the built-in agent without the policy/confirmation path being applied.
- [ ] Socket/pipe permissions prevent other local users or processes from silently using the agent.
- [ ] Forwarding, built-in-agent, denied-signature, and reconnect cases are distinguishable in the UI and audit trail.
- [ ] FIDO2 support is explicitly versioned as a later adapter, not implied by the first built-in-agent slice.

**Dependencies:** Secure local IPC, secret/key storage boundaries, and audit model.

**Risks:** Confused-deputy attacks, local privilege boundaries, confirmation fatigue, agent lifetime, hardware portability, and compatibility with existing SSH tooling.

### 8. [AI assistant](features/ai-assistant.md)

- [ ] Define a provider-neutral interface with a local model as the first provider and optional remote providers behind explicit configuration.
- [ ] Start with read-only tools and terminal/context inspection that is scoped to the active user choice.
- [ ] Preview commands and actions; require per-action approval before execution.
- [ ] Add controls for secrets, host metadata, and terminal output, with safe defaults and clear data-flow copy.
- [ ] Record assistant actions and approvals in an audit log without automatically exposing private keys or vault contents.
- [ ] Evaluate multiple entry points: terminal side panel, command palette, selection/context action, error action, and settings/provider page.

**Acceptance criteria**

- [ ] Local-only use works without a remote provider or account.
- [ ] Every mutating action is previewed, attributable, and individually approved.
- [ ] Read-only scope, secret redaction, host/output privacy, and provider selection are visible before context leaves the device.
- [ ] No assistant path receives automatic private-key or vault access.
- [ ] The UI decision records why each entry point is included or deferred.

**Dependencies:** Existing local MCP/tool surfaces, terminal capture boundaries, audit logging, and the privacy controls established by earlier slices.

**Risks:** Data exfiltration to remote providers, prompt injection through terminal output, destructive commands, secret exposure, provider outages, and ambiguous responsibility between the assistant and the user.

## Delivery rule

After each slice, update [the feature catalog](features.md), its status, acceptance evidence, and any security notes before beginning the next slice. Do not mark a feature **Implemented** because a design, prototype, or provider hook exists; mark it only when the user-facing behavior and its failure/security boundaries are verified.
