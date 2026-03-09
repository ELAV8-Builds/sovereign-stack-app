import { SlackWizard } from "../SlackWizard";
import type { OnboardingStep } from "./types";

interface SlackStepProps {
  setStep: (step: OnboardingStep) => void;
}

export function SlackStep({ setStep }: SlackStepProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={() => setStep("channels")}
          className="text-slate-500 hover:text-slate-300 transition-colors text-sm"
        >
          &larr; Back
        </button>
        <h2 className="text-lg font-bold text-white">
          Connect Slack
        </h2>
      </div>

      <SlackWizard
        onComplete={() => setStep("done")}
        embedded={true}
      />
    </div>
  );
}
