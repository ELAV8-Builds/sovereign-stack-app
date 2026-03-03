import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ServiceInfo {
  name: string;
  port: number | null;
  status: "Running" | "Stopped" | "Unknown";
  runtime: string;
}

export default function Dashboard() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch services status
  const fetchServicesStatus = async () => {
    try {
      const servicesData = await invoke<ServiceInfo[]>("get_services_status");
      setServices(servicesData);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch services:", err);
      setError(`Failed to fetch services: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch logs for selected service
  const fetchLogs = async (serviceName: string) => {
    setLogsLoading(true);
    try {
      const logsData = await invoke<string>("get_service_logs", {
        serviceName: serviceName,
        lines: 100,
      });
      setLogs(logsData);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      setLogs(`Error fetching logs: ${err}`);
    } finally {
      setLogsLoading(false);
    }
  };

  // Start service
  const handleStartService = async (serviceName: string) => {
    setActionInProgress(serviceName);
    try {
      await invoke<string>("start_service", { serviceName });
      await fetchServicesStatus();
    } catch (err) {
      console.error("Failed to start service:", err);
      setError(`Failed to start ${serviceName}: ${err}`);
    } finally {
      setActionInProgress(null);
    }
  };

  // Stop service
  const handleStopService = async (serviceName: string) => {
    setActionInProgress(serviceName);
    try {
      await invoke<string>("stop_service", { serviceName });
      await fetchServicesStatus();
    } catch (err) {
      console.error("Failed to stop service:", err);
      setError(`Failed to stop ${serviceName}: ${err}`);
    } finally {
      setActionInProgress(null);
    }
  };

  // Restart service
  const handleRestartService = async (serviceName: string) => {
    setActionInProgress(serviceName);
    try {
      await invoke<string>("restart_service", { serviceName });
      await fetchServicesStatus();
    } catch (err) {
      console.error("Failed to restart service:", err);
      setError(`Failed to restart ${serviceName}: ${err}`);
    } finally {
      setActionInProgress(null);
    }
  };

  // View logs for a service
  const handleViewLogs = (serviceName: string) => {
    setSelectedService(serviceName);
    fetchLogs(serviceName);
  };

  // Initial fetch and auto-refresh every 5 seconds
  useEffect(() => {
    fetchServicesStatus();
    const interval = setInterval(fetchServicesStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-refresh logs when service is selected
  useEffect(() => {
    if (selectedService) {
      const interval = setInterval(() => fetchLogs(selectedService), 5000);
      return () => clearInterval(interval);
    }
  }, [selectedService]);

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "Running":
        return "text-green-400 bg-green-900/20 border-green-600";
      case "Stopped":
        return "text-red-400 bg-red-900/20 border-red-600";
      default:
        return "text-yellow-400 bg-yellow-900/20 border-yellow-600";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">Sovereign Stack Dashboard</h1>
            <p className="text-slate-400">Manage and monitor your services</p>
          </div>
          <div className="flex space-x-3">
            <a
              href="#settings"
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded font-medium transition"
            >
              ⚙️ Settings
            </a>
            <button
              onClick={fetchServicesStatus}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium transition"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900/20 border border-red-600 rounded p-4 mb-6">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-semibold mb-1">Error</div>
                <p className="text-sm">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-300"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Services Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
          {loading ? (
            <div className="col-span-full flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
            </div>
          ) : (
            services.map((service) => (
              <div
                key={service.name}
                className="bg-slate-800 rounded-lg shadow-xl p-6 border border-slate-700"
              >
                {/* Service Header */}
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold mb-1">{service.name}</h3>
                    <p className="text-sm text-slate-400">{service.runtime}</p>
                    {service.port && (
                      <p className="text-xs text-slate-500">Port: {service.port}</p>
                    )}
                  </div>
                  <span
                    className={`px-3 py-1 rounded text-sm font-medium border ${getStatusColor(
                      service.status
                    )}`}
                  >
                    {service.status}
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <button
                    onClick={() => handleStartService(service.name)}
                    disabled={
                      service.status === "Running" ||
                      actionInProgress === service.name
                    }
                    className={`px-3 py-2 rounded text-sm font-medium transition ${
                      service.status === "Running" || actionInProgress === service.name
                        ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                        : "bg-green-600 hover:bg-green-700 text-white"
                    }`}
                  >
                    {actionInProgress === service.name ? "..." : "Start"}
                  </button>
                  <button
                    onClick={() => handleStopService(service.name)}
                    disabled={
                      service.status === "Stopped" ||
                      actionInProgress === service.name
                    }
                    className={`px-3 py-2 rounded text-sm font-medium transition ${
                      service.status === "Stopped" || actionInProgress === service.name
                        ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                        : "bg-red-600 hover:bg-red-700 text-white"
                    }`}
                  >
                    {actionInProgress === service.name ? "..." : "Stop"}
                  </button>
                  <button
                    onClick={() => handleRestartService(service.name)}
                    disabled={actionInProgress === service.name}
                    className={`px-3 py-2 rounded text-sm font-medium transition ${
                      actionInProgress === service.name
                        ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                        : "bg-blue-600 hover:bg-blue-700 text-white"
                    }`}
                  >
                    {actionInProgress === service.name ? "..." : "Restart"}
                  </button>
                </div>

                {/* View Logs Button */}
                <button
                  onClick={() => handleViewLogs(service.name)}
                  className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition"
                >
                  View Logs
                </button>
              </div>
            ))
          )}
        </div>

        {/* Log Viewer */}
        {selectedService && (
          <div className="bg-slate-800 rounded-lg shadow-xl p-6 border border-slate-700">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">
                {selectedService} Logs
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => fetchLogs(selectedService)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition"
                >
                  Refresh Logs
                </button>
                <button
                  onClick={() => setSelectedService(null)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="bg-black/50 rounded p-4 font-mono text-sm overflow-auto max-h-96">
              {logsLoading ? (
                <div className="flex justify-center items-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
                </div>
              ) : logs ? (
                <pre className="whitespace-pre-wrap text-slate-300">{logs}</pre>
              ) : (
                <p className="text-slate-500">No logs available</p>
              )}
            </div>
          </div>
        )}

        {/* Service Overview Stats */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
            <div className="text-sm text-slate-400 mb-1">Total Services</div>
            <div className="text-3xl font-bold">{services.length}</div>
          </div>
          <div className="bg-slate-800 rounded-lg p-6 border border-green-700">
            <div className="text-sm text-slate-400 mb-1">Running</div>
            <div className="text-3xl font-bold text-green-400">
              {services.filter((s) => s.status === "Running").length}
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg p-6 border border-red-700">
            <div className="text-sm text-slate-400 mb-1">Stopped</div>
            <div className="text-3xl font-bold text-red-400">
              {services.filter((s) => s.status === "Stopped").length}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
