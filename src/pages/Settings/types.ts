export interface SystemInfo {
  macos_version: string;
  architecture: string;
  hostname: string;
  current_user: string;
}

export interface VaultKey {
  id: string;
  name: string;
  envVar: string;
  category: string;
  placeholder: string;
  description: string;
  configured: boolean;
  updatedAt: string | null;
}

export type SettingsSection =
  | "communication"
  | "agent"
  | "knowledge"
  | "system"
  | "security"
  | "advanced";

export const API_BASE = "/api/sovereign";

export const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  ai: { label: "AI Providers", icon: "\u{1F9E0}" },
  media: { label: "Media & Voice", icon: "\u{1F3AC}" },
  communication: { label: "Communication", icon: "\u{1F4AC}" },
  search: { label: "Search & Data", icon: "\u{1F50D}" },
  business: { label: "Business & Productivity", icon: "\u{1F4BC}" },
  development: { label: "Development & DevOps", icon: "\u{1F6E0}\u{FE0F}" },
  infrastructure: { label: "Infrastructure", icon: "\u2699\u{FE0F}" },
  custom: { label: "Custom Keys", icon: "\u{1F527}" },
};

export const SECTIONS: { id: SettingsSection; label: string; icon: string }[] = [
  { id: "communication", label: "Communication", icon: "\u{1F4AC}" },
  { id: "agent", label: "Agent", icon: "\u{1F916}" },
  { id: "knowledge", label: "Knowledge", icon: "\u{1F4DA}" },
  { id: "system", label: "System", icon: "\u{1F4BB}" },
  { id: "security", label: "Security", icon: "\u{1F512}" },
  { id: "advanced", label: "Advanced", icon: "\u26A1" },
];
