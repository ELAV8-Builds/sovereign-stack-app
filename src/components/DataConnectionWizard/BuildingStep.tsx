/**
 * BuildingStep — Status feed shown while the canvas is being generated
 */
import { CheckCircleIcon } from "./Icons";

interface BuildingStepProps {
  statusMessages: string[];
}

export function BuildingStep({ statusMessages }: BuildingStepProps) {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[300px] space-y-6">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center">
        <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
      <div className="space-y-2 w-full max-w-sm">
        {statusMessages.map((msg, i) => (
          <div
            key={i}
            className={`flex items-center gap-2 text-xs transition-all ${
              i === statusMessages.length - 1
                ? "text-indigo-400"
                : "text-slate-500"
            }`}
          >
            {i < statusMessages.length - 1 ? (
              <span className="text-emerald-400"><CheckCircleIcon /></span>
            ) : (
              <div className="w-5 h-5 flex items-center justify-center">
                <div className="animate-spin w-3 h-3 border border-indigo-500 border-t-transparent rounded-full" />
              </div>
            )}
            {msg}
          </div>
        ))}
      </div>
    </div>
  );
}
