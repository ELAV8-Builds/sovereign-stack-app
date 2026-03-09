// ── Types ────────────────────────────────────────────────────────────

export type OnboardingStep =
  | "welcome"        // 0 — Welcome + Docker check
  | "docker_install" // 1 — Docker not found — show install instructions
  | "api_key"        // 2 — Enter API key
  | "launching"      // 3 — Downloading stack + starting services + progress
  | "channels"       // 4 — Optional channel connections
  | "whatsapp"       // 4a — WhatsApp QR
  | "slack"          // 4b — Slack wizard
  | "done";          // 5 — All set!

export interface DockerStatus {
  docker_installed: boolean;
  docker_running: boolean;
  compose_available: boolean;
  stack_cloned: boolean;
  stack_path: string;
  env_configured: boolean;
}

export interface SetupStepResult {
  step: string;
  success: boolean;
  message: string;
  detail: string | null;
}

export interface OnboardingPopupProps {
  onComplete: () => void;
  /** When true, always start from welcome step (used by Restart Onboarding) */
  forceRestart?: boolean;
}

// ── Step index for progress dots ────────────────────────────────────

export const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "api_key",
  "launching",
  "channels",
  "done",
];

export function getStepIndex(step: OnboardingStep): number {
  if (step === "docker_install") return 0;
  if (step === "whatsapp" || step === "slack") return 3;
  return STEP_ORDER.indexOf(step);
}
