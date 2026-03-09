import type { TokenInputStepProps } from './types';
import { NavigationButtons } from './NavigationButtons';

export function TokenInputStep({
  appToken,
  botToken,
  appTokenValid,
  botTokenValid,
  appTokenError,
  botTokenError,
  onAppTokenChange,
  onBotTokenChange,
  canProceed,
  onBack,
  onNext,
}: TokenInputStepProps) {
  return (
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
              onChange={(e) => onAppTokenChange(e.target.value)}
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
                {'\u2713'}
              </div>
            )}
          </div>
          {appTokenError && (
            <p className="text-red-400 text-sm mt-1">{'\u26A0\uFE0F'} {appTokenError}</p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            Settings {'\u2192'} Basic Information {'\u2192'} App-Level Tokens
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
              onChange={(e) => onBotTokenChange(e.target.value)}
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
                {'\u2713'}
              </div>
            )}
          </div>
          {botTokenError && (
            <p className="text-red-400 text-sm mt-1">{'\u26A0\uFE0F'} {botTokenError}</p>
          )}
          <p className="text-xs text-slate-500 mt-1">
            OAuth & Permissions {'\u2192'} Bot User OAuth Token
          </p>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 mb-6">
        <div className="flex items-start space-x-3">
          <div className="text-blue-400 text-xl">{'\u2139\uFE0F'}</div>
          <div className="text-sm text-blue-200">
            <strong>Security Note:</strong> These tokens are stored locally in your .env file.
            They never leave your machine.
          </div>
        </div>
      </div>

      {/* Navigation */}
      <NavigationButtons
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!canProceed}
      />
    </div>
  );
}
