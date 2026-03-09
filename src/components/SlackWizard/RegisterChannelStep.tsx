import type { RegisterChannelStepProps } from './types';

export function RegisterChannelStep({
  channels,
  selectedChannelId,
  groupName,
  triggerWord,
  groupNameError,
  registering,
  canCompleteSetup,
  onChannelSelect,
  onGroupNameChange,
  onTriggerWordChange,
  onCompleteSetup,
  onBack,
}: RegisterChannelStepProps) {
  return (
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
            onChange={(e) => onChannelSelect(e.target.value)}
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
            onChange={(e) => onGroupNameChange(e.target.value)}
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
            <p className="text-red-400 text-sm mt-1">{'\u26A0\uFE0F'} {groupNameError}</p>
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
            onChange={(e) => onTriggerWordChange(e.target.value)}
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
          <div className="text-sm text-green-300 font-medium mb-2">{'\u2713'} Ready to register:</div>
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
          onClick={onBack}
          className="px-8 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-all duration-200"
        >
          {'\u2190'} Back
        </button>
        <button
          onClick={onCompleteSetup}
          disabled={!canCompleteSetup || registering}
          className={`px-10 py-3 rounded-lg font-semibold text-lg transition-all duration-200 shadow-lg ${
            canCompleteSetup && !registering
              ? 'bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 hover:shadow-xl active:scale-95'
              : 'bg-slate-600 cursor-not-allowed opacity-50'
          }`}
        >
          {registering ? 'Registering...' : '\u2728 Complete Setup'}
        </button>
      </div>
    </div>
  );
}
