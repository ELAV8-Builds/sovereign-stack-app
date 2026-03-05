import { useState } from 'react';
import { safeInvoke, isTauri, friendlyError } from '@/lib/tauri';
import toast from 'react-hot-toast';

/**
 * RUST BACKEND COMMANDS NEEDED:
 *
 * Add these commands to src-tauri/src/commands.rs:
 *
 * #[derive(serde::Serialize, serde::Deserialize)]
 * pub struct ConfigExport {
 *     pub env_vars: HashMap<String, String>,
 *     pub registered_groups: serde_json::Value,
 *     pub autonomy_prefs: AutonomyPrefs,
 *     pub agent_name: String,
 *     pub network_mode: String,
 *     pub exported_at: String, // ISO timestamp
 * }
 *
 * #[tauri::command]
 * fn export_config() -> Result<String, String> {
 *     // Collect all config:
 *     // - .env file contents (sanitize sensitive keys)
 *     // - registered_groups.json
 *     // - Autonomy preferences
 *     // - Agent name
 *     // - Network mode
 *     //
 *     // Serialize to JSON
 *     // Encrypt with user's password (or skip encryption for v1)
 *     // Return base64-encoded config string
 * }
 *
 * #[tauri::command]
 * fn import_config(config_data: String) -> Result<(), String> {
 *     // Decrypt if needed
 *     // Parse JSON
 *     // Write to .env, registered_groups.json, etc.
 *     // Validate all settings
 *     // Return Ok(()) on success
 * }
 */

export function BackupExport() {
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setExportSuccess(false);

    try {
      // Get config from backend
      const configData = await safeInvoke<string>('export_config');

      // Create download
      const blob = new Blob([configData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sovereign-stack-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (err) {
      if (isTauri()) console.error('Export failed:', err);
      setError('Export failed: ' + friendlyError(err, 'Export feature is not available yet.'));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setError(null);

    try {
      toast('Import coming soon! For now, manually copy backup files to the config directory.', { icon: '📤', duration: 4000 });
    } catch (err) {
      if (isTauri()) console.error('Import failed:', err);
      setError('Import failed: ' + friendlyError(err, 'Import feature is not available yet.'));
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400">
        Export your configuration to backup or transfer to another machine. Imports are not yet
        implemented but you can manually restore from exported files.
      </p>

      {/* Export Section */}
      <div className="bg-slate-700 border border-slate-600 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-lg mb-1 flex items-center space-x-2">
              <span>💾</span>
              <span>Export Configuration</span>
            </h3>
            <p className="text-sm text-slate-400">
              Save all your settings to a JSON file
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className={`px-6 py-2 rounded-lg font-semibold transition-all duration-200 shadow-lg ${
              exporting
                ? 'bg-slate-600 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 hover:shadow-xl active:scale-95'
            }`}
          >
            {exporting ? '⏳ Exporting...' : '📥 Export'}
          </button>
        </div>

        <div className="bg-slate-800 rounded p-4 text-xs text-slate-400">
          <div className="font-medium text-slate-300 mb-2">Exported data includes:</div>
          <ul className="space-y-1">
            <li>• Environment variables (.env)</li>
            <li>• Registered groups and channels</li>
            <li>• Autonomy preferences</li>
            <li>• Agent name and avatar</li>
            <li>• Network isolation mode</li>
          </ul>
        </div>
      </div>

      {/* Import Section (Disabled for now) */}
      <div className="bg-slate-700 border border-slate-600 rounded-lg p-6 opacity-60">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-lg mb-1 flex items-center space-x-2">
              <span>📤</span>
              <span>Import Configuration</span>
            </h3>
            <p className="text-sm text-slate-400">
              Restore settings from a backup file
            </p>
          </div>
          <button
            onClick={handleImport}
            disabled={true}
            className="px-6 py-2 bg-slate-600 rounded-lg font-semibold cursor-not-allowed"
          >
            📤 Import (Coming Soon)
          </button>
        </div>

        <div className="bg-slate-800 rounded p-4 text-xs text-slate-400">
          <div className="font-medium text-slate-300 mb-2">⚠️ Manual Import Instructions:</div>
          <ul className="space-y-1">
            <li>1. Locate your exported JSON file</li>
            <li>2. Copy .env values to your .env file</li>
            <li>3. Update registered_groups.json in data/</li>
            <li>4. Restart Sovereign Stack</li>
          </ul>
        </div>
      </div>

      {/* Status Messages */}
      {exportSuccess && (
        <div className="flex items-center gap-2 p-3 bg-green-900/30 border border-green-700 rounded text-sm text-green-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Configuration exported successfully!
        </div>
      )}


      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {/* Warning */}
      <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <div className="text-yellow-400 text-xl">⚠️</div>
          <div className="text-sm text-yellow-200">
            <strong>Security Note:</strong> Backup files contain sensitive information including API
            keys and tokens. Store them securely and never share them publicly.
          </div>
        </div>
      </div>
    </div>
  );
}
