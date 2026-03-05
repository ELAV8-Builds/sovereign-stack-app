import { useState, useEffect } from 'react';
import { safeInvoke, isTauri } from '@/lib/tauri';

/**
 * RUST BACKEND COMMANDS NEEDED:
 *
 * Add these commands to src-tauri/src/commands.rs:
 *
 * use std::collections::HashMap;
 *
 * #[derive(serde::Serialize, serde::Deserialize)]
 * pub struct UsageStats {
 *     pub today_cost: f64,
 *     pub week_cost: f64,
 *     pub month_cost: f64,
 *     pub tier_requests: HashMap<String, u32>, // "trivial" -> 45, "light" -> 20, etc.
 * }
 *
 * #[tauri::command]
 * fn get_usage_stats() -> Result<UsageStats, String> {
 *     // Query LiteLLM /spend/logs endpoint at http://host.docker.internal:4000/spend/logs
 *     // Aggregate by tier and time period (today, week, month)
 *     // Calculate costs based on tier pricing:
 *     //   - trivial/light (Haiku): ~$0.001-0.003 per request
 *     //   - coder/medium (Sonnet): ~$0.02-0.03 per request
 *     //   - heavy (Opus): ~$0.10 per request
 *     //
 *     // Return aggregated usage stats with cost estimates
 * }
 *
 * #[tauri::command]
 * fn get_cost_estimate(tier: String, requests: u32) -> Result<f64, String> {
 *     // tier: "trivial", "light", "coder", "medium", "heavy"
 *     // Calculate estimated cost for N requests of given tier
 *     // Use pricing table:
 *     //   trivial: $0.001, light: $0.003, coder: $0.02, medium: $0.03, heavy: $0.10
 *     //
 *     // Return: requests * price_per_request
 * }
 */

interface UsageStats {
  today_cost: number;
  week_cost: number;
  month_cost: number;
  tier_requests: {
    trivial: number;
    light: number;
    coder: number;
    medium: number;
    heavy: number;
  };
}

interface TierInfo {
  name: string;
  model: string;
  color: string;
  bgColor: string;
  borderColor: string;
  costPerRequest: number;
  description: string;
}

const TIER_INFO: Record<string, TierInfo> = {
  trivial: {
    name: 'Trivial',
    model: 'Claude Haiku',
    color: 'text-green-400',
    bgColor: 'bg-green-900/20',
    borderColor: 'border-green-600',
    costPerRequest: 0.001,
    description: 'Simple formatting, extraction',
  },
  light: {
    name: 'Light',
    model: 'Claude Haiku',
    color: 'text-green-400',
    bgColor: 'bg-green-900/20',
    borderColor: 'border-green-600',
    costPerRequest: 0.003,
    description: 'Scanning, filtering, quick tasks',
  },
  coder: {
    name: 'Coder',
    model: 'Claude Sonnet',
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/20',
    borderColor: 'border-blue-600',
    costPerRequest: 0.02,
    description: 'Code generation, implementation',
  },
  medium: {
    name: 'Medium',
    model: 'Claude Sonnet',
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/20',
    borderColor: 'border-blue-600',
    costPerRequest: 0.03,
    description: 'Research, code review, reasoning',
  },
  heavy: {
    name: 'Heavy',
    model: 'Claude Opus',
    color: 'text-purple-400',
    bgColor: 'bg-purple-900/20',
    borderColor: 'border-purple-600',
    costPerRequest: 0.10,
    description: 'Deep strategy, architecture',
  },
};

