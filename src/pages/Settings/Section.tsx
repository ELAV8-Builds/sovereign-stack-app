import type { ReactNode } from "react";

interface SectionProps {
  title: string;
  icon: string;
  description?: string;
  children: ReactNode;
}

export function Section({ title, icon, description, children }: SectionProps) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-6">
      <div className="mb-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>{icon}</span>
          <span>{title}</span>
        </h2>
        {description && (
          <p className="text-xs text-slate-500 mt-1 ml-7">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}
