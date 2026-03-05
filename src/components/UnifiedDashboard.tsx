import { useState, useEffect } from "react";
import { safeInvoke } from "@/lib/tauri";

interface ServiceInfo {
  name: string;
  port: number | null;
  status: "Running" | "Stopped" | "Unknown";
  runtime: string;
}

// Mock services for development
const MOCK_SERVICES: ServiceInfo[] = [
  { name: "nanoclaw", port: 18789, status: "Running", runtime: "Docker" },
  { name: "litellm", port: 4000, status: "Running", runtime: "Docker" },
  { name: "ollama", port: 11434, status: "Running", runtime: "Native" },
  { name: "memu", port: 8090, status: "Running", runtime: "Docker" },
  { name: "postgresql", port: 5432, status: "Running", runtime: "Docker" },
  { name: "temporal", port: 7233, status: "Stopped", runtime: "Docker" },
  { name: "anythingllm", port: 3001, status: "Running", runtime: "Docker" },
];

export function UnifiedDashboard() {
  const [services, setServices] = useState<ServiceInfo[]>(MOCK_SERVICES);
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Fetch services
  const fetchServices = async () => {
    try {
      const data = await safeInvoke<ServiceInfo[]>("get_services_status");
      if (Array.isArray(data)) setServices(data);
    } catch {
      // Use mock data
    }
  };

  useEffect(() => {
    fetchServices();
    const interval = setInterval(fetchServices, 5000);
    return () => clearInterval(interval);
  }, []);

  // Toast auto-dismiss
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Service actions
  const handleAction = async (
    service: string,
    action: "start" | "stop" | "restart"
  ) => {
    setActionInProgress(service);
    try {
      await safeInvoke<string>(`${action}_service`, { serviceName: service });
      await fetchServices();
      setToast({
        message: `${service} ${action}ed successfully`,
        type: "success",
      });
    } catch (err) {
      setToast({
        message: `Failed to ${action} ${service}: ${err}`,
        type: "error",
      });
    } finally {
      setActionInProgress(null);
    }
  };

  // Toggle log expansion
  const toggleExpand = async (serviceName: string) => {
    if (expandedService === serviceName) {
      setExpandedService(null);
      return;
    }

    setExpandedService(serviceName);
    setLogsLoading(true);

    try {
      const logsData = await safeInvoke<string>("get_service_logs", {
        serviceName,
        lines: 50,
      });
      setLogs(typeof logsData === "string" ? logsData : "");
    } catch {
      setLogs(
        `[mock] ${serviceName} started successfully\n[mock] Listening on port ${
          services.find((s) => s.name === serviceName)?.port || "???"
        }\n[mock] Health check passed\n[mock] Ready to accept connections`
      );
    } finally {
      setLogsLoading(false);
    }
  };

  // Stats
  const running = services.filter((s) => s.status === "Running").length;
  const total = services.length;
  const uptimePct =
    total > 0 ? ((running / total) * 100).toFixed(1) : "0.0";

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 overflow-y-auto">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg border animate-fadeIn ${
            toast.type === "success"
              ? "bg-green-900/90 border-green-700 text-green-300"
              : "bg-red-900/90 border-red-700 text-red-300"
          }`}
        >
          <span className="text-sm font-medium">
            {toast.type === "success" ? "✓" : "✗"} {toast.message}
          </span>
        </div>
      )}

      <div className="p-6 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">Dashboard</h1>
            <p className="text-sm text-slate-500">Service overview</p>
          </div>
          <button
            onClick={fetchServices}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-medium text-slate-300 transition-all duration-200"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
              Services
            </div>
            <div className="text-2xl font-bold text-white">
              <span className="text-green-400">{running}</span>
              <span className="text-slate-600 text-lg">/{total}</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">running</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
              Uptime
            </div>
            <div className="text-2xl font-bold text-white">{uptimePct}%</div>
            <div className="text-xs text-slate-500 mt-1">availability</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
              Cost
            </div>
            <div className="text-2xl font-bold text-white">$3.47</div>
            <div className="text-xs text-slate-500 mt-1">today</div>
          </div>
        </div>

        {/* Service table */}
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_100px_80px_140px] gap-4 px-5 py-3 border-b border-slate-700/50 text-xs font-medium text-slate-500 uppercase tracking-wider">
            <span>Service</span>
            <span>Status</span>
            <span>Port</span>
            <span className="text-right">Actions</span>
          </div>

          {/* Service rows */}
          {services.map((service) => (
            <div key={service.name}>
              <div
                className={`grid grid-cols-[1fr_100px_80px_140px] gap-4 px-5 py-3.5 border-b border-slate-800/50 items-center cursor-pointer transition-all duration-150 ${
                  expandedService === service.name
                    ? "bg-slate-800/50"
                    : "hover:bg-slate-800/30"
                }`}
                onClick={() => toggleExpand(service.name)}
              >
                {/* Name */}
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs ${
                      expandedService === service.name
                        ? "rotate-90"
                        : ""
                    } transition-transform duration-200 text-slate-500`}
                  >
                    ▸
                  </span>
                  <span className="font-medium text-sm text-white">
                    {service.name}
                  </span>
                  <span className="text-xs text-slate-600">
                    {service.runtime}
                  </span>
                </div>

                {/* Status */}
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      service.status === "Running"
                        ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]"
                        : service.status === "Stopped"
                        ? "bg-slate-500"
                        : "bg-amber-400 animate-pulse"
                    }`}
                  />
                  <span
                    className={`text-xs font-medium ${
                      service.status === "Running"
                        ? "text-green-400"
                        : service.status === "Stopped"
                        ? "text-slate-500"
                        : "text-amber-400"
                    }`}
                  >
                    {service.status}
                  </span>
                </div>

                {/* Port */}
                <span className="text-xs text-slate-400 font-mono">
                  {service.port || "—"}
                </span>

                {/* Actions */}
                <div
                  className="flex items-center justify-end gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handleAction(service.name, "start")}
                    disabled={
                      service.status === "Running" ||
                      actionInProgress === service.name
                    }
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all duration-200 ${
                      service.status === "Running" ||
                      actionInProgress === service.name
                        ? "text-slate-600 cursor-not-allowed"
                        : "text-green-400 hover:bg-green-900/30"
                    }`}
                    title="Start"
                  >
                    ▶
                  </button>
                  <button
                    onClick={() => handleAction(service.name, "stop")}
                    disabled={
                      service.status === "Stopped" ||
                      actionInProgress === service.name
                    }
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all duration-200 ${
                      service.status === "Stopped" ||
                      actionInProgress === service.name
                        ? "text-slate-600 cursor-not-allowed"
                        : "text-red-400 hover:bg-red-900/30"
                    }`}
                    title="Stop"
                  >
                    ⏹
                  </button>
                  <button
                    onClick={() => handleAction(service.name, "restart")}
                    disabled={actionInProgress === service.name}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all duration-200 ${
                      actionInProgress === service.name
                        ? "text-slate-600 cursor-not-allowed"
                        : "text-blue-400 hover:bg-blue-900/30"
                    }`}
                    title="Restart"
                  >
                    🔄
                  </button>
                </div>
              </div>

              {/* Expanded logs */}
              {expandedService === service.name && (
                <div className="px-5 py-3 bg-black/30 border-b border-slate-800/50 animate-fadeIn">
                  {logsLoading ? (
                    <div className="flex items-center gap-2 py-4 justify-center">
                      <span className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full" />
                      <span className="text-xs text-slate-500">
                        Loading logs...
                      </span>
                    </div>
                  ) : (
                    <pre className="font-mono text-xs text-slate-400 whitespace-pre-wrap leading-5 max-h-48 overflow-y-auto">
                      {logs || "No logs available"}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