export function CostTracker() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUsageStats();
    // Refresh every 60 seconds
    const interval = setInterval(loadUsageStats, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadUsageStats = async () => {
    try {
      const usageStats = await safeInvoke<UsageStats>('get_usage_stats');
      setStats(usageStats);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (isTauri()) console.error('Failed to load usage stats:', err);

      // Use realistic mock data for development
      setStats({
        today_cost: 3.47,
        week_cost: 18.92,
        month_cost: 67.34,
        tier_requests: {
          trivial: 234,
          light: 89,
          coder: 45,
          medium: 23,
          heavy: 7,
        },
      });

      setError('Using mock data (backend not available)');
      setLoading(false);
    }
  };

  const getBudgetWarning = (dailyCost: number) => {
    if (dailyCost < 5) {
      return {
        level: 'green',
        message: 'Normal usage',
        color: 'text-green-400',
        bgColor: 'bg-green-900/20',
        borderColor: 'border-green-600',
      };
    } else if (dailyCost < 10) {
      return {
        level: 'yellow',
        message: 'Moderate usage',
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-900/20',
        borderColor: 'border-yellow-600',
      };
    } else if (dailyCost < 20) {
      return {
        level: 'orange',
        message: 'Heavy usage',
        color: 'text-orange-400',
        bgColor: 'bg-orange-900/20',
        borderColor: 'border-orange-600',
      };
    } else {
      return {
        level: 'red',
        message: 'Very heavy usage',
        color: 'text-red-400',
        bgColor: 'bg-red-900/20',
        borderColor: 'border-red-600',
      };
    }
  };

  const calculateTierCost = (tier: string, requests: number): number => {
    const tierInfo = TIER_INFO[tier];
    if (!tierInfo) return 0;
    return requests * tierInfo.costPerRequest;
  };

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(2)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-400">Loading usage statistics...</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-slate-400">
        Unable to load usage statistics.
      </div>
    );
  }

  const budgetWarning = getBudgetWarning(stats.today_cost);
  const totalRequests = Object.values(stats.tier_requests).reduce((sum, count) => sum + count, 0);

  return (
    <div className="space-y-6">
      {/* Current Period Summary */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-3">Current Period</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-700 p-4 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">Today</div>
            <div className="text-2xl font-bold text-white">{formatCost(stats.today_cost)}</div>
            <div className={`text-xs mt-1 ${budgetWarning.color}`}>
              {budgetWarning.message}
            </div>
          </div>
          <div className="bg-slate-700 p-4 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">This Week</div>
            <div className="text-2xl font-bold text-white">{formatCost(stats.week_cost)}</div>
            <div className="text-xs text-slate-400 mt-1">
              Avg: {formatCost(stats.week_cost / 7)}/day
            </div>
          </div>
          <div className="bg-slate-700 p-4 rounded-lg">
            <div className="text-xs text-slate-400 mb-1">This Month</div>
            <div className="text-2xl font-bold text-white">{formatCost(stats.month_cost)}</div>
            <div className="text-xs text-slate-400 mt-1">
              Avg: {formatCost(stats.month_cost / 30)}/day
            </div>
          </div>
        </div>
      </div>

      {/* Budget Warning Banner */}
      {stats.today_cost >= 5 && (
        <div className={`p-4 rounded-lg border-2 ${budgetWarning.borderColor} ${budgetWarning.bgColor}`}>
          <div className="flex items-center gap-3">
            <div className="text-2xl">
              {budgetWarning.level === 'red' && '🔴'}
              {budgetWarning.level === 'orange' && '🟠'}
              {budgetWarning.level === 'yellow' && '🟡'}
            </div>
            <div>
              <div className={`font-semibold ${budgetWarning.color}`}>
                {budgetWarning.message}
              </div>
              <div className="text-sm text-slate-300">
                Today's cost: {formatCost(stats.today_cost)}
                {stats.today_cost >= 20 && ' - Consider reviewing autonomous task frequency'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5-Tier Breakdown */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-3">
          Usage by Tier
          <span className="ml-2 text-xs text-slate-400">
            ({totalRequests} total requests)
          </span>
        </h3>
        <div className="space-y-2">
          {Object.entries(stats.tier_requests).map(([tier, count]) => {
            const tierInfo = TIER_INFO[tier];
            const cost = calculateTierCost(tier, count);
            const percentage = totalRequests > 0 ? (count / totalRequests) * 100 : 0;

            return (
              <div
                key={tier}
                className={`p-3 rounded-lg border-2 ${tierInfo.borderColor} ${tierInfo.bgColor} transition-all duration-200 hover:shadow-lg`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${tierInfo.color}`}>
                        {tierInfo.name}
                      </span>
                      <span className="text-xs text-slate-400">
                        ({tierInfo.model})
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {tierInfo.description}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${tierInfo.color}`}>
                      {formatCost(cost)}
                    </div>
                    <div className="text-xs text-slate-400">
                      {count} requests
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-600 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${tierInfo.color.replace('text-', 'bg-')}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {percentage.toFixed(1)}% of total • ~{formatCost(tierInfo.costPerRequest)}/request
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cost Examples Info Card */}
      <div className="bg-slate-700 border border-slate-600 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl">ℹ️</div>
          <div className="flex-1">
            <div className="font-semibold text-slate-200 mb-2">Cost Examples</div>
            <div className="space-y-1.5 text-sm text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Quick tasks:</span>
                <span>$0.001-0.005 (Haiku)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Normal work:</span>
                <span>$0.01-0.05 (Sonnet)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Deep thinking:</span>
                <span>$0.05-0.20 (Opus)</span>
              </div>
              <div className="border-t border-slate-600 pt-2 mt-2">
                <div className="flex justify-between font-semibold">
                  <span className="text-slate-400">Typical day:</span>
                  <span className="text-green-400">$1-5</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Heavy autonomous:</span>
                  <span className="text-yellow-400">$10-20/day</span>
                </div>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-400 italic">
              ☕ Less than a coffee
            </div>
          </div>
        </div>
      </div>

      {/* Development Notice */}
      {error && (
        <div className="p-3 bg-blue-900/20 border border-blue-600 rounded text-xs text-blue-400">
          ℹ️ {error}
        </div>
      )}

      {/* Refresh Info */}
      <div className="text-xs text-slate-500 text-center">
        Stats updated every 60 seconds
      </div>
    </div>
  );
}
