import type { SettingsSection } from "@/stores/uiStore";
import AppearanceSection from "@/components/settings/sections/AppearanceSection";
import SecuritySection from "@/components/settings/sections/SecuritySection";
import PluginsSection from "@/components/settings/sections/PluginsSection";
import IntegrationsSection from "@/components/settings/sections/IntegrationsSection";
import TerminalSection from "@/components/settings/sections/TerminalSection";
import SFTPSection from "@/components/settings/sections/SFTPSection";
import PortForwardingSection from "@/components/settings/sections/PortForwardingSection";
import AboutSection from "@/components/settings/sections/AboutSection";
import HostsSection from "@/components/settings/sections/HostsSection";
import ShortcutsSection from "@/components/settings/sections/ShortcutsSection";
import DiagnosticsSection from "@/components/settings/sections/DiagnosticsSection";

/** Single source of truth for section id → body. Used by desktop and mobile shells. */
export function renderSettingsSection(section: SettingsSection) {
  switch (section) {
    case "appearance": return <AppearanceSection />;
    case "security": return <SecuritySection />;
    case "plugins": return <PluginsSection />;
    case "integrations": return <IntegrationsSection />;
    case "terminal": return <TerminalSection />;
    case "sftp": return <SFTPSection />;
    case "portForwarding": return <PortForwardingSection />;
    case "hosts": return <HostsSection />;
    case "shortcuts": return <ShortcutsSection />;
    case "diagnostics": return <DiagnosticsSection />;
    case "about": return <AboutSection />;
    default: return null;
  }
}
