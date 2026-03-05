import { useState, useEffect } from 'react';
import { safeInvoke, isTauri, localGet, localSet } from '@/lib/tauri';

/**
 * RUST BACKEND COMMANDS NEEDED:
 *
 * Add these commands to src-tauri/src/commands.rs:
 *
 * #[tauri::command]
 * fn set_agent_name(name: String) -> Result<(), String> {
 *     // Write ASSISTANT_NAME to .env file
 *     // Example: ASSISTANT_NAME=Bizo
 *     // Return Ok(()) on success, Err(msg) on failure
 * }
 *
 * #[tauri::command]
 * fn get_agent_name() -> Result<String, String> {
 *     // Read ASSISTANT_NAME from .env file
 *     // Return Ok("Bizo") as default if not set
 *     // Return Err(msg) on failure
 * }
 */

interface AgentNamingProps {
  onSave?: (name: string, avatar: string) => void;
}

const AVATARS = [
  { emoji: '🤖', label: 'Robot' },
  { emoji: '🧠', label: 'Brain' },
  { emoji: '⚡', label: 'Lightning' },
  { emoji: '🎯', label: 'Target' },
  { emoji: '💡', label: 'Lightbulb' },
];

export function AgentNaming({ onSave }: AgentNamingProps) {
  const [name, setName] = useState('Bizo');
  const [selectedAvatar, setSelectedAvatar] = useState('🤖');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load current agent name on mount
  useEffect(() => {
    loadAgentName();
  }, []);

  const loadAgentName = async () => {
    try {
      const currentName = await safeInvoke<string>('get_agent_name');
      setName(currentName);
      setLoading(false);
    } catch (err) {
      if (isTauri()) console.error('Failed to load agent name:', err);
      // Use localStorage fallback, then default
      setName(localGet('agent_name', 'Bizo'));
      setLoading(false);
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Validate: max 20 characters, alphanumeric + spaces only
    if (value.length <= 20 && /^[a-zA-Z0-9\s]*$/.test(value)) {
      setName(value);
      setError(null);
    } else if (value.length > 20) {
      setError('Name must be 20 characters or less');
    } else {
      setError('Only letters, numbers, and spaces allowed');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await safeInvoke('set_agent_name', { name: name.trim() });
      localSet('agent_name', name.trim());
      setSuccess(true);

      // Call optional callback
      if (onSave) {
        onSave(name.trim(), selectedAvatar);
      }

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      if (isTauri()) console.error('Failed to save agent name:', err);
      // Persist to localStorage in browser mode
      localSet('agent_name', name.trim());
      setSuccess(true);
      if (onSave) onSave(name.trim(), selectedAvatar);
      setTimeout(() => setSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-md">
      <p className="text-sm text-slate-400 mb-4">
        Give your agent a name you'll enjoy using. You can change this anytime.
      </p>

      {/* Name Input */}
      <div className="mb-4">
        <label htmlFor="agent-name" className="block text-sm font-medium text-slate-300 mb-2">
          Name
        </label>
        <input
          id="agent-name"
          type="text"
          value={name}
          onChange={handleNameChange}
          placeholder="Enter agent name"
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          maxLength={20}
        />
        <div className="flex justify-between mt-1">
          <span className="text-xs text-slate-400">
            {name.length}/20 characters
          </span>
          {error && (
            <span className="text-xs text-red-400">{error}</span>
          )}
        </div>
      </div>

      {/* Avatar Picker */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Avatar (Optional)
        </label>
        <div className="flex gap-2">
          {AVATARS.map((avatar) => (
            <button
              key={avatar.emoji}
              onClick={() => setSelectedAvatar(avatar.emoji)}
              className={`w-12 h-12 flex items-center justify-center text-2xl rounded-lg border-2 transition-all ${
                selectedAvatar === avatar.emoji
                  ? 'border-blue-500 bg-slate-700 scale-110'
                  : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700'
              }`}
              title={avatar.label}
            >
              {avatar.emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Live Preview */}
      <div className="mb-4 p-4 bg-slate-700 rounded-lg border border-slate-600">
        <p className="text-sm text-slate-400 mb-2">Preview:</p>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{selectedAvatar}</span>
          <p className="text-base text-white">
            Hi, I'm <strong>{name || 'Bizo'}</strong>! How can I help you today?
          </p>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim() || !!error}
          className={`px-4 py-2 rounded-md font-medium transition-colors ${
            saving || !name.trim() || !!error
              ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>

        {success && (
          <span className="flex items-center gap-1 text-sm text-green-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Saved successfully!
          </span>
        )}
      </div>
    </div>
  );
}
