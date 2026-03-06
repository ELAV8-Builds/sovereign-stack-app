import { useState, useEffect } from 'react';
import { safeInvoke, isTauri, localGet, localSet } from '@/lib/tauri';

enum BudgetTier {
  PERFORMANCE = 'performance',
  ULTRA = 'ultra',
  CUSTOM = 'custom'
}

interface ModelSelection {
  primary: string;
  backup?: string;
  failover: string;
}

interface ModelConfig {
  tier: BudgetTier;
  estimatedMonthlyCost: number;
  lanes: {
    architect: ModelSelection;
    engineer: ModelSelection;
    copilot: ModelSelection;
    planning: ModelSelection;
    visual: ModelSelection;
    safety: ModelSelection;
    compound: ModelSelection;  // NEW 7th lane
  };
}

// Note: Model configuration will be loaded from the backend when available.
// No mock configs — shows empty/loading state until backend is connected.

export function ModelConfiguration() {
  const [selectedTier, setSelectedTier] = useState<BudgetTier>(BudgetTier.PERFORMANCE);
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const cfg = await safeInvoke<ModelConfig>('get_model_config');
      setConfig(cfg);
      setSelectedTier(cfg.tier);
    } catch (err) {
      if (isTauri()) console.warn('Failed to load config from backend:', err);
      // No mock data — config stays null, UI shows empty state
      const savedTier = localGet<BudgetTier>('model_tier', BudgetTier.PERFORMANCE);
      setSelectedTier(savedTier);
    }
  };

  const handleTierChange = async (tier: BudgetTier) => {
    setSelectedTier(tier);
    setSaving(true);
    setSaveSuccess(false);

    try {
      await safeInvoke('set_model_tier', { tier });
      const newConfig = await safeInvoke<ModelConfig>('get_model_config');
      setConfig(newConfig);
      localSet('model_tier', tier);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      if (isTauri()) console.warn('Failed to save tier to backend:', err);
      localSet('model_tier', tier);
      // Tier preference saved locally — config details available when backend connects
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const tiers = [
    {
      id: BudgetTier.PERFORMANCE,
      name: 'Performance',
      icon: '🚀',
      cost: '$2,500/mo',
      description: 'Maximum quality - Opus 4.6 everywhere critical',
      details: [
        'Opus for architecture, engineering, planning',
        'Sonnet for copilot (fast iterations)',
        'Gemini for visual design',
        'GPT-5.2 for security review',
        'NEW: Compound lane for learning',
      ],
      colorBorder: 'border-purple-600',
      colorBg: 'bg-purple-900/20',
      colorHover: 'hover:border-purple-500',
    },
    {
      id: BudgetTier.ULTRA,
      name: 'Ultra',
      icon: '⚡',
      cost: '$5,000/mo',
      description: 'Opus 4.6 for EVERYTHING - Maximum speed and quality',
      details: [
        'Opus for ALL lanes (even copilot)',
        'Zero compromises on quality',
        'Fastest possible outputs',
        'Enterprise-grade everywhere',
      ],
      colorBorder: 'border-yellow-600',
      colorBg: 'bg-yellow-900/20',
      colorHover: 'hover:border-yellow-500',
    },
    {
      id: BudgetTier.CUSTOM,
      name: 'Custom',
      icon: '🎛️',
      cost: 'Variable',
      description: 'Configure each lane manually',
      details: [
        'Choose primary for each lane',
        'Set custom budgets',
        'Fine-tune per use case',
        'Advanced users only',
      ],
      colorBorder: 'border-blue-600',
      colorBg: 'bg-blue-900/20',
      colorHover: 'hover:border-blue-500',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <div className="text-yellow-400 text-xl">⚡</div>
          <div className="text-sm text-yellow-200">
            <strong>LiteLLM 9-Tier Routing Active:</strong> This system now uses heavy (Opus 4.6), coder (Sonnet 4.5), medium (Sonnet 4.5), light (Haiku 4.5), codex (GPT-5.2 Codex), crosscheck (GPT-5.2), critic (GPT-5.2), and creative (Gemini 3.1 Pro) tiers. Performance tier prioritizes quality over cost.
          </div>
        </div>
      </div>

      <p className="text-sm text-slate-400">
        Choose your model configuration. All tiers include automatic failover to Opus 4.6 (heavy tier) if models are unavailable. <strong>7 lanes including NEW Compound mode for knowledge capture.</strong>
      </p>

      {/* Success Feedback */}
      {saveSuccess && (
        <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 animate-pulse">
          <div className="flex items-center space-x-3">
            <div className="text-green-400 text-xl">✓</div>
            <div className="text-sm text-green-200">
              <strong>Configuration saved!</strong> Your model tier has been updated successfully.
            </div>
          </div>
        </div>
      )}

      {/* Tier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tiers.map((tier) => (
          <button
            key={tier.id}
            onClick={() => handleTierChange(tier.id)}
            disabled={saving}
            className={`text-left p-6 rounded-lg border-2 transition-all duration-200 ${
              selectedTier === tier.id
                ? `${tier.colorBorder} ${tier.colorBg} shadow-lg`
                : `border-slate-600 bg-slate-700 ${tier.colorHover}`
            } ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]'}`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-4xl">{tier.icon}</span>
                <div>
                  <h3 className="text-lg font-semibold">{tier.name}</h3>
                  <p className="text-sm text-slate-400">{tier.cost}</p>
                </div>
              </div>
              {selectedTier === tier.id && (
                <div className="text-green-400 text-2xl animate-bounce">✓</div>
              )}
            </div>

            <p className="text-sm text-slate-300 mb-3">{tier.description}</p>

            <ul className="space-y-1 text-xs text-slate-400">
              {tier.details.map((detail, idx) => (
                <li key={idx} className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      {/* Current Configuration Display */}
      {!config && (
        <div className="bg-slate-700 border border-slate-600 rounded-lg p-6 text-center">
          <div className="text-4xl mb-3">⚙️</div>
          <p className="text-slate-300 font-medium mb-1">Configuration not loaded</p>
          <p className="text-sm text-slate-500">
            Model lane details will appear here once the backend is connected.
            Your tier preference has been saved locally.
          </p>
        </div>
      )}
      {config && (
        <div className="bg-slate-700 border border-slate-600 rounded-lg p-6">
          <h3 className="font-semibold text-lg mb-4 flex items-center space-x-2">
            <span>⚙️</span>
            <span>Active Configuration (7 Lanes)</span>
          </h3>

          <div className="space-y-3">
            {Object.entries(config.lanes).map(([lane, models]) => (
              <div
                key={lane}
                className="flex items-center justify-between p-3 bg-slate-800 rounded border border-slate-700 hover:border-slate-600 transition-colors duration-200"
              >
                <div className="flex-1">
                  <div className="font-medium capitalize text-slate-200 flex items-center space-x-2">
                    <span>{getLaneIcon(lane)}</span>
                    <span>{lane}</span>
                    {lane === 'compound' && (
                      <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">NEW</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    <span className="font-semibold text-blue-400">Primary:</span> {getTierDisplayName(models.primary)}
                    {models.backup && (
                      <>
                        <span className="mx-2">•</span>
                        <span className="font-semibold text-yellow-400">Backup:</span> {getTierDisplayName(models.backup)}
                      </>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-500 bg-slate-900 px-3 py-1 rounded-full">
                  <span className="text-red-400">⚠️</span> {getTierDisplayName(models.failover)}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-600">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-400">Estimated Monthly Cost:</span>
              <span className="text-2xl font-bold text-green-400">
                ${config.estimatedMonthlyCost.toLocaleString()}/mo
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Failover Notice */}
      <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <div className="text-blue-400 text-xl">ℹ️</div>
          <div className="text-sm text-blue-200">
            <strong>Automatic Failover:</strong> If any model is unavailable or errors, the system automatically falls back to heavy tier (Opus 4.6) to ensure uninterrupted operation.
          </div>
        </div>
      </div>

      {/* Reference link */}
      <div className="text-xs text-slate-500 text-center pt-2">
        Full LiteLLM tier reference and lane descriptions available in Settings → Advanced → About
      </div>
    </div>
  );
}

// Helper function to get lane icon
function getLaneIcon(lane: string): string {
  const icons: Record<string, string> = {
    architect: '🏗️',
    engineer: '👨‍💻',
    copilot: '⚡',
    planning: '🎯',
    visual: '🎨',
    safety: '🛡️',
    compound: '🧠',
  };
  return icons[lane] || '⚙️';
}

// Helper function to get tier display name
function getTierDisplayName(tier: string): string {
  const names: Record<string, string> = {
    'heavy': 'heavy (Opus 4.6)',
    'coder': 'coder (Sonnet 4.5)',
    'medium': 'medium (Sonnet 4.5)',
    'light': 'light (Haiku 4.5)',
    'trivial': 'trivial (Haiku)',
    'codex': 'codex (GPT-5.2)',
    'crosscheck': 'crosscheck (GPT-5.2)',
    'critic': 'critic (GPT-5.2)',
    'creative': 'creative (Gemini 3.1)',
  };
  return names[tier] || tier;
}
