import type { TestConnectionStepProps } from './types';
import { NavigationButtons } from './NavigationButtons';

export function TestConnectionStep({
  testing,
  testSuccess,
  testError,
  channels,
  onTestConnection,
  onBack,
  onNext,
}: TestConnectionStepProps) {
  return (
    <div className="bg-slate-800 rounded-xl p-8 shadow-2xl border border-slate-700">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Test your Slack connection</h1>
        <p className="text-slate-400">Verify tokens and discover channels</p>
      </div>

      {/* Status Display */}
      <div className="mb-6">
        {!testing && !testSuccess && !testError && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6 text-center">
            <div className="text-4xl mb-2">{'\u{1F50C}'}</div>
            <div className="text-slate-300">Ready to test connection</div>
          </div>
        )}

        {testing && (
          <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-6 text-center">
            <div className="text-4xl mb-2 animate-pulse">{'\u26A1'}</div>
            <div className="text-blue-300 font-medium">Connecting to Slack...</div>
            <div className="text-sm text-blue-400 mt-2">This may take a few seconds</div>
          </div>
        )}

        {testSuccess && (
          <div className="bg-green-900/20 border border-green-700 rounded-lg p-6">
            <div className="text-center mb-4">
              <div className="text-6xl mb-2">{'\u{1F389}'}</div>
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
                  <div className="text-4xl mb-2">{'\u25B6\uFE0F'}</div>
                  <p className="text-slate-400 text-sm">VIDEO: Finding Channel IDs</p>
                  <p className="text-xs text-slate-500 mt-1">(2 min quick guide)</p>
                </div>
              </>
            )}
          </div>
        )}

        {testError && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-6 text-center">
            <div className="text-4xl mb-2">{'\u274C'}</div>
            <div className="text-red-300 font-medium mb-2">Connection failed</div>
            <div className="text-sm text-red-400">{testError}</div>
          </div>
        )}
      </div>

      {/* Test Button */}
      {!testSuccess && (
        <button
          onClick={onTestConnection}
          disabled={testing}
          className={`w-full px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-lg mb-6 ${
            testing
              ? 'bg-slate-600 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 hover:shadow-xl active:scale-95'
          }`}
        >
          {testing ? 'Testing...' : '\u{1F50C} Test Connection'}
        </button>
      )}

      {/* Navigation */}
      <NavigationButtons
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!testSuccess}
      />
    </div>
  );
}
