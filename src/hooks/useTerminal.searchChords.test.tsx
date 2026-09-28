import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { getTerminalBlockController, getTerminalSearchController, getTerminalSuggestionController, useTerminal, type TerminalSuggestionSnapshot } from "@/hooks/useTerminal";
import { FakeSearchAddon, lastKeyHandler, resetFakeXterm, terminals } from "@/hooks/__fixtures__/fakeXterm";
import { useCommandHistoryStore } from "@/stores/commandHistoryStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useTerminalCwdStore } from "@/stores/terminalCwdStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { localSendInput } from "@/services/local";
import { onSshClosed, onSshOutput, sshListRemoteDir, sshSendInput, type RemoteDirectoryEntry } from "@/services/ssh";

// vi.mock is hoisted above every top-level binding, so each factory has to
// import the fixture itself rather than share a helper.
vi.mock("@xterm/xterm", async () => ({ Terminal: (await import("@/hooks/__fixtures__/fakeXterm")).FakeTerminal }));
vi.mock("@xterm/addon-fit", async () => ({ FitAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeFitAddon }));
vi.mock("@xterm/addon-webgl", async () => ({ WebglAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeWebglAddon }));
vi.mock("@xterm/addon-web-links", async () => ({ WebLinksAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeWebLinksAddon }));
vi.mock("@xterm/addon-search", async () => ({ SearchAddon: (await import("@/hooks/__fixtures__/fakeXterm")).FakeSearchAddon }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/services/ssh", () => ({
  sshSendInput: vi.fn(), sshResize: vi.fn(),
  onSshOutput: vi.fn(async () => () => {}), onSshRestoreOutput: vi.fn(async () => () => {}), onSshClosed: vi.fn(async () => () => {}), onSshCwd: vi.fn(async () => () => {}),
  sshListRemoteDir: vi.fn(),
}));
vi.mock("@/services/local", () => ({
  localSendInput: vi.fn(), localResize: vi.fn(), localReady: vi.fn(async () => {}),
  onLocalOutput: vi.fn(async () => () => {}), onLocalClosed: vi.fn(async () => () => {}),
}));
vi.mock("@/services/serial", () => ({
  serialWrite: vi.fn(), onSerialOutput: vi.fn(async () => () => {}), onSerialClosed: vi.fn(async () => () => {}),
}));
// Returning null keeps the clipboard out of the way: useTerminal forwards every
// key to it first and honours any non-null verdict.
vi.mock("@/components/terminal/terminalClipboard", () => ({
  attachTerminalClipboard: () => ({ handleKeyEvent: () => null, dispose() {} }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let sshClosedHandler: ((remoteExit: boolean) => void) | undefined;
let sshOutputHandler: ((data: Uint8Array) => void) | undefined;

function Harness({
  sessionId,
  sessionType = "local",
  onClosed,
}: {
  sessionId: string;
  sessionType?: "ssh" | "local" | "serial";
  onClosed?: (remoteExit: boolean, closeIntent?: string) => void;
}) {
  const { attach } = useTerminal({ sessionId, sessionType, onClosed });
  return <div data-testid="host" ref={attach} />;
}

const ctrlG = (type: "keydown" | "keyup", shiftKey = false) =>
  new KeyboardEvent(type, { key: shiftKey ? "G" : "g", ctrlKey: true, shiftKey });

const ctrlF = () => new KeyboardEvent("keydown", { key: "f", ctrlKey: true });

/** Both spies on one event, so a claim can be asserted as a pair. */
function watchClaim(e: KeyboardEvent) {
  return {
    prevented: vi.spyOn(e, "preventDefault"),
    stopped: vi.spyOn(e, "stopPropagation"),
  };
}

function setConnectedSession(sessionId: string, type: "ssh" | "local", overrides: Record<string, unknown> = {}) {
  useSessionStore.setState({
    sessions: [{
      id: sessionId,
      type,
      status: "connected",
      connectionId: "c1",
      connectionName: "Work",
      title: "Work",
      ...overrides,
    } as never],
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function waitForSuggestionSnapshot(
  picker: NonNullable<ReturnType<typeof getTerminalSuggestionController>>,
  predicate: (snapshot: TerminalSuggestionSnapshot) => boolean,
): Promise<TerminalSuggestionSnapshot> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const check = () => {
      const snapshot = picker.getSnapshot();
      if (!predicate(snapshot)) return;
      unsubscribe();
      resolve(snapshot);
    };
    unsubscribe = picker.subscribe(check);
    check();
  });
}

describe("terminal controllers", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [] });
    useCommandHistoryStore.setState({ entries: [], buffers: {} });
    useTerminalCwdStore.setState({ cwds: {} });
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: false });
    useToggleSettingsStore.setState({ values: {} });
    localStorage.removeItem("voltius-terminal-settings");
    vi.mocked(sshListRemoteDir).mockReset();
    vi.mocked(sshListRemoteDir).mockResolvedValue([]);
    vi.mocked(onSshClosed).mockReset();
    vi.mocked(onSshClosed).mockImplementation(async (_sessionId, callback) => {
      sshClosedHandler = callback;
      return () => {};
    });
    vi.mocked(onSshOutput).mockImplementation(async (_sessionId, callback) => {
      sshOutputHandler = callback;
      return () => {};
    });
    sshClosedHandler = undefined;
    sshOutputHandler = undefined;
    vi.mocked(localSendInput).mockClear();
    vi.mocked(sshSendInput).mockClear();
    useLayoutStore.setState({ broadcastActive: false, splitTabActive: false, root: null });
    resetFakeXterm();
  });

  // Returning false from the custom key handler makes xterm skip the key: it
  // encodes nothing and writes nothing to the PTY. With the search widget shut
  // that starved the shell of ^G — readline's abort, and the only way out of a
  // Ctrl+R reverse-i-search (#208).
  it("hands Ctrl+G to xterm while the search widget is closed", () => {
    render(<Harness sessionId="ctrl-g-closed" />);
    const handler = lastKeyHandler();

    expect(handler(ctrlG("keydown"))).toBe(true);
    expect(handler(ctrlG("keyup"))).toBe(true);
    expect(handler(ctrlG("keydown", true))).toBe(true);
  });

  it("drives an open search widget instead, and keeps the key from the shell", () => {
    render(<Harness sessionId="ctrl-g-open" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-g-open")!;
    search.open();
    // runSearch bails on an empty query, so a find is only observable with one.
    search.setQuery("needle");
    const addon = FakeSearchAddon.instances[FakeSearchAddon.instances.length - 1];
    addon.searches.length = 0;

    expect(handler(ctrlG("keydown"))).toBe(false);
    expect(handler(ctrlG("keydown", true))).toBe(false);
    expect(addon.searches).toEqual([
      { direction: "next", query: "needle" },
      { direction: "prev", query: "needle" },
    ]);

    // The chord stays consumed on the way back up, without moving the hit again.
    expect(handler(ctrlG("keyup"))).toBe(false);
    expect(addon.searches).toHaveLength(2);
  });

  // xterm returns early on a false verdict without cancelling the event, so a
  // chord the handler claims still bubbles to useKeyboard's window listener.
  // Ctrl+F and Ctrl+G are the two branches that sit above that listener's
  // isInput guard, so they are the two it would otherwise run a second time —
  // reopening the widget, or moving two hits per press.
  it("claims Ctrl+G so the window listener cannot move the hit twice", () => {
    render(<Harness sessionId="ctrl-g-claims" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-g-claims")!;

    const open = ctrlG("keydown");
    const claim = watchClaim(open);
    search.open();
    expect(handler(open)).toBe(false);
    expect(claim.stopped).toHaveBeenCalled();
    expect(claim.prevented).toHaveBeenCalled();

    // Closed, the shell owns the chord: xterm cancels it on the way out, so the
    // handler must leave the event alone rather than swallow it here.
    const closed = ctrlG("keydown");
    const passThrough = watchClaim(closed);
    search.close();
    expect(handler(closed)).toBe(true);
    expect(passThrough.stopped).not.toHaveBeenCalled();
    expect(passThrough.prevented).not.toHaveBeenCalled();
  });

  it("claims Ctrl+F, so only the terminal widget opens", () => {
    render(<Harness sessionId="ctrl-f-claims" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-f-claims")!;

    const e = ctrlF();
    const claim = watchClaim(e);
    expect(handler(e)).toBe(false);
    expect(search.getSnapshot().open).toBe(true);
    expect(claim.stopped).toHaveBeenCalled();
    expect(claim.prevented).toHaveBeenCalled();
  });

  it("goes back to the shell once the widget closes", () => {
    render(<Harness sessionId="ctrl-g-reclosed" />);
    const handler = lastKeyHandler();
    const search = getTerminalSearchController("ctrl-g-reclosed")!;
    search.open();
    expect(handler(ctrlG("keydown"))).toBe(false);

    search.close();
    expect(handler(ctrlG("keydown"))).toBe(true);
  });

  it("registers OSC 133 blocks and navigates known markers without sending input", () => {
    render(<Harness sessionId="osc133-terminal" />);
    const term = terminals[terminals.length - 1];
    term.emitOsc(133, "A;prompt");
    term.emitOsc(133, "B;git status");
    term.emitOsc(133, "C");
    term.emitOsc(133, "D;0");

    const blocks = getTerminalBlockController("osc133-terminal")!;
    expect(blocks.getBlocks()[0]).toMatchObject({ commandMetadata: "git status", status: "finished", exitCode: 0 });
    const event = new KeyboardEvent("keydown", { key: "PageUp", altKey: true });
    expect(lastKeyHandler()(event)).toBe(false);
    expect(term.scrollToLineCalls).toEqual([0]);
  });

  it("leaves OSC 133 unhandled for serial sessions", () => {
    const sessionId = "serial-osc133-terminal";
    render(<Harness sessionId={sessionId} sessionType="serial" />);
    const term = terminals[terminals.length - 1];

    expect(term.emitOsc(133, "A;prompt")).toBe(false);
    expect(getTerminalBlockController(sessionId)!.getBlocks()).toEqual([]);
  });

  it("accepts and dismisses local suggestions without an execution newline", () => {
    const sessionId = "suggestions-terminal";
    setConnectedSession(sessionId, "local");
    render(<Harness sessionId={sessionId} />);
    const term = terminals[terminals.length - 1];
    useCommandHistoryStore.setState({
      entries: [{ id: "history-1", command: "git status", timestamp: 1, sessionId, sessionName: "Work", connectionId: "c1" }],
      buffers: {},
    });
    term.emitData("git st");
    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();
    expect(picker.getSnapshot().open).toBe(true);
    picker.dismiss();
    expect(picker.getSnapshot().open).toBe(false);
    picker.open();
    picker.accept();
    expect(picker.getSnapshot().open).toBe(false);
    const calls = vi.mocked(localSendInput).mock.calls;
    const sent = calls[calls.length - 1]?.[1] as Uint8Array;
    expect(new TextDecoder().decode(sent)).not.toMatch(/[\r\n]/);
  });

  it("shows local suggestions immediately and wraps arrow selection", () => {
    const sessionId = "suggestions-local-immediate";
    setConnectedSession(sessionId, "local");
    useCommandHistoryStore.setState({
      entries: [
        { id: "history-1", command: "git status", timestamp: 1, sessionId, sessionName: "Work", connectionId: "c1" },
        { id: "history-2", command: "git stash", timestamp: 2, sessionId, sessionName: "Work", connectionId: "c1" },
      ],
      buffers: {},
    });
    render(<Harness sessionId={sessionId} />);
    const term = terminals[terminals.length - 1];
    term.emitData("git st");

    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();
    expect(picker.getSnapshot().suggestions.map((item) => item.command)).toEqual(["git stash", "git status"]);
    expect(picker.getSnapshot().selectedIndex).toBe(0);

    picker.previous();
    expect(picker.getSnapshot().selectedIndex).toBe(1);
    picker.next();
    expect(picker.getSnapshot().selectedIndex).toBe(0);
  });

  it("appends remote suggestions asynchronously using the normalized session path", async () => {
    const sessionId = "suggestions-remote-append";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd src/ut");
    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();

    expect(picker.getSnapshot().open).toBe(true);
    expect(picker.getSnapshot().suggestions).toEqual([]);
    expect(sshListRemoteDir).toHaveBeenCalledWith(sessionId, "/home/alice/project/src");

    const remoteSuggestions = waitForSuggestionSnapshot(
      picker,
      (snapshot) => snapshot.suggestions.length === 2,
    );
    listing.resolve([{ name: "utils", isDir: true }, { name: "util.txt", isDir: false }]);
    await remoteSuggestions;

    expect(picker.getSnapshot().suggestions.map((item) => item.command)).toEqual(["cd src/utils/", "cd src/util.txt"]);
  });

  it("keeps local history first and removes a duplicate remote command", async () => {
    const sessionId = "suggestions-local-and-remote";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    useCommandHistoryStore.setState({
      entries: [{ id: "history-local", command: "cd src/utils/", timestamp: 1, sessionId, sessionName: "Work", connectionId: "c1" }],
      buffers: {},
    });
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd src/ut");
    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();

    expect(picker.getSnapshot().suggestions.map((item) => item.command)).toEqual(["cd src/utils/"]);
    const mergedSuggestions = waitForSuggestionSnapshot(
      picker,
      (snapshot) => snapshot.suggestions.length === 2,
    );
    listing.resolve([
      { name: "utils", isDir: true },
      { name: "util.txt", isDir: false },
    ]);

    await mergedSuggestions;
    expect(picker.getSnapshot().suggestions.map((item) => item.command)).toEqual([
      "cd src/utils/",
      "cd src/util.txt",
    ]);
  });

  it.each([
    ["draft", (_sessionId: string) => terminals[terminals.length - 1].emitData("r")],
    ["cwd", (_sessionId: string) => useTerminalCwdStore.getState().setCwd(_sessionId, "/home/alice/other")],
    ["setting", (_sessionId: string) => {
      useTerminalSettingsStore.getState().setRemotePathCompletionEnabled(false);
      useTerminalSettingsStore.getState().setRemotePathCompletionEnabled(true);
      getTerminalSuggestionController(_sessionId)?.open();
    }],
    ["session context", (sessionId: string) => useSessionStore.setState({ sessions: [{ id: sessionId, type: "ssh", status: "connected", connectionId: "c2", connectionName: "Other", title: "Other" } as never] })],
  ])("discards a delayed remote result after the %s changes", async (_label, change) => {
    const sessionId = `suggestions-stale-${_label.replace(" ", "-")}`;
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const first = deferred<RemoteDirectoryEntry[]>();
    const second = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd s");
    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();
    expect(sshListRemoteDir).toHaveBeenCalledTimes(1);

    change(sessionId);
    expect(sshListRemoteDir).toHaveBeenCalledTimes(2);
    first.resolve([{ name: "src-stale", isDir: false }]);
    const freshSuggestions = waitForSuggestionSnapshot(
      picker,
      (snapshot) => snapshot.suggestions.some((item) => item.command === "cd src-fresh"),
    );
    second.resolve([{ name: "src-fresh", isDir: false }]);
    await freshSuggestions;
    expect(picker.getSnapshot().suggestions.map((item) => item.command)).toEqual(["cd src-fresh"]);
  });

  it("accepts a remote suggestion with exact insert-only PTY bytes", async () => {
    const sessionId = "suggestions-remote-exact-input";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd src/ut");
    const picker = getTerminalSuggestionController(sessionId)!;
    picker.open();
    const remoteSuggestion = waitForSuggestionSnapshot(
      picker,
      (snapshot) => snapshot.suggestions.some((item) => item.command === "cd src/utils/"),
    );
    listing.resolve([{ name: "utils", isDir: true }]);
    await remoteSuggestion;
    picker.select(0);
    picker.accept();

    const calls = vi.mocked(sshSendInput).mock.calls;
    const sent = calls[calls.length - 1]?.[1] as Uint8Array;
    expect(Array.from(sent)).toEqual([
      ...Array.from({ length: "cd src/ut".length }, () => 127),
      ...Array.from(new TextEncoder().encode("cd src/utils/")),
    ]);
    expect(Array.from(sent)).not.toContain(10);
    expect(Array.from(sent)).not.toContain(13);
  });

  it("passes safe SSH Tab to the remote shell native completion handler", () => {
    const sessionId = "suggestions-tab-opens-remote";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);
    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd src/ut");
    const tab = new KeyboardEvent("keydown", { key: "Tab" });
    const claim = watchClaim(tab);

    expect(lastKeyHandler()(tab)).toBe(true);
    expect(claim.prevented).not.toHaveBeenCalled();
    expect(claim.stopped).not.toHaveBeenCalled();
    expect(sshListRemoteDir).not.toHaveBeenCalled();
    listing.resolve([]);
  });

  it("passes path Tab to the remote shell instead of using SFTP", async () => {
    const sessionId = "suggestions-tab-case-insensitive-path";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("/Va");
    const tab = new KeyboardEvent("keydown", { key: "Tab" });
    const claim = watchClaim(tab);

    expect(lastKeyHandler()(tab)).toBe(true);
    expect(claim.prevented).not.toHaveBeenCalled();
    expect(claim.stopped).not.toHaveBeenCalled();
    expect(sshListRemoteDir).not.toHaveBeenCalled();

    listing.resolve([{ name: "var", isDir: true }]);
    await Promise.resolve();
  });

  // A persistent session runs inside a tmux/screen pane that Voltius started
  // itself, so the terminal legitimately sits in the alternate screen with mouse
  // tracking on. Treating that as "somebody else's full-screen app" silently
  // switched off both native completion and intentional-exit detection for every
  // persistent session - Tab did nothing and Ctrl+D fell into the reconnect path.
  describe("inside a Voltius-owned multiplexer", () => {
    function mountPersistentSession(sessionId: string) {
      setConnectedSession(sessionId, "ssh", { persist: true });
      useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
      render(<Harness sessionId={sessionId} sessionType="ssh" />);
      const term = terminals[terminals.length - 1];
      term.buffer.active.type = "alternate";
      term.modes.mouseTrackingMode = "drag";
      return { term, picker: getTerminalSuggestionController(sessionId)! };
    }

    it("still routes Tab to the remote shell's own completion", async () => {
      const { term, picker } = mountPersistentSession("persist-native-tab");
      term.emitData("cd /");
      const tab = new KeyboardEvent("keydown", { key: "Tab" });
      expect(lastKeyHandler()(tab)).toBe(true);

      term.emitOsc(9280, "A");
      // bash sends the full path ("/var/"); with no S span the frontend swaps
      // the token after the last space, so the draft becomes "cd /var/".
      term.emitOsc(9280, "C;2f7661722f");
      term.emitOsc(9280, "B");
      await waitForSuggestionSnapshot(picker, (snapshot) => snapshot.open);
      expect(picker.getSnapshot().suggestions[0]).toMatchObject({ command: "cd /var/" });
    });

    it("keeps the draft trusted across output while inside the multiplexer", async () => {
      // Three separate places used to invalidate the draft on alternate+mouse:
      // every output write, the OSC 133 handler (which is the ONLY thing that
      // restores draft trust at a prompt), and onData. Inside a Voltius-owned
      // tmux that combination left the draft permanently untrusted, so Tab
      // could never reach the native path again.
      const { term, picker } = mountPersistentSession("persist-draft-trust");
      // A real prompt boundary re-establishes trust; only then does typing start.
      term.emitOsc(133, "A;prompt");
      term.emitOsc(133, "B");
      term.emitData("cd ");
      // Ordinary shell output arriving afterwards must not untrust the draft.
      sshOutputHandler?.(new TextEncoder().encode("\r\nroot@webserver1:~# "));

      const tab = new KeyboardEvent("keydown", { key: "Tab" });
      expect(lastKeyHandler()(tab)).toBe(true);
      term.emitOsc(9280, "A");
      term.emitOsc(9280, "C;2f7661722f");
      term.emitOsc(9280, "B");
      await waitForSuggestionSnapshot(picker, (snapshot) => snapshot.open);
      expect(picker.getSnapshot().suggestions[0]).toMatchObject({ command: "cd /var/" });
    });

    it("still treats Ctrl+D at an empty prompt as an intentional exit", () => {
      const closed = vi.fn();
      const sessionId = "persist-ctrl-d";
      setConnectedSession(sessionId, "ssh", { persist: true });
      useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
      render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
      const term = terminals[terminals.length - 1];
      // The multiplexer state, verbatim as it was observed in the app log.
      term.buffer.active.type = "alternate";
      term.modes.mouseTrackingMode = "drag";

      term.emitData("\x04");
      sshClosedHandler?.(false);

      expect(closed).toHaveBeenCalledWith(false, "intentional-shell-exit");
    });
  });

  it("renders candidates returned by the remote shell over OSC 9280", async () => {
    const sessionId = "suggestions-native-shell-response";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    const picker = getTerminalSuggestionController(sessionId)!;
    term.emitData("git ch");

    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);
    term.emitOsc(9280, "A");
    term.emitOsc(9280, "S;4,2");
    term.emitOsc(9280, "C;636865636b6f7574");
    term.emitOsc(9280, "D?description;737769746368206272616e6368");
    term.emitOsc(9280, "B");

    await waitForSuggestionSnapshot(picker, (snapshot) => snapshot.open);
    expect(picker.getSnapshot().suggestions[0]).toMatchObject({
      command: "git checkout",
      label: "Remote shell suggestion",
      description: "switch branch",
    });
  });

  it("inserts a unique native match without opening the optional suggestions overlay", () => {
    const sessionId = "suggestions-native-without-overlay";
    setConnectedSession(sessionId, "ssh", { persist: true });
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useToggleSettingsStore.getState().set("terminal-suggestions-overlay", false);
    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    const picker = getTerminalSuggestionController(sessionId)!;
    term.emitData("cd /Va");
    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);
    term.emitOsc(9280, "A");
    term.emitOsc(9280, "C;2f7661722f");
    term.emitOsc(9280, "B");

    expect(picker.getSnapshot().open).toBe(false);
    const calls = vi.mocked(sshSendInput).mock.calls;
    expect(calls[calls.length - 1]?.[1]).toEqual(
      new TextEncoder().encode("\x7f".repeat("cd /Va".length) + "cd /var/"),
    );
    picker.open();
    expect(picker.getSnapshot().open).toBe(false);
  });

  it("can request suggestions again after accepting and backspacing to the original draft", async () => {
    const sessionId = "suggestions-native-backspace-and-retry";
    setConnectedSession(sessionId, "ssh", { persist: true });
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    const picker = getTerminalSuggestionController(sessionId)!;
    term.emitData("cd /");
    const tab = () => lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(tab()).toBe(true);
    term.emitOsc(9280, "A");
    term.emitOsc(9280, "C;2f6d6e74"); // /mnt
    term.emitOsc(9280, "C;2f766172"); // /var
    term.emitOsc(9280, "B");
    expect(picker.getSnapshot().open).toBe(true);
    tab(); // accept /mnt
    expect(picker.getSnapshot().open).toBe(false);
    term.emitData("\x7f\x7f\x7f"); // back to cd /
    expect(tab()).toBe(true);
    term.emitOsc(9280, "A");
    term.emitOsc(9280, "C;2f766172");
    term.emitOsc(9280, "B");
    await waitForSuggestionSnapshot(picker, (snapshot) => snapshot.open);
    expect(picker.getSnapshot().suggestions[0].command).toBe("cd /var");
  });

  it("reconciles an untrusted draft with Bash's line before offering a completion", () => {
    const sessionId = "suggestions-remote-authoritative-line";
    setConnectedSession(sessionId, "ssh", { persist: true });
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    const picker = getTerminalSuggestionController(sessionId)!;
    term.emitData("cd /mnt");
    term.emitData("\x1b[D"); // local mirror loses cursor trust
    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);
    term.emitOsc(9280, "A;6364202f;4"); // Bash reports the actual line: cd /
    term.emitOsc(9280, "C;2f766172");
    term.emitOsc(9280, "B");
    expect(picker.getSnapshot().suggestions[0]?.command).toBe("cd /var");
  });

  it("passes absolute-path Tab before cwd is known", async () => {
    const sessionId = "suggestions-tab-absolute-path-without-cwd";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd /Va");
    const tab = new KeyboardEvent("keydown", { key: "Tab" });
    const claim = watchClaim(tab);

    expect(lastKeyHandler()(tab)).toBe(true);
    expect(claim.prevented).not.toHaveBeenCalled();
    expect(claim.stopped).not.toHaveBeenCalled();
    expect(sshListRemoteDir).not.toHaveBeenCalled();

    listing.resolve([{ name: "var", isDir: true }]);
    await Promise.resolve();
  });

  it.each(["/", "/Va", "cd /Va"])("passes eligible SSH path Tab by default for %s", async (draft) => {
    const sessionId = `suggestions-tab-default-${draft.replace(/[^A-Za-z]/g, "-")}`;
    setConnectedSession(sessionId, "ssh");
    const merge = useTerminalSettingsStore.persist.getOptions().merge!;
    useTerminalSettingsStore.setState(merge(
      { remotePathCompletionEnabled: false },
      { ...useTerminalSettingsStore.getState(), remotePathCompletionEnabled: true },
    ));
    localStorage.setItem(
      "voltius-terminal-settings",
      JSON.stringify({ state: { remotePathCompletionEnabled: false } }),
    );
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData(draft);
    const tab = new KeyboardEvent("keydown", { key: "Tab" });
    const claim = watchClaim(tab);

    expect(lastKeyHandler()(tab)).toBe(true);
    expect(claim.prevented).not.toHaveBeenCalled();
    expect(claim.stopped).not.toHaveBeenCalled();
    expect(sshListRemoteDir).not.toHaveBeenCalled();

    listing.resolve([]);
    await Promise.resolve();
  });

  it("passes safe empty SSH Tab to the shell", () => {
    const sessionId = "suggestions-tab-empty-ssh";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    render(<Harness sessionId={sessionId} sessionType="ssh" />);

    const tab = new KeyboardEvent("keydown", { key: "Tab" });
    const claim = watchClaim(tab);
    expect(lastKeyHandler()(tab)).toBe(true);
    expect(claim.prevented).not.toHaveBeenCalled();
    expect(claim.stopped).not.toHaveBeenCalled();
  });

  it("passes Tab after recovering a stale SSH draft", async () => {
    const sessionId = "suggestions-tab-stale-empty-ssh";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/root");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("\x1b[D");

    const emptyTab = new KeyboardEvent("keydown", { key: "Tab" });
    expect(lastKeyHandler()(emptyTab)).toBe(false);

    term.emitData("/");
    const pathTab = new KeyboardEvent("keydown", { key: "Tab" });
    expect(lastKeyHandler()(pathTab)).toBe(true);
    expect(sshListRemoteDir).not.toHaveBeenCalled();

    listing.resolve([]);
    await Promise.resolve();
  });

  it("keeps an explicit remote path completion opt-out", () => {
    const sessionId = "suggestions-tab-explicit-opt-out";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.getState().setRemotePathCompletionEnabled(false);
    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    terminals[terminals.length - 1].emitData("/Va");

    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);
    expect(sshListRemoteDir).not.toHaveBeenCalled();
  });

  it("re-trusts a persistent prompt after OSC 133 A for Tab and Ctrl+D", async () => {
    const closed = vi.fn();
    const sessionId = "persistent-prompt-start-boundary";
    setConnectedSession(sessionId, "ssh", { persist: true });
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/root");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);

    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    const term = terminals[terminals.length - 1];
    const picker = getTerminalSuggestionController(sessionId)!;

    // A reconnect or untrusted escape leaves the editor unable to claim input.
    term.emitData("\x1b[D");
    term.emitOsc(133, "A");
    term.emitData("cd /Va");

    const tab = new KeyboardEvent("keydown", { key: "Tab" });
    const claim = watchClaim(tab);
    expect(lastKeyHandler()(tab)).toBe(true);
    expect(claim.prevented).not.toHaveBeenCalled();
    expect(claim.stopped).not.toHaveBeenCalled();
    expect(sshListRemoteDir).not.toHaveBeenCalled();

    // The next authoritative prompt boundary dismisses the stale picker and
    // leaves an empty, trusted line for intentional shell exit.
    term.emitOsc(133, "A");
    expect(picker.getSnapshot()).toMatchObject({ open: false, draft: "" });
    term.emitData("\x04");
    sshClosedHandler?.(false);

    expect(closed).toHaveBeenCalledWith(false, "intentional-shell-exit");
    listing.resolve([]);
    await Promise.resolve();
    expect(picker.getSnapshot().open).toBe(false);
  });

  it("leaves relative-path Tab with the shell before cwd is known", () => {
    const sessionId = "suggestions-tab-relative-path-without-cwd";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });

    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd sr");

    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);
    expect(sshListRemoteDir).not.toHaveBeenCalled();
  });

  it("accepts the selected remote suggestion on Tab with insert-only bytes", async () => {
    const sessionId = "suggestions-tab-accepts-remote";
    setConnectedSession(sessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sessionId, "/home/alice/project");
    const listing = deferred<RemoteDirectoryEntry[]>();
    vi.mocked(sshListRemoteDir).mockReturnValueOnce(listing.promise);
    render(<Harness sessionId={sessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    const picker = getTerminalSuggestionController(sessionId)!;
    term.emitData("cd src/ut");
    picker.open();
    listing.resolve([{ name: "utils", isDir: true }]);
    await waitForSuggestionSnapshot(picker, (snapshot) => snapshot.suggestions.length === 1);

    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(false);
    const calls = vi.mocked(sshSendInput).mock.calls;
    const sent = calls[calls.length - 1]?.[1] as Uint8Array;
    expect(Array.from(sent)).toEqual([
      ...Array.from({ length: "cd src/ut".length }, () => 127),
      ...Array.from(new TextEncoder().encode("cd src/utils/")),
    ]);
    expect(Array.from(sent)).not.toContain(9);
    expect(Array.from(sent)).not.toContain(10);
    expect(Array.from(sent)).not.toContain(13);
  });

  it("passes unsafe, local, and unknown-cursor Tab through to the shell", () => {
    const localSessionId = "suggestions-tab-local-pass-through";
    setConnectedSession(localSessionId, "local");
    render(<Harness sessionId={localSessionId} />);
    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);

    const sshSessionId = "suggestions-tab-unsafe-pass-through";
    setConnectedSession(sshSessionId, "ssh");
    useTerminalSettingsStore.setState({ remotePathCompletionEnabled: true });
    useTerminalCwdStore.getState().setCwd(sshSessionId, "/home/alice/project");
    render(<Harness sessionId={sshSessionId} sessionType="ssh" />);
    const term = terminals[terminals.length - 1];
    term.emitData("cd src/ut");
    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }))).toBe(true);
    term.emitData("\x1b[D");
    expect(lastKeyHandler()(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);
    expect(sshListRemoteDir).not.toHaveBeenCalled();
  });

  it.each([
    ["draft", (term: typeof terminals[number]) => term.emitData("x")],
    ["alternate screen", (term: typeof terminals[number]) => { term.buffer.active.type = "alternate"; }],
    ["mouse tracking", (term: typeof terminals[number]) => { term.modes.mouseTrackingMode = "x10"; }],
  ])("does not arm intentional Ctrl+D in a %s context", (_label, prepare) => {
    const sessionId = `ctrl-d-${String(_label).replace(" ", "-")}`;
    setConnectedSession(sessionId, "ssh");
    const closed = vi.fn();
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    const term = terminals[terminals.length - 1];
    prepare(term);
    term.emitData("\x04");
    sshClosedHandler?.(false);
    expect(sshClosedHandler).toBeDefined();
    expect(closed).toHaveBeenCalledWith(false, undefined);
  });

  it("carries one-shot intentional Ctrl+D through SSH close only for an empty normal shell", () => {
    const closed = vi.fn();
    const sessionId = "ctrl-d-intentional-shell";
    setConnectedSession(sessionId, "ssh", { persist: true });
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    terminals[terminals.length - 1].emitData("\x04");
    sshClosedHandler?.(false);

    expect(closed).toHaveBeenCalledWith(false, "intentional-shell-exit");
  });

  it("claims Ctrl+D while an SSH session is already reconnecting", () => {
    const closed = vi.fn();
    const sessionId = "ctrl-d-while-reconnecting";
    setConnectedSession(sessionId, "ssh", { persist: true });
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        type: "ssh",
        status: "connecting",
        connectionId: "c1",
        connectionName: "Work",
        title: "Work",
        persist: true,
      } as never],
    });

    const event = new KeyboardEvent("keydown", { key: "d", ctrlKey: true });
    const claim = watchClaim(event);
    expect(lastKeyHandler()(event)).toBe(false);
    expect(claim.prevented).toHaveBeenCalled();
    expect(claim.stopped).toHaveBeenCalled();
    expect(closed).toHaveBeenCalledWith(false, "intentional-shell-exit");
  });

  it("preserves intentional Ctrl+D when the store leaves connected before SSH close arrives", () => {
    const closed = vi.fn();
    const sessionId = "ctrl-d-intentional-before-close-event";
    setConnectedSession(sessionId, "ssh", { persist: true });
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    terminals[terminals.length - 1].emitData("\x04");

    useSessionStore.setState({
      sessions: [{
        id: sessionId,
        type: "ssh",
        status: "connecting",
        connectionId: "c1",
        connectionName: "Work",
        title: "Work",
        persist: true,
      } as never],
    });
    sshClosedHandler?.(false);

    expect(closed).toHaveBeenCalledWith(false, "intentional-shell-exit");
  });

  it("closes an empty SSH prompt even when draft trust is stale", () => {
    const closed = vi.fn();
    const sessionId = "ctrl-d-stale-prompt-trust";
    setConnectedSession(sessionId, "ssh", { persist: true });
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    const term = terminals[terminals.length - 1];

    // A restore-era cursor sequence makes the mirrored draft untrusted even
    // though the shell is back at an empty prompt.
    term.emitData("\x1b[D");
    term.emitData("\x04");
    sshClosedHandler?.(false);

    expect(closed).toHaveBeenCalledWith(false, "intentional-shell-exit");
  });

  it("does not arm intentional Ctrl+D while broadcast is active", () => {
    const closed = vi.fn();
    const sessionId = "ctrl-d-broadcast";
    setConnectedSession(sessionId, "ssh");
    useLayoutStore.setState({
      broadcastActive: true,
      splitTabActive: true,
      root: { type: "leaf", id: "pane-1", sessionId },
    });
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    terminals[terminals.length - 1].emitData("\x04");
    sshClosedHandler?.(false);

    expect(closed).toHaveBeenCalledWith(false, undefined);
  });

  it("clears an armed Ctrl+D intent when new input arrives before close", () => {
    const closed = vi.fn();
    const sessionId = "ctrl-d-cleared-by-input";
    setConnectedSession(sessionId, "ssh");
    render(<Harness sessionId={sessionId} sessionType="ssh" onClosed={closed} />);
    const term = terminals[terminals.length - 1];
    term.emitData("\x04");
    term.emitData("x");
    sshClosedHandler?.(false);

    expect(closed).toHaveBeenCalledWith(false, undefined);
  });
});
