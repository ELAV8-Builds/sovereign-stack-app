import { CapacityIndicator } from "../../components/CapacityIndicator";
import { HealthCheck } from "../../components/HealthCheck";
import { Section } from "./Section";
import type { SystemInfo } from "./types";

interface SystemSectionProps {
  systemInfo: SystemInfo | null;
}

export function SystemSection({ systemInfo }: SystemSectionProps) {
  return (
    <div className="space-y-6 animate-fadeIn">
      <Section title="System Capacity" icon="\u{1F4CA}" description="Hardware profile and project limits">
        <CapacityIndicator />
      </Section>

      <Section title="System Health" icon="\u{1F3E5}" description="Service health checks">
        <HealthCheck autoRun={false} />
      </Section>

      {/* System Information */}
      <Section title="System Information" icon="\u{1F4BB}" description="Host machine details">
        {systemInfo ? (
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "macOS Version", value: systemInfo.macos_version },
              { label: "Architecture", value: systemInfo.architecture },
              { label: "Hostname", value: systemInfo.hostname },
              { label: "Current User", value: systemInfo.current_user },
            ].map((item) => (
              <div key={item.label}>
                <div className="text-xs text-slate-500">{item.label}</div>
                <div className="text-sm font-semibold text-white">{item.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Loading...</p>
        )}
      </Section>

      {/* Service Ports */}
      <Section title="Service Ports" icon="\u{1F50C}" description="Port assignments for each service">
        <div className="space-y-2">
          {[
            { name: "LiteLLM", port: 4000 },
            { name: "Ollama", port: 11434 },
            { name: "memU", port: 8090 },
            { name: "PostgreSQL", port: 5432 },
            { name: "Temporal", port: 7233, soon: true },
            { name: "Redis", port: 6379 },
            { name: "AnythingLLM", port: 3001 },
          ].map((svc) => (
            <div
              key={svc.name}
              className="flex justify-between items-center py-1.5 border-b border-slate-800 last:border-0"
            >
              <span className="text-sm text-slate-300 flex items-center gap-2">
                {svc.name}
                {"soon" in svc && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-900/30 text-amber-400 border border-amber-800/50">
                    Coming Soon
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                :{svc.port}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
