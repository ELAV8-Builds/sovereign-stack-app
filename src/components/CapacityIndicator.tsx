import { useState, useEffect } from 'react';
import { safeInvoke, isTauri } from '@/lib/tauri';

/**
 * RUST BACKEND COMMANDS NEEDED:
 *
 * Add these commands to src-tauri/src/commands.rs:
 *
 * #[derive(serde::Serialize)]
 * pub struct HardwareProfile {
 *     pub total_ram_gb: f64,
 *     pub available_ram_gb: f64,
 *     pub cpu_cores: u32,
 *     pub cpu_type: String, // "Apple Silicon M1 Pro", "Intel Core i7", etc.
 *     pub gpu_vram_gb: Option<f64>,
 *     pub architecture: String, // "arm64", "x86_64"
 * }
 *
 * #[tauri::command]
 * fn get_hardware_profile() -> Result<HardwareProfile, String> {
 *     // Use sysinfo crate or platform-specific APIs
 *     // Detect RAM, CPU, GPU, architecture
 *     // Return hardware profile
 * }
 *
 * #[derive(serde::Serialize)]
 * pub struct CapacityInfo {
 *     pub max_projects: u32,
 *     pub recommended_projects: u32,
 *     pub tier: String, // "lightweight", "standard", "power", "enterprise"
 *     pub overhead_gb: f64,
 *     pub per_project_gb: f64,
 * }
 *
 * #[tauri::command]
 * fn calculate_project_capacity() -> Result<CapacityInfo, String> {
 *     // Formula from spec:
 *     // Stack overhead: ~3GB
 *     // OS reserve: ~2-3GB
 *     // Per container: ~2GB
 *     // Max = floor((total_ram - overhead - reserve) / 2)
 *     //
 *     // Tiers:
 *     // 8GB -> 1 project (lightweight)
 *     // 16GB -> 2-3 projects (standard)
 *     // 32GB -> 5-8 projects (power)
 *     // 64GB+ -> 10+ projects (enterprise)
 * }
 */

interface HardwareProfile {
  total_ram_gb: number;
  available_ram_gb: number;
  cpu_cores: number;
  cpu_type: string;
  gpu_vram_gb?: number;
  architecture: string;
}

interface CapacityInfo {
  max_projects: number;
  recommended_projects: number;
  tier: string;
  overhead_gb: number;
  per_project_gb: number;
}

