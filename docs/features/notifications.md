# Terminal lifecycle notifications

Voltius can surface reliable terminal lifecycle signals through three independent,
device-local destinations:

- **Terminal feedback** — writes a short status line into the affected xterm display.
- **In-app notification center and toast** — uses the existing notification store,
  toast container, and notification center.
- **System notification** — uses the official Tauri v2 notification plugin when the
  platform and permission allow it.

All three destinations are off by default and can be enabled independently in
**Settings → Terminal**. If system delivery is unavailable or permission is denied,
Voltius continues terminal I/O and tries the other destinations the user enabled.

## Signals in this slice

The signal contract is intentionally separate from delivery. The current adapters
publish:

- an explicit terminal bell;
- local shell exit;
- serial connection close;
- SSH remote exit; and
- SSH disconnect.

An SSH disconnect is presented as **command completion unknown**. It is never turned
into a successful command notification. Command-finished notifications require a
future notification-specific signal with an explicit exit status. The implemented
OSC 133 slice tracks best-effort command blocks separately, so it does not turn
block parsing into a lifecycle notification.

## Deduplication

Close notifications use the logical session id and remain deduplicated while a
reconnect or persistent-session reattach is in progress. A new close episode becomes
eligible after the session reaches a fresh connected state. Explicit bells carry an
event id; broadcast bells share a broadcast-group key, so split panes and broadcast
delivery do not multiply the same alert.

## Scope exclusions

The first OSC 133 command-block and explicit Voltius-local suggestion slices are
implemented separately. This notification slice does not add exact shell-native
completion, inline completion, or Tab interception; those advanced autocomplete
behaviors remain planned or under investigation. Zmodem, AI, and a built-in
SSH-agent are also outside this slice. OSC 133 remains capability-degraded:
unsupported shells, multiplexers, replay output, alternate-screen applications,
serial/raw-byte sessions, and wrapper failures remain ordinary terminal behavior.
It also does not infer command completion from output quietness, session
disconnects, reconnects, or persistent-session reattachments.
