import { useState, useEffect } from "react";
import { isSoundEnabled, toggleSound, playNotificationDing, playTaskCompleteChime } from "@/lib/notifications";

interface SoundSettingsProps {
  onClose: () => void;
}

export function SoundSettings({ onClose }: SoundSettingsProps) {
  const [enabled, setEnabled] = useState(isSoundEnabled());

  useEffect(() => {
    setEnabled(isSoundEnabled());
  }, []);

  const handleToggle = () => {
    const newState = toggleSound();
    setEnabled(newState);
    
    // Play a sample sound when enabling
    if (newState) {
      playNotificationDing();
    }
  };

  const testNotificationSound = () => {
    playNotificationDing();
  };

  const testCompleteSound = () => {
    playTaskCompleteChime();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">🔔 Sound Settings</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
            <div>
              <div className="text-sm font-medium text-white">Notification Sounds</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Play sounds when agents complete tasks
              </div>
            </div>
            <button
              onClick={handleToggle}
              className={`relative w-12 h-6 rounded-full transition-all duration-200 ${
                enabled ? "bg-blue-500" : "bg-slate-600"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 ${
                  enabled ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Test Sounds */}
          {enabled && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Test Sounds
              </div>
              <button
                onClick={testNotificationSound}
                className="w-full text-left px-4 py-3 bg-slate-900/50 hover:bg-slate-900 rounded-lg border border-slate-700/50 hover:border-blue-500/50 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-white group-hover:text-blue-300 transition-colors">
                      Notification Ding
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Two-tone alert for new messages
                    </div>
                  </div>
                  <span className="text-lg">🔔</span>
                </div>
              </button>

              <button
                onClick={testCompleteSound}
                className="w-full text-left px-4 py-3 bg-slate-900/50 hover:bg-slate-900 rounded-lg border border-slate-700/50 hover:border-green-500/50 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-white group-hover:text-green-300 transition-colors">
                      Task Complete Chime
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Three-tone melody for completed tasks
                    </div>
                  </div>
                  <span className="text-lg">✅</span>
                </div>
              </button>
            </div>
          )}

          {/* Info */}
          <div className="p-3 bg-blue-900/20 border border-blue-700/30 rounded-lg">
            <div className="flex gap-2">
              <span className="text-blue-400 flex-shrink-0">ℹ️</span>
              <div className="text-xs text-blue-200/80">
                Sounds are generated using Web Audio API — no external files needed. Your preference is saved locally.
              </div>
            </div>
          </div>
        </div>

        {/* Close Button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
