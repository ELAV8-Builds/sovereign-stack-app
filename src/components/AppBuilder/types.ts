/**
 * AppBuilder — shared types and constants
 */
import type { WorkspaceTemplate, Workspace, BuildReport } from "@/lib/workspace";

// ── Phase definition ────────────────────────────────────────────────────

export type Phase = "describe" | "template" | "build" | "validate" | "review" | "deploy";

export interface PhaseInfo {
  id: Phase;
  label: string;
  num: number;
}

export const PHASES: PhaseInfo[] = [
  { id: "describe", label: "Describe", num: 1 },
  { id: "template", label: "Template", num: 2 },
  { id: "build", label: "Build", num: 3 },
  { id: "validate", label: "Validate", num: 4 },
  { id: "review", label: "Review", num: 5 },
  { id: "deploy", label: "Deploy", num: 6 },
];

// ── Quick suggestion chips ──────────────────────────────────────────────

export const SUGGESTIONS = [
  "Landing page with contact form",
  "REST API with authentication",
  "Real-time dashboard with WebSockets",
  "CLI tool with command parser",
  "Blog with markdown rendering",
];

// ── Props for phase sub-components ──────────────────────────────────────

export interface DescribePhaseProps {
  description: string;
  setDescription: (value: string) => void;
}

export interface TemplatePhaseProps {
  projectName: string;
  setProjectName: (value: string) => void;
  templates: WorkspaceTemplate[];
  selectedTemplate: string;
  setSelectedTemplate: (value: string) => void;
  loadingTemplates: boolean;
}

export interface BuildPhaseProps {
  projectName: string;
  selectedTemplate: string;
  buildLogs: string[];
  building: boolean;
  buildLogRef: React.RefObject<HTMLDivElement | null>;
  handleBuild: () => void;
}

export interface ValidatePhaseProps {
  buildReport: BuildReport | null;
  validating: boolean;
  handleValidate: () => void;
}

export interface ReviewPhaseProps {
  workspace: Workspace | null;
  buildReport: BuildReport | null;
  description: string;
}

export interface DeployPhaseProps {
  deployTarget: string;
  setDeployTarget: (value: string) => void;
  deployResult: any;
  deploying: boolean;
  handleDeploy: () => void;
  handleReset: () => void;
}

export interface PhaseStepperProps {
  phases: PhaseInfo[];
  currentPhase: Phase;
  completedPhases: Set<Phase>;
  phaseIndex: number;
  setPhase: (phase: Phase) => void;
}

export interface NavigationFooterProps {
  phase: Phase;
  phaseIndex: number;
  totalPhases: number;
  canAdvance: boolean;
  building: boolean;
  validating: boolean;
  deploying: boolean;
  buildLogs: string[];
  buildReport: BuildReport | null;
  deployResult: any;
  goBack: () => void;
  goNext: () => void;
  handleBuild: () => void;
  handleValidate: () => void;
  handleDeploy: () => void;
}
