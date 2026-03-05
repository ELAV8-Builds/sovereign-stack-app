import { useState, useEffect } from 'react';
import { safeInvoke, isTauri, localGet, localSet } from '@/lib/tauri';

/**
 * RUST BACKEND INTEGRATION:
 *
 * This component calls the following Rust commands (to be implemented):
 *
 * #[derive(serde::Serialize, serde::Deserialize, Clone)]
 * pub struct AutonomyPrefs {
 *     pub network_access: bool,
 *     pub file_access: bool,
 *     pub auto_execute: bool,
 * }
 *
 * #[tauri::command]
 * fn save_autonomy_preferences(prefs: AutonomyPrefs) -> Result<(), String> {
 *     // Write to .env or config file
 *     // NETWORK_ACCESS=true
 *     // FILE_ACCESS=true
 *     // AUTO_EXECUTE=true
 * }
 *
 * #[tauri::command]
 * fn get_autonomy_preferences() -> Result<AutonomyPrefs, String> {
 *     // Read from .env or config
 *     // Default: all true
 * }
 */

interface AutonomyPrefs {
  network_access: boolean;
  file_access: boolean;
  auto_execute: boolean;
}

export function AutonomySettings() {
  const [preferences, setPreferences] = useState<AutonomyPrefs>({
    network_access: true,
    file_access: true,
    auto_execute: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load preferences on mount
  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const prefs = await safeInvoke<AutonomyPrefs>('get_autonomy_preferences');
      setPreferences(prefs);
      setLoading(false);
    } catch (err) {
      if (isTauri()) console.error('Failed to load autonomy preferences:', err);
      // Use localStorage fallback, then defaults
      const defaults: AutonomyPrefs = {
        network_access: true,
        file_access: true,
        auto_execute: true,
      };
      setPreferences(localGet<AutonomyPrefs>('autonomy_prefs', defaults));
      setLoading(false);
    }
  };

  const togglePreference = (key: keyof AutonomyPrefs) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    setSuccess(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await safeInvoke('save_autonomy_preferences', { prefs: preferences });
      localSet('autonomy_prefs', preferences);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      if (isTauri()) console.error('Failed to save autonomy preferences:', err);
      // Persist to localStorage in browser mode
      localSet('autonomy_prefs', preferences);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-400">Loading autonomy settings...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Control what your agent can do. These settings affect all agent operations.
      </p>

      {/* Autonomy Toggles */}
      <div className="space-y-3">
        {/* Network Access */}
        <div
          onClick={() => togglePreference('network_access')}
          className={`cursor-pointer rounded-lg p-4 border-2 transition-all duration-200 ${
            preferences.network_access
              ? 'bg-green-900/20 border-green-700'
              : 'bg-slate-900/50 border-slate-600 hover:border-slate-500'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3 flex-1">
              <div className="text-2xl">🌐</div>
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-1">Network access</h3>
                <p className="text-slate-400 text-xs">
                  Allow agent to access the internet for fetching data, downloading models, and web
                  browsing.
                </p>
              </div>
            </div>
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                preferences.network_access
                  ? 'bg-green-500 border-green-500'
                  : 'border-slate-500'
              }`}
            >
              {preferences.network_access && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* File Access */}
        <div
          onClick={() => togglePreference('file_access')}
          className={`cursor-pointer rounded-lg p-4 border-2 transition-all duration-200 ${
            preferences.file_access
              ? 'bg-blue-900/20 border-blue-700'
              : 'bg-slate-900/50 border-slate-600 hover:border-slate-500'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3 flex-1">
              <div className="text-2xl">📁</div>
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-1">File access</h3>
                <p className="text-slate-400 text-xs">
                  Allow agent to read and write files in directories you explicitly share (workspace
                  folders only).
                </p>
              </div>
            </div>
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                preferences.file_access ? 'bg-blue-500 border-blue-500' : 'border-slate-500'
              }`}
            >
              {preferences.file_access && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* Auto-execute */}
        <div
          onClick={() => togglePreference('auto_execute')}
          className={`cursor-pointer rounded-lg p-4 border-2 transition-all duration-200 ${
            preferences.auto_execute
              ? 'bg-yellow-900/20 border-yellow-700'
              : 'bg-slate-900/50 border-slate-600 hover:border-slate-500'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3 flex-1">
              <div className="text-2xl">⚡</div>
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-1">Auto-execute commands</h3>
                <p className="text-slate-400 text-xs">
                  Allow agent to run bash commands automatically without asking. Recommended for
                  experienced users.
                </p>
              </div>
            </div>
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                preferences.auto_execute
                  ? 'bg-yellow-500 border-yellow-500'
                  : 'border-slate-500'
              }`}
            >
              {preferences.auto_execute && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg active:scale-95 ${
            saving ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {saving ? '💾 Saving...' : '💾 Save Preferences'}
        </button>
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
          Preferences saved successfully!
        </div>
      )}

      {/* Warning Notice */}
      <div className="mt-4 p-3 bg-slate-700 border border-slate-600 rounded-lg text-xs text-slate-400">
        <div className="font-medium text-slate-300 mb-1">⚠️ Security Notice</div>
        <ul className="space-y-1">
          <li>• Disabling network access prevents agent from browsing web or downloading models</li>
          <li>• Disabling file access restricts agent to read-only operations in shared folders</li>
          <li>• Disabling auto-execute requires manual approval for each command</li>
        </ul>
      </div>
    </div>
  );
}
