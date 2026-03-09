import type { CreateAppStepProps } from './types';
import { NavigationButtons } from './NavigationButtons';

export function CreateAppStep({ onNext, onCancel }: CreateAppStepProps) {
  const handleOpenSlackCreator = () => {
    window.open('https://api.slack.com/apps', '_blank');
  };

  return (
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
          <span>{'\u{1F680}'}</span>
          <span>Open Slack App Creator</span>
        </button>
      </div>

      <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6 mb-6">
        <h3 className="font-semibold text-lg mb-4 flex items-center space-x-2">
          <span>{'\u{1F4CB}'}</span>
          <span>Configuration Checklist</span>
        </h3>

        <div className="space-y-3">
          <div className="flex items-start space-x-3">
            <div className="text-green-400 text-xl mt-0.5">{'\u25A1'}</div>
            <div>
              <div className="font-medium">Enable Socket Mode</div>
              <div className="text-sm text-slate-400">Settings {'\u2192'} Socket Mode {'\u2192'} Enable</div>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="text-green-400 text-xl mt-0.5">{'\u25A1'}</div>
            <div>
              <div className="font-medium">Subscribe to Bot Events</div>
              <div className="text-sm text-slate-400">
                Event Subscriptions {'\u2192'} Subscribe to bot events:
              </div>
              <div className="text-xs text-slate-500 mt-1 ml-4">
                {'\u2022'} message.channels<br/>
                {'\u2022'} message.groups<br/>
                {'\u2022'} message.im
              </div>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="text-green-400 text-xl mt-0.5">{'\u25A1'}</div>
            <div>
              <div className="font-medium">Add OAuth Scopes</div>
              <div className="text-sm text-slate-400">OAuth & Permissions {'\u2192'} Bot Token Scopes:</div>
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
        <div className="text-6xl mb-3">{'\u25B6\uFE0F'}</div>
        <p className="text-slate-400 text-sm">VIDEO: Slack App Creation Walkthrough</p>
        <p className="text-xs text-slate-500 mt-2">(5 min step-by-step guide)</p>
      </div>

      {/* Navigation */}
      <NavigationButtons
        onBack={() => {}}
        onNext={onNext}
        showCancel={!!onCancel}
        onCancel={onCancel}
      />
    </div>
  );
}