export function CapacityIndicator() {
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [capacity, setCapacity] = useState<CapacityInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentProjects] = useState(0); // TODO: Get from backend via invoke()

  useEffect(() => {
    loadCapacityInfo();
  }, []);

  const loadCapacityInfo = async () => {
    try {
      // Try to load from backend
      const hwProfile = await safeInvoke<HardwareProfile>('get_hardware_profile');
      const capInfo = await safeInvoke<CapacityInfo>('calculate_project_capacity');

      setHardware(hwProfile);
      setCapacity(capInfo);
      setLoading(false);
    } catch (err) {
      if (isTauri()) console.error('Failed to load capacity info:', err);

      // Use mock data for development
      setHardware({
        total_ram_gb: 16,
        available_ram_gb: 12,
        cpu_cores: 8,
        cpu_type: 'Apple Silicon M1 Pro',
        gpu_vram_gb: 16,
        architecture: 'arm64'
      });

      setCapacity({
        max_projects: 3,
        recommended_projects: 2,
        tier: 'standard',
        overhead_gb: 3,
        per_project_gb: 2
      });

      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-400">Loading capacity information...</div>
      </div>
    );
  }

  if (!hardware || !capacity) {
    return (
      <div className="text-slate-400">
        Unable to load capacity information.
      </div>
    );
  }

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'enterprise': return 'text-purple-400';
      case 'power': return 'text-blue-400';
      case 'standard': return 'text-green-400';
      case 'lightweight': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case 'enterprise': return '🚀';
      case 'power': return '⚡';
      case 'standard': return '💻';
      case 'lightweight': return '📱';
      default: return '💾';
    }
  };

  const capacityPercentage = Math.min((currentProjects / capacity.max_projects) * 100, 100);
  const isNearLimit = capacityPercentage >= 80;
  const isAtLimit = currentProjects >= capacity.max_projects;

  return (
    <div className="space-y-6">
      {/* Hardware Profile */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-3">Hardware Profile</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-700 p-3 rounded-lg">
            <div className="text-xs text-slate-400">Total RAM</div>
            <div className="text-lg font-semibold text-white">{hardware.total_ram_gb} GB</div>
          </div>
          <div className="bg-slate-700 p-3 rounded-lg">
            <div className="text-xs text-slate-400">Available RAM</div>
            <div className="text-lg font-semibold text-white">{hardware.available_ram_gb} GB</div>
          </div>
          <div className="bg-slate-700 p-3 rounded-lg">
            <div className="text-xs text-slate-400">CPU Cores</div>
            <div className="text-lg font-semibold text-white">{hardware.cpu_cores}</div>
          </div>
          <div className="bg-slate-700 p-3 rounded-lg">
            <div className="text-xs text-slate-400">Architecture</div>
            <div className="text-lg font-semibold text-white">{hardware.architecture}</div>
          </div>
        </div>
        <div className="mt-2 text-sm text-slate-400">
          <span className="font-medium">{hardware.cpu_type}</span>
          {hardware.gpu_vram_gb && <span> • {hardware.gpu_vram_gb} GB VRAM</span>}
        </div>
      </div>

      {/* Capacity Tier */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-3">Capacity Tier</h3>
        <div className="bg-slate-700 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{getTierIcon(capacity.tier)}</span>
              <span className={`text-lg font-semibold capitalize ${getTierColor(capacity.tier)}`}>
                {capacity.tier}
              </span>
            </div>
            <div className="text-sm text-slate-400">
              {capacity.overhead_gb} GB overhead + {capacity.per_project_gb} GB per project
            </div>
          </div>
          <div className="text-sm text-slate-400">
            Maximum capacity: <span className="font-semibold text-white">{capacity.max_projects} projects</span>
            {' • '}
            Recommended: <span className="font-semibold text-white">{capacity.recommended_projects} projects</span>
          </div>
        </div>
      </div>

      {/* Project Capacity Gauge */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-3">Current Usage</h3>
        <div className="bg-slate-700 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">Active Projects</span>
            <span className={`text-lg font-semibold ${
              isAtLimit ? 'text-red-400' : isNearLimit ? 'text-yellow-400' : 'text-green-400'
            }`}>
              {currentProjects} / {capacity.max_projects}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-600 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                isAtLimit ? 'bg-red-500' : isNearLimit ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${capacityPercentage}%` }}
            />
          </div>

          {/* Warning Messages */}
          {isAtLimit && (
            <div className="mt-3 p-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-400">
              ⚠️ At maximum capacity. Consider stopping some projects before creating new ones.
            </div>
          )}
          {isNearLimit && !isAtLimit && (
            <div className="mt-3 p-2 bg-yellow-900/30 border border-yellow-700 rounded text-sm text-yellow-400">
              ⚠️ Approaching capacity limit. Monitor system performance.
            </div>
          )}
          {!isNearLimit && currentProjects > 0 && (
            <div className="mt-3 text-sm text-slate-400">
              ✓ Capacity available for {capacity.max_projects - currentProjects} more project(s)
            </div>
          )}
        </div>
      </div>

      {/* Tier Explanations */}
      <div className="text-xs text-slate-500">
        <div className="font-medium mb-1">Capacity Tiers:</div>
        <div className="space-y-0.5">
          <div>📱 <span className="text-yellow-400">Lightweight</span>: 8GB RAM → 1 project</div>
          <div>💻 <span className="text-green-400">Standard</span>: 16GB RAM → 2-3 projects</div>
          <div>⚡ <span className="text-blue-400">Power</span>: 32GB RAM → 5-8 projects</div>
          <div>🚀 <span className="text-purple-400">Enterprise</span>: 64GB+ RAM → 10+ projects</div>
        </div>
      </div>
    </div>
  );
}
