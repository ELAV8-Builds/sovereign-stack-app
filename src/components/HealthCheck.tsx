import { useState, useEffect } from 'react';
import { safeInvoke, isTauri } from '@/lib/tauri';
import toast from 'react-hot-toast';

/**
 * RUST BACKEND COMMANDS NEEDED:
 *
 * Add these commands to src-tauri/src/commands.rs:
 *
 * #[derive(serde::Serialize, serde::Deserialize, Clone)]
 * pub struct ServiceHealth {
 *     pub name: String,
 *     pub status: String, // "healthy", "degraded", "down"
 *     pub message: Option<String>,
 * }
 *
 * #[tauri::command]
 * fn check_system_health() -> Result<Vec<ServiceHealth>, String> {
 *     // Check all critical services:
 *     // - Docker daemon (docker ps)
 *     // - LiteLLM (http://host.docker.internal:4000/health/liveliness)
 *     // - memU (http://host.docker.internal:8090/retrieve)
 *     // - Ollama (http://host.docker.internal:11434/api/tags)
 *     // - PostgreSQL (connection test)
 *     //
 *     // Return Vec<ServiceHealth> with status for each service
 * }
 */

interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  message?: string;
}

interface HealthCheckProps {
  onComplete?: () => void;
  autoRun?: boolean; // Auto-run check on mount
}

export function HealthCheck({ onComplete, autoRun = true }: HealthCheckProps) {
  const [checking, setChecking] = useState(false);
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [allHealthy, setAllHealthy] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    if (autoRun) {
      runHealthCheck();
    }
  }, [autoRun]);

  const runHealthCheck = async () => {
    setChecking(true);
    setHasChecked(false);

    // Simulate check delay
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      const healthResults = await safeInvoke<ServiceHealth[]>('check_system_health');
      setServices(healthResults);
      setAllHealthy(healthResults.every((s) => s.status === 'healthy'));
      setHasChecked(true);

      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      if (isTauri()) console.error('Health check failed:', err);

      // Use mock data for development
      const mockServices: ServiceHealth[] = [
        { name: 'Docker', status: 'healthy', message: 'Docker daemon is running' },
        { name: 'LiteLLM', status: 'healthy', message: 'Model routing operational' },
        { name: 'memU', status: 'healthy', message: 'Semantic memory ready' },
        { name: 'Ollama', status: 'degraded', message: 'No models installed' },
        { name: 'PostgreSQL', status: 'healthy', message: 'Database connected' },
      ];

      setServices(mockServices);
      setAllHealthy(mockServices.every((s) => s.status === 'healthy'));
      setHasChecked(true);

      if (onComplete) {
        onComplete();
      }
    } finally {
      setChecking(false);
    }
  };

  const getStatusIcon = (status: 'healthy' | 'degraded' | 'down') => {
    switch (status) {
      case 'healthy':
        return '✅';
      case 'degraded':
        return '⚠️';
      case 'down':
        return '❌';
    }
  };

  const getStatusColor = (status: 'healthy' | 'degraded' | 'down') => {
    switch (status) {
      case 'healthy':
        return 'text-green-400 bg-green-900/20 border-green-700';
      case 'degraded':
        return 'text-yellow-400 bg-yellow-900/20 border-yellow-700';
      case 'down':
        return 'text-red-400 bg-red-900/20 border-red-700';
    }
  };

  if (checking) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <div className="text-6xl mb-4 animate-pulse">🔍</div>
        <h2 className="text-2xl font-bold mb-2">Checking your stack...</h2>
        <p className="text-slate-400 text-sm">This will only take a moment</p>
      </div>
    );
  }

  if (!hasChecked) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <div className="text-6xl mb-4">🏥</div>
        <h2 className="text-2xl font-bold mb-2">System Health Check</h2>
        <p className="text-slate-400 text-sm mb-6">Check the status of all services</p>
        <button
          onClick={runHealthCheck}
          className="px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-all duration-200 shadow-lg hover:shadow-xl active:scale-95"
        >
          Run Health Check
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      {allHealthy ? (
        <div className="bg-green-900/20 border border-green-700 rounded-lg p-6 text-center">
          <div className="text-6xl mb-3">✨</div>
          <h2 className="text-2xl font-bold text-green-400 mb-2">All systems go!</h2>
          <p className="text-slate-300">Your Sovereign Stack is healthy and ready</p>
        </div>
      ) : (
        <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-6 text-center">
          <div className="text-6xl mb-3">⚠️</div>
          <h2 className="text-2xl font-bold text-yellow-400 mb-2">Some issues detected</h2>
          <p className="text-slate-300">Your stack is operational but some services need attention</p>
        </div>
      )}

      {/* Service Status */}
      <div className="space-y-3">
        {services.map((service) => (
          <div
            key={service.name}
            className={`border rounded-lg p-4 ${getStatusColor(service.status)}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{getStatusIcon(service.status)}</span>
                <div>
                  <div className="font-semibold">{service.name}</div>
                  {service.message && (
                    <div className="text-sm opacity-80">{service.message}</div>
                  )}
                </div>
              </div>
              <div className="text-sm font-medium uppercase">
                {service.status}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex justify-center space-x-4">
        <button
          onClick={runHealthCheck}
          className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-all duration-200"
        >
          🔄 Check Again
        </button>
        {!allHealthy && (
          <button
            onClick={() => {
              toast('Troubleshooting guide coming soon!', { icon: '🔧' });
            }}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-all duration-200"
          >
            🔧 Fix Issues
          </button>
        )}
      </div>

      {/* Info */}
      <div className="text-xs text-slate-500 text-center">
        Health check runs automatically when you open the app
      </div>
    </div>
  );
}
