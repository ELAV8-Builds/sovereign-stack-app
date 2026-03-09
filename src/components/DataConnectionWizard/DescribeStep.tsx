/**
 * DescribeStep — Step 1: "What do you want to build?"
 */
import { type RefObject } from "react";

interface DescribeStepProps {
  description: string;
  setDescription: (val: string) => void;
  pageName: string;
  setPageName: (val: string) => void;
  descriptionRef: RefObject<HTMLTextAreaElement | null>;
  onNext: () => void;
}

export function DescribeStep({
  description,
  setDescription,
  pageName,
  setPageName,
  descriptionRef,
  onNext,
}: DescribeStepProps) {
  return (
    <div className="p-6 space-y-5">
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">
          What do you want to see on this page?
        </label>
        <textarea
          ref={descriptionRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. A sales dashboard showing my HubSpot deals by stage, revenue metrics, and a table of recent activities..."
          rows={4}
          className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) onNext();
          }}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">
          Page name <span className="text-slate-600">(optional)</span>
        </label>
        <input
          value={pageName}
          onChange={(e) => setPageName(e.target.value)}
          placeholder="Auto-generated from description"
          className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20"
        />
      </div>

      {/* Quick templates */}
      <div>
        <p className="text-xs font-medium text-slate-500 mb-2">Quick start</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Sales Dashboard", desc: "CRM deals, pipeline stages, and revenue metrics" },
            { label: "Customer Activity", desc: "Recent customer interactions, support tickets, and engagement" },
            { label: "Revenue Report", desc: "Monthly revenue, growth trends, and financial KPIs" },
            { label: "Project Status", desc: "Task progress, team workload, and milestone tracking" },
          ].map((t) => (
            <button
              key={t.label}
              onClick={() => {
                setDescription(t.desc);
                setPageName(t.label);
              }}
              className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-xs text-slate-400 hover:text-white hover:bg-white/[0.06] hover:border-indigo-500/20 transition-all"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
