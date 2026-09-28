# Snippet previews and Voltius local history

This slice makes managed terminal snippets deliberate to use and makes local command history easier to search without pretending to replace the remote shell.

## Quick path

1. Choose a script snippet from the terminal Snippets panel or Omni.
2. Review the display-safe preview, fill any variables, then choose **Insert** or **Execute**.
3. Open **History** to search Voltius local history; use arrows and Enter to select and insert, or Shift+Enter/the row Execute action to execute.

## Snippet behavior

- Script snippets always open an explicit preview, including scripts without variables.
- Resolved injection text is separate from the display preview. Password variables and secret-like names are masked before rendering.
- Insert pastes into the selected session without submitting the command. Execute submits through the existing injection path.
- Execute validates the active session and current broadcast target set when pressed. A multi-target execute preview shows the target count.
- Multi-step and transfer snippets retain the existing sequence preview/prompt/run path; they are not flattened into one terminal command.
- Omni script selection uses the same explicit global preview path and retains existing variable prompts.

## History behavior

History uses the existing `useCommandHistoryStore` and `HistoryPanel`. The picker ranks command text first, then session and connection labels, with subsequence matching, contiguous and word-boundary bonuses, and recency tie-breaking. An empty query keeps recent entries first.

Connection filtering, copy, Insert, Execute, remove, and clear-all remain available. **Voltius local history** is device-local and bounded by the existing 500-entry store policy. It is not shell-native history, and Ctrl+R is intentionally left to the remote shell's reverse-i-search.

The policy does not detect or redact commands typed into remote password prompts. Do not treat local history as a secret store.

## Explicitly out of scope

The separate OSC 133 command-block and explicit Voltius-local suggestion slices are implemented. This snippet/history slice does not add exact shell-native completion or inline completion; safe opt-in remote path Tab interception remains a separate terminal feature. Zmodem, AI assistance, and a built-in SSH agent are also outside this slice.
