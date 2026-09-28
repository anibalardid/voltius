import i18n from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import type { ToastSeverity } from "@/plugins/api";
import { getTerminalNotificationPolicy, type TerminalNotificationDestination } from "@/stores/terminalNotificationSettingsStore";

export type TerminalSessionType = "ssh" | "local" | "serial";

export type TerminalLifecycleSignal =
  | {
      kind: "terminal-bell";
      sessionId: string;
      sessionName: string;
      sessionType: TerminalSessionType;
      eventId: string;
      broadcastGroupId?: string;
    }
  | {
      kind: "session-ended";
      sessionId: string;
      sessionName: string;
      sessionType: TerminalSessionType;
      reason: "remote-exit" | "disconnect" | "local-exit" | "serial-close";
    }
  /** Reserved for the OSC 133 command-block seam. A null exit code is never success. */
  | {
      kind: "command-finished";
      sessionId: string;
      sessionName: string;
      sessionType: TerminalSessionType;
      commandId: string;
      exitCode: number | null;
    };

export interface LifecycleNotification {
  dedupeKey: string;
  title: string;
  body: string;
  severity: ToastSeverity;
  sessionId: string;
  sessionName: string;
}

export interface LifecycleNotificationPolicy {
  terminal: boolean;
  inApp: boolean;
  system: boolean;
}

export interface LifecycleNotificationSinks {
  terminal?: (notification: LifecycleNotification) => void | Promise<void>;
  inApp?: (notification: LifecycleNotification) => void | Promise<void>;
  system?: (notification: LifecycleNotification) => boolean | Promise<boolean>;
}

export interface LifecycleDispatchResult {
  notified: boolean;
  attempted: TerminalNotificationDestination[];
  delivered: TerminalNotificationDestination[];
  systemFailed: boolean;
}

export interface LifecycleNotificationRouterOptions {
  getPolicy: () => LifecycleNotificationPolicy;
  sinks: LifecycleNotificationSinks;
}

function safeSessionName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || "Terminal session";
}

function classifySignal(signal: TerminalLifecycleSignal): LifecycleNotification | null {
  const sessionName = safeSessionName(signal.sessionName);
  if (signal.kind === "command-finished") {
    // Only an explicit exit code can classify a command. Disconnects and future
    // unknown command states must stay silent rather than becoming false success.
    if (signal.exitCode === null || !Number.isInteger(signal.exitCode)) return null;
    const success = signal.exitCode === 0;
    return {
      dedupeKey: `command:${signal.sessionId}:${signal.commandId}`,
      title: i18n.t(success ? "notifications.terminalLifecycle.commandSucceeded.title" : "notifications.terminalLifecycle.commandFailed.title"),
      body: i18n.t(
        success ? "notifications.terminalLifecycle.commandSucceeded.body" : "notifications.terminalLifecycle.commandFailed.body",
        { session: sessionName, exitCode: signal.exitCode },
      ),
      severity: success ? "success" : "error",
      sessionId: signal.sessionId,
      sessionName,
    };
  }

  if (signal.kind === "terminal-bell") {
    return {
      dedupeKey: `bell:${signal.broadcastGroupId ?? signal.sessionId}:${signal.eventId}`,
      title: i18n.t("notifications.terminalLifecycle.bell.title"),
      body: i18n.t("notifications.terminalLifecycle.bell.body", { session: sessionName }),
      severity: "info",
      sessionId: signal.sessionId,
      sessionName,
    };
  }

  const disconnected = signal.reason === "disconnect";
  return {
    // A session can emit the same close while a reconnect/reattach is in flight.
    // The router is reset only after a fresh connected state is observed.
    dedupeKey: `session-ended:${signal.sessionId}`,
    title: i18n.t("notifications.terminalLifecycle.sessionEnded.title"),
    body: i18n.t(
      disconnected
        ? "notifications.terminalLifecycle.sessionEnded.disconnected"
        : "notifications.terminalLifecycle.sessionEnded.body",
      { session: sessionName },
    ),
    severity: disconnected ? "warning" : "info",
    sessionId: signal.sessionId,
    sessionName,
  };
}

export function createLifecycleNotificationRouter(options: LifecycleNotificationRouterOptions) {
  const deliveredKeys = new Set<string>();

  return {
    resetSession(sessionId: string): void {
      const prefix = `session-ended:${sessionId}`;
      for (const key of deliveredKeys) {
        if (key === prefix) deliveredKeys.delete(key);
      }
    },

    async publish(
      signal: TerminalLifecycleSignal,
      terminalFeedback?: (notification: LifecycleNotification) => void | Promise<void>,
    ): Promise<LifecycleDispatchResult> {
      const notification = classifySignal(signal);
      const result: LifecycleDispatchResult = {
        notified: false,
        attempted: [],
        delivered: [],
        systemFailed: false,
      };
      if (!notification || deliveredKeys.has(notification.dedupeKey)) return result;

      const policy = options.getPolicy();
      const terminalSink = terminalFeedback ?? options.sinks.terminal;
      const deliver = async (destination: TerminalNotificationDestination, run: (() => void | Promise<void>) | undefined) => {
        if (!run) return;
        result.attempted.push(destination);
        try {
          await run();
          result.delivered.push(destination);
          result.notified = true;
        } catch {
          // Notification destinations are deliberately failure-isolated from terminal I/O.
        }
      };

      if (policy.system) {
        result.attempted.push("system");
        try {
          const delivered = await options.sinks.system?.(notification);
          if (delivered) {
            result.delivered.push("system");
            result.notified = true;
          } else {
            result.systemFailed = true;
          }
        } catch {
          result.systemFailed = true;
        }
      }

      // A denied/unavailable system path falls through to the destinations the
      // user explicitly enabled. No permission error is allowed to reach xterm.
      if (policy.inApp) {
        await deliver("inApp", options.sinks.inApp ? () => options.sinks.inApp?.(notification) : undefined);
      }
      if (policy.terminal) {
        await deliver("terminal", terminalSink ? () => terminalSink(notification) : undefined);
      }

      if (result.notified || result.attempted.length > 0) deliveredKeys.add(notification.dedupeKey);
      return result;
    },
  };
}

async function sendSystemNotification(notification: LifecycleNotification): Promise<boolean> {
  try {
    const api = await import("@tauri-apps/plugin-notification");
    if (!(await api.isPermissionGranted())) {
      if ((await api.requestPermission()) !== "granted") return false;
    }
    await api.sendNotification({ title: notification.title, body: notification.body });
    return true;
  } catch {
    return false;
  }
}

export const terminalLifecycleNotificationRouter = createLifecycleNotificationRouter({
  getPolicy: () => getTerminalNotificationPolicy(),
  sinks: {
    inApp: (notification) => {
      useNotificationStore.getState().addToast({
        source: { kind: "app", area: "terminal" },
        type: "toast",
        message: notification.body,
        severity: notification.severity,
        duration: 8_000,
      });
    },
    system: sendSystemNotification,
  },
});

export function notifyTerminalLifecycle(
  signal: TerminalLifecycleSignal,
  terminalFeedback?: (notification: LifecycleNotification) => void | Promise<void>,
): Promise<LifecycleDispatchResult> {
  return terminalLifecycleNotificationRouter.publish(signal, terminalFeedback);
}

export function resetTerminalLifecycleNotifications(sessionId: string): void {
  terminalLifecycleNotificationRouter.resetSession(sessionId);
}
