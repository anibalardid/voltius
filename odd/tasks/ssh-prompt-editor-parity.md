# SSH prompt editor parity

## Objective

Make SSH Tab completion and Ctrl+D behave like Warp's no-remote-install legacy SSH mode: Voltius owns the local prompt/editor interaction, does not forward an eligible Tab to readline, and closes an intentionally exited SSH session without entering reconnect backoff.

## Problem

Voltius currently mirrors the remote shell's input heuristically. When the draft or cursor trust gate is false, Tab is forwarded to the remote shell, which emits BEL and Voltius renders a warning. Ctrl+D is only classified as intentional when the same fragile draft state is trusted; otherwise persistent SSH treats the close as unexpected and starts the spinner.

## Constraints

- Preserve shell/TUI input, broadcast mode, unsafe cursor positions, and explicit user opt-out behavior.
- Do not install software on remote servers.
- Keep SFTP path listing bounded and safe.
- New installations and legacy settings without an explicit opt-out must enable remote path completion; an explicit user opt-out remains disabled.
- Do not change unrelated dirty work in the current worktree.
- User requested no commit or push; verification must be recorded without creating a commit.

## Authorized scope

- `src/hooks/useTerminal.ts`
- `src/services/remotePathCompletion.ts`
- `src/hooks/useTerminal.searchChords.test.tsx`
- `src/hooks/__fixtures__/fakeXterm.ts`
- `src/stores/terminalSettingsStore.ts`
- `src/stores/terminalSettingsStore.remotePathCompletion.test.ts`
- `src/components/settings/sections/TerminalSection.tsx`
- `src/plugins/domains/settingsManifest.ts`
- `src/plugins/domains/settingsManifest.test.ts`
- `src/services/user-data/handlers/appSettings.remotePathCompletion.test.ts`
- `src/stores/reconnectBackoffCore.ts` only if a focused regression proves the close policy itself is wrong
- `odd/tasks/ssh-prompt-editor-parity.md`

## Checklist

- [x] `SSH-1` Make an eligible SSH path input (`/`, `/Va`, `cd /Va`) claim Tab locally and request the correct SFTP directory without sending byte `0x09` to the shell. Route: delegated direct writer after exploration. Check: focused Vitest regression.
- [x] `SSH-2` Make empty-prompt Ctrl+D use the same terminal-close outcome as the X action, without reconnect spinner; retain pass-through for non-empty, alternate-screen, mouse-tracking, and broadcast contexts. Route: delegated direct writer after exploration. Check: focused Vitest plus reconnect-core regression if needed.
- [x] `SSH-3` Verify the focused tests, TypeScript checks, diff hygiene, and graph/index maintenance. Route: delegated verification. Check: exact command results recorded below.
- [x] `SSH-4` Migrate remote path completion settings with a durable explicit-configuration marker, make the store the only completion gate authority, and align Settings/plugin defaults with the new default-on behavior. Check: focused red-green Vitest coverage for new/legacy defaults, explicit false merge/import, and `/`, `/Va`, `cd /Va` Tab handling.
- [x] `SSH-5` Keep safe SSH Tab local when the mirrored draft is empty/stale, and recover draft tracking from the next printable input so one failed shell Tab cannot poison all later completion attempts. Check: focused key-handler tests prove no `0x09` reaches SSH and `/` still requests SFTP after stale state.

## TDD / verification

- Effective TDD mode: not established in this document; use the existing project test conventions and red-green tests at the terminal key-handler seam.
- Required focused checks: `npx vitest run src/hooks/useTerminal.searchChords.test.tsx src/services/remotePathCompletion.test.ts src/stores/reconnectBackoff.test.ts`
- Required static checks: project TypeScript check and `git diff --check`.
- No commit/push in this task because the user explicitly prohibited them.

## Progress

- Exploration complete: Warp's legacy SSH wrapper takes over the prompt/input editor locally and provides completions without installing on the remote host. Voltius currently only mirrors draft state and forwards Tab when its gate fails.
- Existing worktree contains unrelated uncommitted feature work; only the authorized files above may be changed for this task.
- Implementation complete: `SSH-1`, `SSH-2`, and `SSH-4` now have focused red-green coverage; verification is recorded below.

## Verification

- Red: the new default-path Tab cases and stale-trust Ctrl+D case failed before the production changes.
- Migration red: `npx vitest run src/stores/terminalSettingsStore.remotePathCompletion.test.ts src/services/user-data/handlers/appSettings.remotePathCompletion.test.ts src/hooks/useTerminal.searchChords.test.tsx` — 6 tests failed and 35 passed before the store migration and localStorage hack removal.
- Migration green: the same focused command — 3 files, 41 tests passed.
- Full focused green: `npx vitest run src/hooks/useTerminal.searchChords.test.tsx src/services/remotePathCompletion.test.ts src/services/ssh.test.ts src/stores/terminalSettingsStore.remotePathCompletion.test.ts src/services/user-data/handlers/appSettings.remotePathCompletion.test.ts src/plugins/domains/settingsManifest.test.ts` — 6 files, 88 tests passed.
- Static: `npx tsc --noEmit` passed; `git diff --check` passed.
- Full suite: 469 files and 3,541 tests passed; two unrelated pre-existing failures remain in `src/components/filetransfer/SFTPTypes.format.test.ts` and `tests/pluginCatalogPublish.test.ts`.
- Graph: `graphify update .` was attempted but the `graphify` command is unavailable in this worktree environment.
- Runtime evidence after the previous implementation: `voltius.log` recorded `enabled=true`, `connected=true`, `cwd=/root`, `draft=""`, `cursorKnown=false`, and `canHandle=false` at the Tab handler. This proves the remaining failure is the local ownership gate, not remote SFTP matching or Terminal feedback rendering.
- SSH-5 red: `npx vitest run src/hooks/useTerminal.searchChords.test.tsx` — 2 new tests failed and 35 existing tests passed before the production edit.
- SSH-5 green: the same focused command — 37 tests passed; the required focused set (`useTerminal.searchChords`, `remotePathCompletion`, `reconnectBackoff`) passed with 69 tests.
- SSH-5 static checks: `npx tsc --noEmit` and `git diff --check` passed.
