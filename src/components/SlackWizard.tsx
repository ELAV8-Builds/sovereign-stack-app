import { useState } from 'react';
import { safeInvoke, isTauri } from '@/lib/tauri';
import toast from 'react-hot-toast';

/**
 * RUST BACKEND COMMANDS NEEDED:
 *
 * Add these commands to src-tauri/src/commands.rs:
 *
 * #[derive(serde::Serialize, serde::Deserialize, Clone)]
 * pub struct Channel {
 *     pub id: String,
 *     pub name: String,
 * }
 *
 * #[tauri::command]
 * fn validate_slack_token(token: String) -> Result<bool, String> {
 *     // Validate token format (xapp- or xoxb- prefix)
 *     // Optional: Test with Slack API auth.test endpoint
 *     // Return Ok(true) if valid, Err(msg) if invalid
 * }
 *
 * #[tauri::command]
 * fn test_slack_connection(app_token: String, bot_token: String) -> Result<Vec<Channel>, String> {
 *     // Connect to Slack via Socket Mode with app_token
 *     // Use bot_token to call conversations.list API
 *     // Fetch public channels and private channels agent has access to
 *     // Return Vec<Channel> with id and name for each channel
 *     // Err(msg) on connection failure
 * }
 *
 * #[tauri::command]
 * fn save_slack_tokens(app_token: String, bot_token: String) -> Result<(), String> {
 *     // Write to .env file:
 *     // SLACK_APP_TOKEN=xapp-...
 *     // SLACK_BOT_TOKEN=xoxb-...
 *     // SLACK_ONLY=true (to skip WhatsApp requirement)
 *     // Return Ok(()) on success, Err(msg) on failure
 * }
 *
 * #[tauri::command]
 * fn register_slack_channel(channel_id: String, name: String, trigger: String) -> Result<(), String> {
 *     // Add entry to registered_groups.json:
 *     // {
 *     //   "[channel_id]": {
 *     //     "name": "[name]",
 *     //     "folder": "[name-lowercase-hyphenated]",
 *     //     "trigger": "[trigger]",
 *     //     "added_at": "[ISO timestamp]"
 *     //   }
 *     // }
 *     // Create group folder: groups/[folder-name]/
 *     // Return Ok(()) on success, Err(msg) on failure
 * }
 */

interface Channel {
  id: string;
  name: string;
}

interface SlackWizardProps {
  onComplete: () => void;
  onCancel?: () => void;
  embedded?: boolean; // true for onboarding, false for Settings
}

