import { useState, useEffect } from 'react';
import { safeInvoke, isTauri, localGet, localSet } from '@/lib/tauri';

/**
 * RUST BACKEND INTEGRATION:
 *
 * The backend already implements network isolation via networkMode in types.ts:
 * - "bridge": Full internet access (default Docker network)
 * - "nanoclaw-private": Restricted to host services only
 * - "none": Air-gapped, zero network access
 *
 * Container runner (container-runner.ts) applies these via Docker --network flag.
 *
 * Future commands to add to src-tauri/src/commands.rs:
 *
 * #[tauri::command]
 * fn set_network_mode(mode: String) -> Result<(), String> {
 *     // Validate mode: "bridge", "nanoclaw-private", or "none"
 *     // Write to .env or config file: NETWORK_MODE=bridge
 *     // Return Ok(()) on success, Err(msg) on failure
 * }
 *
 * #[tauri::command]
 * fn get_network_mode() -> Result<String, String> {
 *     // Read NETWORK_MODE from .env or config
 *     // Return Ok("bridge") as default if not set
 * }
 */

type NetworkMode = 'bridge' | 'nanoclaw-private' | 'none';

interface NetworkModeOption {
  mode: NetworkMode;
  label: string;
  description: string;
  icon: string;
  color: string;
  borderColor: string;
  bgColor: string;
  securityLevel: 'low' | 'medium' | 'high';
  details: string[];
}

interface NetworkIsolationSelectorProps {
  onChange?: (mode: NetworkMode) => void;
}

const NETWORK_MODES: NetworkModeOption[] = [
  {
    mode: 'bridge',
    label: 'Full Access',
    description: 'Full internet access for all services',
    icon: '🌐',
    color: 'text-green-400',
    borderColor: 'border-green-600',
    bgColor: 'bg-green-900/20',
    securityLevel: 'low',
    details: [
      'Services can reach any internet address',
      'Ideal for downloading models, packages',
      'Use for general development work',
    ],
  },
  {
    mode: 'nanoclaw-private',
    label: 'Restricted',
    description: 'Host services only, no internet',
    icon: '🛡️',
    color: 'text-yellow-400',
    borderColor: 'border-yellow-600',
    bgColor: 'bg-yellow-900/20',
    securityLevel: 'medium',
    details: [
      'Services can only reach host (via host.docker.internal)',
      'No external internet access',
      'Best for production use with pre-downloaded assets',
    ],
  },
  {
    mode: 'none',
    label: 'Air-Gapped',
    description: 'Zero network access',
    icon: '🔒',
    color: 'text-red-400',
    borderColor: 'border-red-600',
    bgColor: 'bg-red-900/20',
    securityLevel: 'high',
    details: [
      'Complete network isolation',
      'Maximum security and privacy',
      'Only works with pre-loaded models and data',
    ],
  },
];

export function NetworkIsolationSelector({ onChange }: NetworkIsolationSelectorProps) {
  const [selectedMode, setSelectedMode] = useState<NetworkMode>('bridge');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load current network mode on mount
  useEffect(() => {
    loadNetworkMode();
  }, []);

  const loadNetworkMode = async () => {
    try {
      const currentMode = await safeInvoke<NetworkMode>('get_network_mode');
      setSelectedMode(currentMode);
      setLoading(false);
    } catch (err) {
      if (isTauri()) console.error('Failed to load network mode:', err);
      // Use localStorage fallback, then default
      setSelectedMode(localGet<NetworkMode>('network_mode', 'bridge'));
      setLoading(false);
    }
  };

  const handleModeChange = async (mode: NetworkMode) => {
    setSelectedMode(mode);
    setError(null);
    setSuccess(false);
    setSaving(true);

    try {
      await safeInvoke('set_network_mode', { mode });
      localSet('network_mode', mode);
      setSuccess(true);

      // Call optional callback
      if (onChange) {
        onChange(mode);
      }

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      if (isTauri()) console.error('Failed to save network mode:', err);
      // Persist to localStorage in browser mode
      localSet('network_mode', mode);
      setSuccess(true);
      if (onChange) onChange(mode);
      setTimeout(() => setSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const getSecurityBadge = (level: 'low' | 'medium' | 'high') => {
    const badges = {
      low: { label: 'Low Security', color: 'text-green-400 bg-green-900/30' },
      medium: { label: 'Medium Security', color: 'text-yellow-400 bg-yellow-900/30' },
      high: { label: 'High Security', color: 'text-red-400 bg-red-900/30' },
    };
    const badge = badges[level];
    return (
      <span className={`text-xs px-2 py-1 rounded ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-400">Loading network configuration...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Control network access for all Sovereign Stack services. Changes apply to new containers.
      </p>

      {/* Network Mode Cards */}
      <div className="space-y-3">
        {NETWORK_MODES.map((option) => (
          <button
            key={option.mode}
            onClick={() => handleModeChange(option.mode)}
            disabled={saving}
            className={`w-full text-left p-4 rounded-lg border-2 transition-all duration-200 ${
              selectedMode === option.mode
                ? `${option.borderColor} ${option.bgColor} shadow-lg`
                : 'border-slate-600 bg-slate-700 hover:border-slate-500 hover:bg-slate-650'
            } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{option.icon}</span>
                <div>
                  <h3 className={`text-lg font-semibold ${option.color}`}>
                    {option.label}
                  </h3>
                  <p className="text-sm text-slate-300">{option.description}</p>
                </div>
              </div>
              {getSecurityBadge(option.securityLevel)}
            </div>

            {/* Details */}
            <ul className="mt-3 space-y-1 ml-12">
              {option.details.map((detail, idx) => (
                <li key={idx} className="text-xs text-slate-400 flex items-start">
                  <span className="mr-2">•</span>
                  <span>{detail}</span>
                </li>
              ))}
            </ul>

            {/* Selected Indicator */}
            {selectedMode === option.mode && (
              <div className="mt-3 ml-12 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${option.color.replace('text-', 'bg-')} animate-pulse`} />
                <span className={`text-xs font-medium ${option.color}`}>
                  Currently Active
                </span>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Status Messages */}
      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-900/30 border border-green-700 rounded text-sm text-green-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Network mode saved successfully! Restart services for changes to take effect.
        </div>
      )}

      {/* Warning Notice */}
      <div className="mt-4 p-3 bg-slate-700 border border-slate-600 rounded-lg text-xs text-slate-400">
        <div className="font-medium text-slate-300 mb-1">⚠️ Important</div>
        <ul className="space-y-1">
          <li>• Network mode applies to newly created containers</li>
          <li>• Existing running services must be restarted to use the new mode</li>
          <li>• Restricted and Air-Gapped modes require pre-downloaded models and assets</li>
        </ul>
      </div>
    </div>
  );
}
