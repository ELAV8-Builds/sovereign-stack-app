/**
 * Canvas — Shared types and interfaces
 */
import type { Spec } from "@json-render/core";
import type { CanvasPage, VaultKeyStatus } from "@/lib/canvas";
import type { DataSourceConfig } from "@/lib/integrations";
import type { SpecElement } from "@/lib/canvas-catalog";

// ── Smart Suggestion ─────────────────────────────────────────────────

export interface SmartSuggestion {
  keys: string[];
  icon: string;
  title: string;
  prompt: string;
  service: string;
}

// ── Wizard Result ────────────────────────────────────────────────────

export interface WizardResult {
  prompt: string;
  dataSources: DataSourceConfig;
  pageName: string;
}

// ── Shared Props ─────────────────────────────────────────────────────

export interface PageSidebarProps {
  pages: CanvasPage[];
  activePage: CanvasPage | null;
  isLoading: boolean;
  editingName: string | null;
  editNameValue: string;
  confirmDeleteId: string | null;
  onSelectPage: (page: CanvasPage) => void;
  onNewPage: () => void;
  onStartRename: (id: string, name: string, e: React.MouseEvent) => void;
  onSaveRename: (id: string) => void;
  onCancelRename: () => void;
  onEditNameValueChange: (value: string) => void;
  onDuplicate: (id: string, name: string, e: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

export interface PageHeaderProps {
  activePage: CanvasPage;
  isGenerating: boolean;
  isRefreshing: boolean;
  activeSpec: Spec | null;
  onRefreshData: () => void;
  onExport: () => void;
}

export interface CanvasRendererProps {
  activeSpec: Spec | null;
  isGenerating: boolean;
}

export interface PromptInputProps {
  prompt: string;
  isGenerating: boolean;
  activeSpec: Spec | null;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onStop: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export interface EmptyStateProps {
  vaultKeys: VaultKeyStatus[];
  onNewPage: () => void;
  onQuickNewPage: () => void;
  onSuggestionClick: (suggestion: SmartSuggestion) => void;
}

// Re-export types used by consumers
export type { Spec, CanvasPage, VaultKeyStatus, DataSourceConfig, SpecElement };
