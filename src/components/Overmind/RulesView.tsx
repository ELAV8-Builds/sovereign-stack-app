/**
 * RulesView — Rules Engine Management
 *
 * Full CRUD for Overmind rules with:
 * - Table with toggle, inline edit, delete
 * - Create new rule form
 * - Preset buttons (Strict / Normal / Permissive)
 * - Seed default build rules
 * - Category filtering
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  getOvRules,
  createOvRule,
  updateOvRule,
  deleteOvRule,
  applyRulePreset,
  seedDefaultRules,
  type OvRule,
} from '@/lib/overmind';
import type { OvermindEvent } from '@/lib/useOvermindSocket';

interface RulesViewProps {
  lastEvent?: OvermindEvent | null;
}

export function RulesView({ lastEvent }: RulesViewProps) {
  const [rules, setRules] = useState<OvRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const refresh = useCallback(async () => {
    const data = await getOvRules();
    setRules(data);
    setLoading(false);
  }, []);

  // Auto-refresh on rule-related WebSocket events
  const lastEventRef = useRef(lastEvent);
  useEffect(() => {
    if (lastEvent && lastEvent !== lastEventRef.current) {
      lastEventRef.current = lastEvent;
      if (['rules_update', 'snapshot'].includes(lastEvent.type)) {
        refresh();
      }
    }
  }, [lastEvent, refresh]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Get unique categories
  const categories = ['all', ...new Set(rules.map((r) => r.category))];

  const filteredRules = filter === 'all' ? rules : rules.filter((r) => r.category === filter);

  const handleToggle = async (rule: OvRule) => {
    try {
      await updateOvRule(rule.id, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
      toast.success(`${rule.category}.${rule.key} ${!rule.enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleStartEdit = (rule: OvRule) => {
    setEditingRule(rule.id);
    setEditValue(typeof rule.value === 'object' ? JSON.stringify(rule.value) : String(rule.value));
  };

  const handleSaveEdit = async (rule: OvRule) => {
    try {
      let parsedValue: unknown = editValue;
      // Try to parse as JSON/number/boolean
      if (editValue === 'true') parsedValue = true;
      else if (editValue === 'false') parsedValue = false;
      else if (!isNaN(Number(editValue)) && editValue.trim() !== '') parsedValue = Number(editValue);
      else {
        try { parsedValue = JSON.parse(editValue); } catch { parsedValue = editValue; }
      }

      await updateOvRule(rule.id, { value: parsedValue });
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, value: parsedValue } : r));
      setEditingRule(null);
      toast.success('Rule updated');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDelete = async (rule: OvRule) => {
    if (confirmDelete !== rule.id) {
      setConfirmDelete(rule.id);
      setTimeout(() => setConfirmDelete(null), 3000);
      return;
    }
    try {
      await deleteOvRule(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      toast.success(`Deleted ${rule.category}.${rule.key}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
    setConfirmDelete(null);
  };

  const handleApplyPreset = async (preset: 'strict' | 'normal' | 'permissive') => {
    setApplyingPreset(preset);
    try {
      const result = await applyRulePreset(preset);
      toast.success(`Applied ${preset} preset (${result.count} rules)`);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setApplyingPreset(null);
    }
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const result = await seedDefaultRules();
      toast.success(`Seeded ${result.count} default rules`);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="animate-spin w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header with presets */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {rules.filter((r) => r.enabled).length} active / {rules.length} total
          </span>
          <div className="w-px h-4 bg-white/10" />
          {/* Category filter */}
          <div className="flex items-center gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  filter === cat
                    ? 'bg-indigo-600/30 text-indigo-400 border border-indigo-500/30'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Seed defaults */}
          {rules.length === 0 && (
            <button
              onClick={handleSeedDefaults}
              disabled={seeding}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 disabled:opacity-50 transition-colors"
            >
              {seeding ? 'Seeding...' : '🌱 Seed Build Rules'}
            </button>
          )}
          {/* Preset buttons */}
          <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-0.5">
            {(['strict', 'normal', 'permissive'] as const).map((preset) => (
              <button
                key={preset}
                onClick={() => handleApplyPreset(preset)}
                disabled={!!applyingPreset}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                  applyingPreset === preset
                    ? 'bg-indigo-600/30 text-indigo-400'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                } disabled:opacity-50`}
              >
                {applyingPreset === preset ? '...' : preset.charAt(0).toUpperCase() + preset.slice(1)}
              </button>
            ))}
          </div>
          {/* Add rule */}
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-all"
          >
            + Add Rule
          </button>
        </div>
      </div>

      {/* Rules Table */}
      {filteredRules.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📏</div>
          <p className="text-sm text-slate-400 mb-1">No rules configured</p>
          <p className="text-[11px] text-slate-600 max-w-sm mx-auto mb-4">
            Rules control how the Overmind behaves — iteration counts, quality thresholds,
            build policies, and more. Seed the defaults or add custom rules.
          </p>
          <button
            onClick={handleSeedDefaults}
            disabled={seeding}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-all"
          >
            {seeding ? 'Seeding...' : '🌱 Seed Default Build Rules'}
          </button>
        </div>
      ) : (
        <div className="border border-white/[0.06] rounded-xl bg-slate-900/50 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[40px_1fr_1fr_80px_60px_80px] gap-2 px-4 py-2 border-b border-white/[0.06] text-[10px] text-slate-600 uppercase tracking-wider font-medium">
            <span>On</span>
            <span>Rule</span>
            <span>Value</span>
            <span>Scope</span>
            <span>Cat.</span>
            <span className="text-right">Actions</span>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-white/[0.03]">
            {filteredRules.map((rule) => {
              const isEditing = editingRule === rule.id;
              const isDeleting = confirmDelete === rule.id;

              return (
                <div
                  key={rule.id}
                  className="grid grid-cols-[40px_1fr_1fr_80px_60px_80px] gap-2 px-4 py-2.5 items-center hover:bg-white/[0.02] transition-colors"
                >
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggle(rule)}
                    className={`w-8 h-4 rounded-full relative transition-colors ${
                      rule.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                        rule.enabled ? 'left-4' : 'left-0.5'
                      }`}
                    />
                  </button>

                  {/* Key */}
                  <span className={`text-[11px] font-mono ${rule.enabled ? 'text-slate-300' : 'text-slate-600'}`}>
                    {rule.category}.{rule.key}
                  </span>

                  {/* Value */}
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(rule);
                          if (e.key === 'Escape') setEditingRule(null);
                        }}
                        className="flex-1 bg-slate-800 border border-indigo-600 rounded px-2 py-0.5 text-[11px] text-white font-mono focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSaveEdit(rule)}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => setEditingRule(null)}
                        className="text-[10px] text-slate-500 hover:text-slate-300"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <span
                      onClick={() => handleStartEdit(rule)}
                      className="text-[11px] text-slate-500 font-mono cursor-pointer hover:text-slate-300 truncate"
                      title={typeof rule.value === 'object' ? JSON.stringify(rule.value) : String(rule.value)}
                    >
                      {typeof rule.value === 'object' ? JSON.stringify(rule.value) : String(rule.value)}
                    </span>
                  )}

                  {/* Scope */}
                  <span className="text-[10px] text-slate-600">{rule.scope}</span>

                  {/* Category badge */}
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${getCategoryColor(rule.category)}`}>
                    {rule.category.slice(0, 6)}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => handleStartEdit(rule)}
                      className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-indigo-400 transition-colors"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDelete(rule)}
                      className={`px-1.5 py-0.5 text-[10px] transition-colors ${
                        isDeleting
                          ? 'text-red-400 font-semibold'
                          : 'text-slate-500 hover:text-red-400'
                      }`}
                    >
                      {isDeleting ? 'Sure?' : '🗑'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create Rule Dialog */}
      {showCreateForm && (
        <CreateRuleDialog
          onClose={() => setShowCreateForm(false)}
          onCreated={() => { setShowCreateForm(false); refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Create Rule Dialog ────────────────────────────────────────────

function CreateRuleDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [category, setCategory] = useState('');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState('global');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!category.trim() || !key.trim()) {
      toast.error('Category and key are required');
      return;
    }

    setSubmitting(true);
    try {
      let parsedValue: unknown = value;
      if (value === 'true') parsedValue = true;
      else if (value === 'false') parsedValue = false;
      else if (!isNaN(Number(value)) && value.trim() !== '') parsedValue = Number(value);
      else {
        try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
      }

      await createOvRule({
        category: category.trim(),
        key: key.trim(),
        value: parsedValue,
        enabled: true,
        scope,
      });
      toast.success(`Created ${category}.${key}`);
      onCreated();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">Add Rule</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-500">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., build, iteration"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-600 transition-colors"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-medium block mb-1.5">Key</label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="e.g., max_iterations"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-600 transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Value</label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g., 5, true, or JSON"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-600 transition-colors font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 font-medium block mb-1.5">Scope</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-600 transition-colors"
            >
              <option value="global">Global</option>
              <option value="agent">Per Agent</option>
              <option value="job">Per Job</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !category.trim() || !key.trim()}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              submitting || !category.trim() || !key.trim()
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {submitting ? 'Creating...' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    build: 'bg-blue-500/20 text-blue-400',
    iteration: 'bg-purple-500/20 text-purple-400',
    quality: 'bg-emerald-500/20 text-emerald-400',
    thresholds: 'bg-amber-500/20 text-amber-400',
    agent: 'bg-cyan-500/20 text-cyan-400',
    policy: 'bg-indigo-500/20 text-indigo-400',
  };
  return colors[category] || 'bg-slate-500/20 text-slate-400';
}