export function SlackWizard({ onComplete, onCancel, embedded = false }: SlackWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [appToken, setAppToken] = useState('');
  const [botToken, setBotToken] = useState('');
  const [appTokenValid, setAppTokenValid] = useState(false);
  const [botTokenValid, setBotTokenValid] = useState(false);
  const [appTokenError, setAppTokenError] = useState('');
  const [botTokenError, setBotTokenError] = useState('');

  const [testing, setTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [testError, setTestError] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);

  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [triggerWord, setTriggerWord] = useState('@Andy');
  const [groupNameError, setGroupNameError] = useState('');
  const [registering, setRegistering] = useState(false);

  // Step 1: Open Slack App Creator
  const handleOpenSlackCreator = () => {
    window.open('https://api.slack.com/apps', '_blank');
  };

  // Step 2: Token validation
  const validateAppToken = (token: string) => {
    setAppToken(token);
    if (token.startsWith('xapp-')) {
      setAppTokenValid(true);
      setAppTokenError('');
    } else if (token.length > 0) {
      setAppTokenValid(false);
      setAppTokenError('App token must start with xapp-');
    } else {
      setAppTokenValid(false);
      setAppTokenError('');
    }
  };

  const validateBotToken = (token: string) => {
    setBotToken(token);
    if (token.startsWith('xoxb-')) {
      setBotTokenValid(true);
      setBotTokenError('');
    } else if (token.length > 0) {
      setBotTokenValid(false);
      setBotTokenError('Bot token must start with xoxb-');
    } else {
      setBotTokenValid(false);
      setBotTokenError('');
    }
  };

  const canProceedFromStep2 = appTokenValid && botTokenValid;

  // Step 3: Test connection
  const handleTestConnection = async () => {
    setTesting(true);
    setTestError('');
    setTestSuccess(false);

    try {
      const channelList = await safeInvoke<Channel[]>('test_slack_connection', {
        appToken,
        botToken,
      });

      setChannels(channelList);
      setTestSuccess(true);
      setTestError('');

      // Auto-save tokens on successful connection
      await safeInvoke('save_slack_tokens', { appToken, botToken });
    } catch (err) {
      if (isTauri()) console.error('Connection test failed:', err);
      setTestError(err as string || 'Connection failed. Please check your tokens and try again.');
      setTestSuccess(false);
    } finally {
      setTesting(false);
    }
  };

  // Step 4: Register channel
  const validateGroupName = (name: string) => {
    setGroupName(name);
    if (name.length === 0) {
      setGroupNameError('');
      return;
    }
    // Only lowercase letters, numbers, and hyphens
    if (!/^[a-z0-9-]+$/.test(name)) {
      setGroupNameError('Only lowercase letters, numbers, and hyphens allowed');
    } else {
      setGroupNameError('');
    }
  };

  const canCompleteSetup = selectedChannelId && groupName && !groupNameError && triggerWord;

  const handleCompleteSetup = async () => {
    if (!canCompleteSetup) return;

    setRegistering(true);
    try {
      await safeInvoke('register_slack_channel', {
        channelId: selectedChannelId,
        name: groupName,
        trigger: triggerWord,
      });

      onComplete();
    } catch (err) {
      if (isTauri()) console.error('Failed to register channel:', err);
      toast.error('Failed to register channel: ' + err);
    } finally {
      setRegistering(false);
    }
  };

  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    } else if (onCancel) {
      onCancel();
    }
  };

  return (
    <div className={embedded ? 'min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-center p-8' : ''}>
      <div className="max-w-3xl w-full">
        {/* Progress Indicator */}
        <div className="flex items-center justify-center mb-8 space-x-2">
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-3 h-3 rounded-full transition-all duration-300 ${
                  step === currentStep
                    ? 'bg-blue-500 scale-125'
                    : step < currentStep
                    ? 'bg-green-500'
                    : 'bg-slate-600'
                }`}
              />
              {step < 4 && (
                <div
                  className={`w-8 h-0.5 mx-1 transition-all duration-300 ${
                    step < currentStep ? 'bg-green-500' : 'bg-slate-600'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Open Slack App Creator */}
        {currentStep === 1 && (
          <div className="bg-slate-800 rounded-xl p-8 shadow-2xl border border-slate-700">
            <div className="mb-6">
              <h1 className="text-3xl font-bold mb-2">Set up your Slack bot</h1>
              <p className="text-slate-400">Create a new Slack app to connect your agent</p>
            </div>

            <div className="mb-6">
              <button
                onClick={handleOpenSlackCreator}
                className="w-full px-6 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 rounded-lg font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center space-x-2"
              >
                <span>🚀</span>
                <span>Open Slack App Creator</span>
              </button>
            </div>

            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6 mb-6">
              <h3 className="font-semibold text-lg mb-4 flex items-center space-x-2">
                <span>📋</span>
                <span>Configuration Checklist</span>
              </h3>

              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <div className="text-green-400 text-xl mt-0.5">□</div>
                  <div>
                    <div className="font-medium">Enable Socket Mode</div>
                    <div className="text-sm text-slate-400">Settings → Socket Mode → Enable</div>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <div className="text-green-400 text-xl mt-0.5">□</div>
                  <div>
                    <div className="font-medium">Subscribe to Bot Events</div>
                    <div className="text-sm text-slate-400">
                      Event Subscriptions → Subscribe to bot events:
                    </div>
                    <div className="text-xs text-slate-500 mt-1 ml-4">
                      • message.channels<br/>
                      • message.groups<br/>
                      • message.im
                    </div>
                  </div>
                </div>

                <div className="flex items-start space-x-3">
                  <div className="text-green-400 text-xl mt-0.5">□</div>
                  <div>
                    <div className="font-medium">Add OAuth Scopes</div>
                    <div className="text-sm text-slate-400">OAuth & Permissions → Bot Token Scopes:</div>
                    <div className="text-xs text-slate-500 mt-1 ml-4 space-y-1">
                      <div><strong>chat:write</strong> - Send messages</div>
                      <div><strong>channels:history</strong> - Read channel history</div>
                      <div><strong>groups:history</strong> - Read private channel history</div>
                      <div><strong>im:history</strong> - Read DM history</div>
                      <div><strong>channels:read</strong> - List channels</div>
                      <div><strong>groups:read</strong> - List private channels</div>
                      <div><strong>users:read</strong> - Get user info</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Video Placeholder */}
            <div className="bg-slate-900/50 border-2 border-dashed border-slate-600 rounded-lg p-12 mb-6 text-center cursor-pointer hover:border-blue-500 transition-colors">
              <div className="text-6xl mb-3">▶️</div>
              <p className="text-slate-400 text-sm">VIDEO: Slack App Creation Walkthrough</p>
              <p className="text-xs text-slate-500 mt-2">(5 min step-by-step guide)</p>
            </div>

            {/* Navigation */}
            <div className="flex justify-between">
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="px-8 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-all duration-200"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-all duration-200 shadow-lg hover:shadow-xl active:scale-95 ml-auto"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Token Inputs */}
        {currentStep === 2 && (
          <div className="bg-slate-800 rounded-xl p-8 shadow-2xl border border-slate-700">
            <div className="mb-6">
              <h1 className="text-3xl font-bold mb-2">Paste your Slack tokens</h1>
              <p className="text-slate-400">Find these in your Slack app settings</p>
            </div>

            <div className="space-y-6 mb-6">
              {/* App Token */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  App-Level Token
                  <span className="text-slate-500 ml-2 text-xs">(Socket Mode token)</span>
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={appToken}
                    onChange={(e) => validateAppToken(e.target.value)}
                    placeholder="xapp-..."
                    className={`w-full bg-slate-700 border-2 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:ring-2 transition-all ${
                      appTokenError
                        ? 'border-red-600 focus:ring-red-500'
                        : appTokenValid
                        ? 'border-green-600 focus:ring-green-500'
                        : 'border-slate-600 focus:ring-blue-500'
                    }`}
                  />
                  {appTokenValid && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-green-400 text-xl">
                      ✓
                    </div>
                  )}
                </div>
                {appTokenError && (
                  <p className="text-red-400 text-sm mt-1">⚠️ {appTokenError}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  Settings → Basic Information → App-Level Tokens
                </p>
              </div>

              {/* Bot Token */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Bot User OAuth Token
                  <span className="text-slate-500 ml-2 text-xs">(Bot permissions)</span>
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={botToken}
                    onChange={(e) => validateBotToken(e.target.value)}
                    placeholder="xoxb-..."
                    className={`w-full bg-slate-700 border-2 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:ring-2 transition-all ${
                      botTokenError
                        ? 'border-red-600 focus:ring-red-500'
                        : botTokenValid
                        ? 'border-green-600 focus:ring-green-500'
                        : 'border-slate-600 focus:ring-blue-500'
                    }`}
                  />
                  {botTokenValid && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-green-400 text-xl">
                      ✓
                    </div>
                  )}
                </div>
                {botTokenError && (
                  <p className="text-red-400 text-sm mt-1">⚠️ {botTokenError}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  OAuth & Permissions → Bot User OAuth Token
                </p>
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 mb-6">
              <div className="flex items-start space-x-3">
                <div className="text-blue-400 text-xl">ℹ️</div>
                <div className="text-sm text-blue-200">
                  <strong>Security Note:</strong> These tokens are stored locally in your .env file.
                  They never leave your machine.
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between">
              <button
                onClick={handleBack}
                className="px-8 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-all duration-200"
              >
                ← Back
              </button>
              <button
                onClick={handleNext}
                disabled={!canProceedFromStep2}
                className={`px-8 py-3 rounded-lg font-semibold transition-all duration-200 shadow-lg ${
                  canProceedFromStep2
                    ? 'bg-blue-600 hover:bg-blue-700 hover:shadow-xl active:scale-95'
                    : 'bg-slate-600 cursor-not-allowed opacity-50'
                }`}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Test Connection */}
        {currentStep === 3 && (
          <div className="bg-slate-800 rounded-xl p-8 shadow-2xl border border-slate-700">
            <div className="mb-6">
              <h1 className="text-3xl font-bold mb-2">Test your Slack connection</h1>
              <p className="text-slate-400">Verify tokens and discover channels</p>
            </div>

            {/* Status Display */}
            <div className="mb-6">
              {!testing && !testSuccess && !testError && (
                <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6 text-center">
                  <div className="text-4xl mb-2">🔌</div>
                  <div className="text-slate-300">Ready to test connection</div>
                </div>
              )}

              {testing && (
                <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-6 text-center">
                  <div className="text-4xl mb-2 animate-pulse">⚡</div>
                  <div className="text-blue-300 font-medium">Connecting to Slack...</div>
                  <div className="text-sm text-blue-400 mt-2">This may take a few seconds</div>
                </div>
              )}

              {testSuccess && (
                <div className="bg-green-900/20 border border-green-700 rounded-lg p-6">
                  <div className="text-center mb-4">
                    <div className="text-6xl mb-2">🎉</div>
                    <div className="text-green-300 font-bold text-xl">Connected successfully!</div>
                    <div className="text-slate-400 mt-1">Found {channels.length} channels</div>
                  </div>

                  {channels.length > 0 && (
                    <>
                      <div className="mt-4 mb-2 font-semibold text-slate-300">Available Channels:</div>
                      <div className="bg-slate-900/50 rounded-lg p-4 max-h-60 overflow-y-auto space-y-2">
                        {channels.slice(0, 10).map((channel) => (
                          <div
                            key={channel.id}
                            className="flex items-center justify-between p-2 bg-slate-800 rounded hover:bg-slate-750 transition-colors"
                          >
                            <span className="font-medium">#{channel.name}</span>
                            <span className="text-xs text-slate-500">ID: {channel.id}</span>
                          </div>
                        ))}
                        {channels.length > 10 && (
                          <div className="text-center text-sm text-slate-500 pt-2">
                            ...and {channels.length - 10} more
                          </div>
                        )}
                      </div>

                      {/* Video Placeholder */}
                      <div className="mt-4 bg-slate-900/50 border-2 border-dashed border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 transition-colors">
                        <div className="text-4xl mb-2">▶️</div>
                        <p className="text-slate-400 text-sm">VIDEO: Finding Channel IDs</p>
                        <p className="text-xs text-slate-500 mt-1">(2 min quick guide)</p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {testError && (
                <div className="bg-red-900/20 border border-red-700 rounded-lg p-6 text-center">
                  <div className="text-4xl mb-2">❌</div>
                  <div className="text-red-300 font-medium mb-2">Connection failed</div>
                  <div className="text-sm text-red-400">{testError}</div>
                </div>
              )}
            </div>

            {/* Test Button */}
            {!testSuccess && (
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className={`w-full px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-lg mb-6 ${
                  testing
                    ? 'bg-slate-600 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700 hover:shadow-xl active:scale-95'
                }`}
              >
                {testing ? 'Testing...' : '🔌 Test Connection'}
              </button>
            )}

            {/* Navigation */}
            <div className="flex justify-between">
              <button
                onClick={handleBack}
                className="px-8 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-all duration-200"
              >
                ← Back
              </button>
              <button
                onClick={handleNext}
                disabled={!testSuccess}
                className={`px-8 py-3 rounded-lg font-semibold transition-all duration-200 shadow-lg ${
                  testSuccess
                    ? 'bg-blue-600 hover:bg-blue-700 hover:shadow-xl active:scale-95'
                    : 'bg-slate-600 cursor-not-allowed opacity-50'
                }`}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Register Channel */}
        {currentStep === 4 && (
          <div className="bg-slate-800 rounded-xl p-8 shadow-2xl border border-slate-700">
            <div className="mb-6">
              <h1 className="text-3xl font-bold mb-2">Register a Slack channel</h1>
              <p className="text-slate-400">Connect a channel to your agent</p>
            </div>

            <div className="space-y-6 mb-6">
              {/* Channel Selector */}
              <div>
                <label className="block text-sm font-medium mb-2">Slack Channel</label>
                <select
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  className="w-full bg-slate-700 border-2 border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                >
                  <option value="">Select a channel...</option>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  The channel where your agent will listen for messages
                </p>
              </div>

              {/* Group Name */}
              <div>
                <label className="block text-sm font-medium mb-2">Group Name</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => validateGroupName(e.target.value)}
                  placeholder="work-team"
                  className={`w-full bg-slate-700 border-2 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 transition-all ${
                    groupNameError
                      ? 'border-red-600 focus:ring-red-500'
                      : groupName && !groupNameError
                      ? 'border-green-600 focus:ring-green-500'
                      : 'border-slate-600 focus:ring-blue-500'
                  }`}
                />
                {groupNameError && (
                  <p className="text-red-400 text-sm mt-1">⚠️ {groupNameError}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  Lowercase with hyphens (e.g., dev-team, work-slack)
                </p>
              </div>

              {/* Trigger Word */}
              <div>
                <label className="block text-sm font-medium mb-2">Trigger Word</label>
                <input
                  type="text"
                  value={triggerWord}
                  onChange={(e) => setTriggerWord(e.target.value)}
                  placeholder="@Andy"
                  className="w-full bg-slate-700 border-2 border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Start messages with this to talk to your agent (e.g., "@Andy help me")
                </p>
              </div>
            </div>

            {/* Preview */}
            {selectedChannelId && groupName && !groupNameError && (
              <div className="bg-green-900/20 border border-green-700 rounded-lg p-4 mb-6">
                <div className="text-sm text-green-300 font-medium mb-2">✓ Ready to register:</div>
                <div className="text-xs text-slate-300 space-y-1">
                  <div>Channel: <strong>#{channels.find((c) => c.id === selectedChannelId)?.name}</strong></div>
                  <div>Group: <strong>{groupName}</strong></div>
                  <div>Trigger: <strong>{triggerWord}</strong></div>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between">
              <button
                onClick={handleBack}
                className="px-8 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-all duration-200"
              >
                ← Back
              </button>
              <button
                onClick={handleCompleteSetup}
                disabled={!canCompleteSetup || registering}
                className={`px-10 py-3 rounded-lg font-semibold text-lg transition-all duration-200 shadow-lg ${
                  canCompleteSetup && !registering
                    ? 'bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 hover:shadow-xl active:scale-95'
                    : 'bg-slate-600 cursor-not-allowed opacity-50'
                }`}
              >
                {registering ? 'Registering...' : '✨ Complete Setup'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
