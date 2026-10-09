# iOS Resume Viewport and Device Deploy

Feature: `ios-resume-viewport-device-deploy`
Branch: `fix/ios-resume-viewport-device-deploy`
Status: in progress

## Goal

Keep the mobile shell correctly aligned after an iOS background/foreground cycle and provide a verified physical-device deployment path that bypasses tauri-apps/tauri#14593.

## Acceptance criteria

- Focusing host IP/port remains correctly aligned.
- Returning from the background resets stale keyboard viewport geometry.
- The viewport lifecycle regression is covered by a deterministic test observed RED then GREEN.
- Menu option 10 uses the archive/export/install/launch workaround instead of broken `tauri ios run` export.
- The physical-device script completes build, archive, export, install, and launch on `iPhone Anibal`.
- Existing focused frontend/mobile checks and the iOS build check pass.

## Tasks

- [x] 1. Add a failing foreground-resynchronization test, then minimally fix `useVisualViewport`.
  - Evidence: RED retained `usableHeight: 460` / `offsetTop: 220` for both lifecycle events; GREEN `pnpm vitest run src/hooks/useVisualViewport.test.ts src/hooks/visualViewportCore.test.ts` passed 2 files / 3 tests.
  - Commit: `a9bda9bd7d0d57b791a46d7b0a71fcdf6103fea7` (`fix(mobile): resync viewport after iOS resume`)
- [x] 2. Finish the physical-device deployment script and route menu option 10 through it.
  - Evidence: menu option 10 invokes the workaround; syntax checks pass; auto-detection now prefers an iPhone; `./scripts/ios-run-device.sh "iPhone Anibal"` completed build, archive, export, install, and launch with exit 0.
  - Commit: this work unit (`fix(ios): deploy physical devices around tauri export bug`)
- [x] 3. Run focused checks, full iOS build check, and full physical-device deployment.
  - Evidence: viewport tests passed 2 files / 3 tests; physical iPhone build/archive/export/install/launch passed; `ios-build-check.sh` passed frontend + device Rust + simulator bundle; user confirmed IP/port → background → foreground returns full and aligned. Full suite: 459 files / 3413 tests passed; 2 unrelated failures remain (`SFTPTypes.format` timezone expectation and `pluginCatalogPublish` spaced-path guard).
  - Commit: N/A (verification-only)

## Blockers

- Human observation is required for the physical viewport alignment after resume.
- The pre-existing full-suite failures are outside this feature's changed paths and remain unresolved.

## Current diagnosis

`src/hooks/useVisualViewport.ts` measures on visual viewport resize/scroll and window resize only. iOS can restore the WebView from background without emitting those events, leaving the shell with stale keyboard height/offset. Existing project lifecycle patterns re-evaluate on both `window.focus` and visible `document.visibilitychange`.

## Notes

- `graphify` is unavailable in this shell (`command not found`), so source navigation used bounded direct reads.
- The first `gentle-ai-explore` attempt failed before returning evidence; the parent performed a bounded inline fallback.
- No push, PR, or merge is authorized.
