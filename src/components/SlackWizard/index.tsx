import { useState } from 'react';
import { friendlyError } from '@/lib/tauri';
import toast from 'react-hot-toast';

import type { Channel, SlackWizardProps } from './types';
import { ProgressIndicator } from './ProgressIndicator';
import { CreateAppStep } from './CreateAppStep';
import { TokenInputStep } from './TokenInputStep';
import { TestConnectionStep } from './TestConnectionStep';
import { RegisterChannelStep } from './RegisterChannelStep';

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
      // Test connection via NanoClaw REST API
      const connectRes = await fetch('/api/nanoclaw/slack/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appToken, botToken }),
        signal: AbortSignal.timeout(15000),
      });
      const connectData = await connectRes.json();

      if (!connectRes.ok) {
        setTestError(connectData.detail || connectData.error || 'Connection failed');
        setTestSuccess(false);
        return;
      }

      // Fetch channels
      const channelsRes = await fetch('/api/nanoclaw/slack/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken }),
        signal: AbortSignal.timeout(15000),
      });
      const channelsData = await channelsRes.json();

      if (!channelsRes.ok) {
        setTestError(channelsData.detail || channelsData.error || 'Failed to list channels');
        setTestSuccess(false);
        return;
      }

      setChannels((channelsData.channels || []).map((ch: { id: string; name: string }) => ({
        id: ch.id,
        name: ch.name,
      })));
      setTestSuccess(true);
      setTestError('');

      // Save tokens to Key Vault
      await fetch('/api/sovereign/settings/vault/slack_bot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: botToken }),
      }).catch(() => {});
      await fetch('/api/sovereign/settings/vault/slack_app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: appToken }),
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Failed to fetch') || msg.includes('Load failed')) {
        setTestError('Slack backend is not ready yet. Start the Docker stack first, then try again.');
        toast('NanoClaw not reachable — start Docker stack first', { icon: '\u26A0\uFE0F' });
      } else {
        setTestError(friendlyError(err, 'Connection failed. Please check your tokens and try again.'));
      }
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

  const canCompleteSetup = !!(selectedChannelId && groupName && !groupNameError && triggerWord);

  const handleCompleteSetup = async () => {
    if (!canCompleteSetup) return;

    setRegistering(true);
    try {
      localStorage.setItem('sovereign_slack_channel_id', selectedChannelId);
      localStorage.setItem('sovereign_slack_group_name', groupName);
      localStorage.setItem('sovereign_slack_trigger', triggerWord);
      toast.success('Slack channel configured!');
      onComplete();
    } catch (err) {
      toast.error('Failed to save channel config: ' + friendlyError(err));
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
        <ProgressIndicator currentStep={currentStep} totalSteps={4} />

        {currentStep === 1 && (
          <CreateAppStep onNext={handleNext} onCancel={onCancel} />
        )}

        {currentStep === 2 && (
          <TokenInputStep
            appToken={appToken}
            botToken={botToken}
            appTokenValid={appTokenValid}
            botTokenValid={botTokenValid}
            appTokenError={appTokenError}
            botTokenError={botTokenError}
            onAppTokenChange={validateAppToken}
            onBotTokenChange={validateBotToken}
            canProceed={canProceedFromStep2}
            onBack={handleBack}
            onNext={handleNext}
          />
        )}

        {currentStep === 3 && (
          <TestConnectionStep
            testing={testing}
            testSuccess={testSuccess}
            testError={testError}
            channels={channels}
            onTestConnection={handleTestConnection}
            onBack={handleBack}
            onNext={handleNext}
          />
        )}

        {currentStep === 4 && (
          <RegisterChannelStep
            channels={channels}
            selectedChannelId={selectedChannelId}
            groupName={groupName}
            triggerWord={triggerWord}
            groupNameError={groupNameError}
            registering={registering}
            canCompleteSetup={canCompleteSetup}
            onChannelSelect={setSelectedChannelId}
            onGroupNameChange={validateGroupName}
            onTriggerWordChange={setTriggerWord}
            onCompleteSetup={handleCompleteSetup}
            onBack={handleBack}
          />
        )}
      </div>
    </div>
  );
}
