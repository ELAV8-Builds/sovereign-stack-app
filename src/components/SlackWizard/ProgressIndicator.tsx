interface ProgressIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

export function ProgressIndicator({ currentStep, totalSteps }: ProgressIndicatorProps) {
  const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);

  return (
    <div className="flex items-center justify-center mb-8 space-x-2">
      {steps.map((step) => (
        <div key={step} className="flex items-center">
          <div
            className={`w-3 h-3 rounded-full transition-all duration-300 ${
              step === currentStep
                ? 'bg-blue-500 scale-125'
                : step < currentStep
                ? 'bg-green-500'
                : 'bg-slate-600'
            }`}
          />
          {step < totalSteps && (
            <div
              className={`w-8 h-0.5 mx-1 transition-all duration-300 ${
                step < currentStep ? 'bg-green-500' : 'bg-slate-600'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
