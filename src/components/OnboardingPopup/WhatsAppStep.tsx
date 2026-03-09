import { WhatsAppConnect } from "../WhatsAppConnect";
import type { OnboardingStep } from "./types";

interface WhatsAppStepProps {
  setStep: (step: OnboardingStep) => void;
}

export function WhatsAppStep({ setStep }: WhatsAppStepProps) {
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
          Connect WhatsApp
        </h2>
      </div>

      <WhatsAppConnect
        onConnected={() => setStep("done")}
        compact={false}
      />
    </div>
  );
}
