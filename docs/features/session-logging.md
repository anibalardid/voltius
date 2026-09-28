# Local session logging

Session logging is an explicit opt-in recording of terminal **output bytes**. It is designed for local review and troubleshooting without making terminal input part of the recording contract.

## User controls

- Logging is off by default and is enabled from **Settings → Terminal**.
- The active directory is shown in the same panel. The default is a Rust-resolved `app_data_dir/session-recordings` path, never the application log directory.
- A native directory picker can select a custom local directory. The application log directory is rejected so diagnostics cannot collect recordings accidentally.
- Users can adjust maximum file size, total retained size, and maximum age.
- Users can list recordings, clear one recording, or clear all recordings. Each destructive action requires confirmation. Clear-all closes and deletes active files; output that arrives later from a still-running session starts a new recording, never an unlinked open file.

## Privacy contract

- The recorder receives only raw output bytes from the shared SSH, local-shell, and serial output callbacks in `useTerminal.ts`.
- Typed input, keystrokes, command history, passwords, and input bytes are not passed to the recorder. The existing command-history feature remains a separate product surface and is not part of these files.
- Recording filenames contain only a generated UUID and timestamp. They do not contain hostnames, connection names, shell paths, or secrets.
- Files are written locally with owner-only permissions where the platform supports them. Logging settings use serialized atomic staged writes with unique sibling temp files; streaming recording files are bounded by rotation/retention cleanup, including active files in the total-size budget while never deleting an open active file.
- Recordings are not included in diagnostics: bug reports read `app_log_dir`, while the default recording directory is separate. Recordings are also excluded from user-data export/import because the logging preference is kept in a dedicated local-only store and no recording bytes are part of an app-settings handler.
- No recording command sends data remotely. A custom directory is user-selected local storage; operating-system folder synchronization outside Voltius remains outside the application's control.

## Failure and coverage boundary

Recording calls are fire-and-forget and swallow backend/filesystem failures. An unwritable path, full disk, malformed output bytes, or failed cleanup therefore cannot interrupt terminal rendering or transport writes.

The first slice covers the common output path currently used by SSH, local, and serial sessions. Workspace restore scrollback has a separate SSH event so it repopulates xterm without becoming a duplicate recording. The feature does not claim coverage for plugin-owned terminals or terminal-like output that bypasses `useTerminal.ts`.
