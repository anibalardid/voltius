# Zmodem transfers

**Status: Experimental / Unverified.** Voltius contains a guarded, opt-in
desktop Send and Receive path for one ordinary interactive SSH session. The
wire implementation is designed around standard CRC16 ZMODEM framing, but live
interoperability with standard `rz`/`sz` is not claimed: neither binary is
installed in the current verification environment.

## Quick path

1. Enable **Experimental Zmodem transfers** in Terminal settings and read the
   privacy warning.
2. In a supported SSH session, choose **Send** to select local files, or choose
   **Receive** before asking the remote host to send a file.
3. Review every remote offer, choose a native destination, and cancel from the
   transfer bar when needed.

## Verified boundary

| Area | Guarded behavior |
| --- | --- |
| Sessions | Interactive SSH only; non-persistent channels on Linux, macOS, and Windows desktop. |
| Send | Native multi-file picker, up to 10 regular files, bounded chunks, and the fixed remote command `rz`, with no remote filename interpolation. |
| Receive | Explicitly armed detector, one visible offer at a time, explicit destination selection, and no automatic acceptance. |
| Files | Maximum 256 MiB per file; remote names are validated as single safe names. Native receive temp files use opaque handles bound to the session and selected destination. |
| Finalization | A completed transfer is published with a same-filesystem hard link that refuses an existing destination. Partial files are removed on cancel, reject, protocol failure, and storage failure; failed native deletion retains opaque manager state for retry. |
| Protocol | Incremental CRC16 hex/binary headers, one-or-more-ZPAD binary framing, shared ZDLE quoting for headers/data/CRC, canonical cancellation, bounded data subpackets, continuation semantics, and multi-file outcome handling. CRC32 frames are rejected safely. |
| Terminal seam | Live SSH transport bytes are demultiplexed before terminal rendering, session logging, command history, or broadcast. Protocol bytes are never live terminal output. Restore/replay output is historical UI rendering, not a live protocol guarantee. Async protocol events are serialized before native writes or commit. |

## Unsupported or unverified

- Reciprocal interoperability with standard `rz`/`sz` remains unverified. The
  remaining command is to install a standard implementation (for example,
  `brew install lrzsz` on macOS) and run reciprocal `rz` and `sz` transfers
  against a supported interactive SSH session.
- Serial, local PTY, multiplayer/broadcast, and persistent `tmux`/`screen`
  sessions are visibly disabled. Persistent and broadcast ownership semantics
  are intentionally deferred.
- Android and iOS are disabled. The same safe native destination contract must
  be implemented for SAF/document providers before mobile support is enabled.
- CRC32 variants, resume/restart, directories, and remote overwrite are not
  supported. Existing local destinations are never replaced.
- Source metadata and each source read are revalidated, but filesystem changes
  can still create TOCTOU failures; this guarded path does not remove that
  limitation.
- Native manager state is retained when cleanup after publication fails so a
  later abort can retry it. Deterministic injection of that post-publication
  deletion failure is OS/filesystem-specific and is not covered by the native
  unit tests.
- The receive action must be armed before the remote offer arrives. Voltius
  does not scan inactive sessions for protocol traffic.

## Safety and privacy

- The setting is off by default. Send requires native file selection and
  Receive requires a visible user decision for every offer.
- Names containing absolute paths, `..`, separators, NUL/control characters,
  reserved device names, or excessive length are rejected. File count and size
  limits are enforced before accepting an offer or reading a source.
- Remote names are displayed metadata and suggested save names only. Native
  temp operations use app-generated opaque handles and a session/destination
  binding; the frontend cannot submit an arbitrary temp path.
- Live SSH transport bytes do not enter terminal rendering, session logging,
  command history, or broadcast. Restore/replay output is historical UI
  rendering and is not a live protocol guarantee. A malformed frame enters a
  serialized cleanup/fail path and restores ordinary terminal handling.

## Verification anchors

- Raw demux, framing, quoting, parser vectors, session outcomes, async ordering,
  and policy limits: `src/services/zmodem.test.ts`
- Protocol and native file adapter: `src/services/zmodem.ts` and
  `src-tauri/src/commands/zmodem.rs`
- Terminal seam: `src/hooks/useTerminal.ts`
- Opt-in setting and transfer controls:
  `src/stores/terminalSettingsStore.ts`,
  `src/components/settings/sections/TerminalSection.tsx`, and
  `src/components/terminal/ZmodemTransferBar.tsx`
