import type { StepNavigationProps } from './types';

export function NavigationButtons({
  onBack,
  onNext,
  nextDisabled = false,
  nextLabel = 'Next \u2192',
  backLabel = '\u2190 Back',
  showCancel = false,
  onCancel,
}: StepNavigationProps) {
  return (
    <div className="flex justify-between">
      {showCancel && onCancel ? (
        <button
          onClick={onCancel}
          className="px-8 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-all duration-200"
        >
          Cancel
        </button>
      ) : (
        <button
          onClick={onBack}
          className="px-8 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-all duration-200"
        >
          {backLabel}
        </button>
      )}
      {onNext && (
        <button
          onClick={onNext}
          disabled={nextDisabled}
          className={`px-8 py-3 rounded-lg font-semibold transition-all duration-200 shadow-lg ${
            !nextDisabled
              ? 'bg-blue-600 hover:bg-blue-700 hover:shadow-xl active:scale-95'
              : 'bg-slate-600 cursor-not-allowed opacity-50'
          } ml-auto`}
        >
          {nextLabel}
        </button>
      )}
    </div>
  );
}
