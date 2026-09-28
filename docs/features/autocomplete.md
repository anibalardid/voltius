# Client-side terminal suggestions

Voltius provides an explicit picker for conservative local command-history
suggestions and opt-in remote path suggestions. Open it with the **Terminal
Suggestions** shortcut shown in Settings (Ctrl+Shift+Space by default), then use
the arrow keys and Enter. In an enabled, trusted interactive SSH path draft,
unmodified Tab opens or refreshes the same picker; Tab accepts the selected
suggestion when one is already available.
Enter inserts the selected command into the current draft only. Tab and Enter do not
send a newline, execute a command, install a remote package, or alter the
remote shell's completion configuration. Escape dismisses the picker.

Suggestions reuse the existing bounded Voltius command history and are scoped
to the current session/connection context. Secret-like commands are excluded
from the suggestion list. Local results are labeled **Local history**.
Remote path results are available only when the separate **Remote path completion**
setting is enabled; they use the active SSH session's bounded SFTP directory
listing and never open a second SSH connection.

The trusted draft model accepts only printable input, backspace, Enter, Ctrl-C,
and Ctrl-U. Escape sequences, arrow/history navigation, uncertain cursor state,
connection loss, alternate-screen/full-screen TUIs, mouse tracking, serial
sessions, and multiplayer sessions disable the picker. A blank result is the
safe fallback.

Remote path completion is limited to trusted interactive SSH drafts and the
cursor at the end of the draft. Absolute paths can be completed before cwd is
known; relative paths wait for a known cwd. Multiplayer, broadcast, serial,
local, alternate-screen, mouse-tracked, disconnected, uncertain-cursor, and
unsafe-path contexts leave Tab owned by the shell without a remote request.
Persistent SSH sessions use the active SFTP channel too. The explicit shortcut
remains available as a fallback. `/Var` → `/var` remains a remote
shell/filesystem completion case and is not promised on arbitrary SSH hosts.
