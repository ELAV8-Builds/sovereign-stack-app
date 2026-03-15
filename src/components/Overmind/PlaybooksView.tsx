import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  getPlaybooks,
  createPlaybook,
  updatePlaybook,
  deletePlaybook,
  seedPlaybooks,
  getOvSkills,
  type OvPlaybook,
  type CreatePlaybookInput,
  type PlaybookPassConfig,
} from '@/lib/overmind';
import type { OvermindEvent } from '@/lib/useOvermindSocket';
import { MODEL_LABELS } from '@/lib/constants';

interface PlaybooksViewProps {
  lastEvent?: OvermindEvent | null;
}

export function PlaybooksView({ lastEvent }: PlaybooksViewProps) {
  const [playbooks, setPlaybooks] = useState<OvPlaybook[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const refresh = useCallback(async () => {
    const pb = await getPlaybooks();
    setPlaybooks(pb);
    setLoading(false);
  }, []);

  const lastEventRef = useRef(lastEvent);
  useEffect(() => {
    if (lastEvent && lastEvent !== lastEventRef.current) {
      lastEventRef.current = lastEvent;
      if (['rules_update', 'snapshot', 'recipe_created', 'recipe_updated', 'recipe_deleted'].includes(lastEvent.type)) {
        refresh();
      }
    }
  }, [lastEvent, refresh]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleSeedPlaybooks = async () => {
    setSeeding(true);
    try {
      const result = await seedPlaybooks();
      toast.success(`Seeded ${result.count} playbooks`);
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  const handleDeletePlaybook = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    try {
      await deletePlaybook(id);
      setPlaybooks((prev) => prev.filter((p) => p.id !== id));
      toast.success('Playbook deleted');
    } catch (err) {
      toast.error((err as Error).message);
    }
    setConfirmDeleteId(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="animate-spin w-6 h-6 border-2 border-violet-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{playbooks.length} playbook{playbooks.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {playbooks.length === 0 && (
            <button
              onClick={handleSeedPlaybooks}
              disabled={seeding}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-violet-600/20 text-violet-400 border border-violet-500/30 hover:bg-violet-600/30 disabled:opacity-50 transition-colors"
            >
              {seeding ? 'Seeding...' : 'Seed Playbooks'}
            </button>
          )}
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-all"
          >
            + Create
          </button>
        </div>
      </div>

      {/* Playbook Cards */}
      {playbooks.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-sm text-slate-400 mb-1">No playbooks configured</p>
          <p className="text-[11px] text-slate-600 max-w-sm mx-auto mb-4">
            Playbooks define how to execute tasks — model, iterations, skills, fleet preference,
            and rules. Create them through chat or seed the defaults.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleSeedPlaybooks}
              disabled={seeding}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition-all"
            >
              {seeding ? 'Seeding...' : 'Seed Default Playbooks'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {playbooks.map((pb) => (
            editingId === pb.id ? (
              <PlaybookEditForm
                key={pb.id}
                playbook={pb}
                onSave={async (updates) => {
                  try {
                    await updatePlaybook(pb.id, updates);
                    toast.success('Playbook updated');
                    setEditingId(null);
                    refresh();
                  } catch (err) { toast.error((err as Error).message); }
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <PlaybookCard
                key={pb.id}
                playbook={pb}
                isDeleting={confirmDeleteId === pb.id}
                onDelete={() => handleDeletePlaybook(pb.id)}
                onEdit={() => setEditingId(pb.id)}
              />
            )
          ))}
        </div>
      )}

      {/* Create Playbook Form */}
      {showCreateForm && (
        <PlaybookCreateForm
          onSave={async (input) => {
            try {
              await createPlaybook(input);
              toast.success('Playbook created');
              setShowCreateForm(false);
              refresh();
            } catch (err) { toast.error((err as Error).message); }
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

    </div>
  );
}

// ─── Playbook Card ──────────────────────────────────────────────────

function PlaybookCard({
  playbook: pb,
  isDeleting,
  onDelete,
  onEdit,
}: {
  playbook: OvPlaybook;
  isDeleting: boolean;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const targetTypeColors: Record<string, string> = {
    web_app: 'bg-blue-900/30 text-blue-400 border-blue-800/30',
    mobile_app: 'bg-green-900/30 text-green-400 border-green-800/30',
    website: 'bg-cyan-900/30 text-cyan-400 border-cyan-800/30',
    desktop_app: 'bg-purple-900/30 text-purple-400 border-purple-800/30',
    other: 'bg-slate-800/50 text-slate-400 border-slate-700/30',
  };

  return (
    <div className="border border-white/[0.06] rounded-xl bg-slate-900/60 hover:bg-slate-900/80 transition-colors">
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white mb-0.5">{pb.name}</h3>
            {pb.description && (
              <p className="text-[11px] text-slate-500 line-clamp-2">{pb.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
            <button
              onClick={onEdit}
              className="p-1 rounded hover:bg-white/[0.06] text-slate-600 hover:text-indigo-400 transition-colors"
              title="Edit playbook"
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
              </svg>
            </button>
            <button
              onClick={onDelete}
              className={`p-1 rounded transition-colors ${
                isDeleting ? 'text-red-400 bg-red-900/20' : 'text-slate-600 hover:text-red-400 hover:bg-white/[0.06]'
              }`}
              title={isDeleting ? 'Click again to confirm' : 'Delete playbook'}
            >
              {isDeleting ? (
                <span className="text-[10px] font-semibold px-1">Sure?</span>
              ) : (
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${targetTypeColors[pb.target_type] || targetTypeColors.other}`}>
            {pb.target_type.replace(/_/g, ' ')}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/30 text-indigo-400 border border-indigo-800/30">
            {MODEL_LABELS[pb.model] || pb.model}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/30">
            {pb.iteration_config.min}-{pb.iteration_config.max} iter
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/30">
            fleet: {pb.fleet_preference}
          </span>
        </div>

        {pb.skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {pb.skills.map((skill) => (
              <span key={skill} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/20 text-emerald-400 border border-emerald-800/20">
                {skill}
              </span>
            ))}
          </div>
        )}

        {pb.tools.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {pb.tools.map((tool) => (
              <span key={tool} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/20 text-amber-400/80 border border-amber-800/20">
                {tool}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/[0.04]">
          <span className="text-[10px] text-slate-600">
            Used {pb.usage_count} time{pb.usage_count !== 1 ? 's' : ''}
          </span>
          {pb.last_used_at && (
            <span className="text-[10px] text-slate-600">
              Last: {new Date(pb.last_used_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Multi-Select Dropdown ──────────────────────────────────────────

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (val: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter(s => s !== val) : [...selected, val]);
  };

  return (
    <div ref={ref} className="relative">
      <label className="text-[10px] text-slate-500 font-medium">{label}</label>
      <button
        onClick={() => setOpen(!open)}
        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white font-mono text-left focus:outline-none focus:border-indigo-600 transition-colors flex items-center justify-between"
      >
        <span className="truncate">{selected.length > 0 ? selected.join(', ') : (placeholder || 'Select...')}</span>
        <span className="text-[9px] text-slate-600 ml-1">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-slate-800 border border-slate-700 rounded shadow-xl max-h-40 overflow-y-auto">
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => toggle(opt)}
              className={`w-full text-left px-2 py-1 text-[11px] font-mono hover:bg-slate-700 transition-colors ${selected.includes(opt) ? 'text-indigo-400 bg-indigo-900/20' : 'text-slate-300'}`}
            >
              {selected.includes(opt) ? '✓ ' : '  '}{opt}
            </button>
          ))}
          {options.length === 0 && <div className="px-2 py-1 text-[10px] text-slate-600">No options</div>}
        </div>
      )}
    </div>
  );
}

// ─── Iteration Passes Editor ────────────────────────────────────────

const PASS_TYPES = ['full_build', 'focused_fixes', 'resistance_check', 'deep_remediation'] as const;

function PassesEditor({
  passes,
  onChange,
  availableSkills,
}: {
  passes: PlaybookPassConfig[];
  onChange: (passes: PlaybookPassConfig[]) => void;
  availableSkills: string[];
}) {
  const addPass = () => {
    onChange([...passes, {
      iteration: passes.length + 1,
      type: 'focused_fixes',
      disclosure: 2,
      tier: 'coder',
    }]);
  };

  const removePass = (idx: number) => {
    const updated = passes.filter((_, i) => i !== idx).map((p, i) => ({ ...p, iteration: i + 1 }));
    onChange(updated);
  };

  const updatePass = (idx: number, field: string, value: unknown) => {
    const updated = passes.map((p, i) => i === idx ? { ...p, [field]: value } : p);
    onChange(updated);
  };

  const fieldClass = 'w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:border-indigo-600 transition-colors';
  const selectClass = 'bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-indigo-600 transition-colors w-full';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500 font-medium">Iteration Passes ({passes.length})</span>
        <button onClick={addPass} className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">+ Add Pass</button>
      </div>
      {passes.length === 0 && (
        <div className="text-[10px] text-slate-600 py-2 text-center">No custom passes — system defaults will be used</div>
      )}
      <div className="space-y-1.5">
        {passes.map((pass, idx) => (
          <div key={pass.iteration} className="flex items-start gap-1.5 p-2 bg-slate-800/50 rounded-lg border border-slate-700/50">
            <div className="flex items-center justify-center w-5 h-5 rounded bg-indigo-900/30 text-indigo-400 text-[10px] font-bold flex-shrink-0 mt-0.5">
              {pass.iteration}
            </div>
            <div className="flex-1 grid grid-cols-3 gap-1.5">
              <div>
                <select value={pass.type} onChange={(e) => updatePass(idx, 'type', e.target.value)} className={selectClass}>
                  {PASS_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <select value={pass.tier} onChange={(e) => updatePass(idx, 'tier', e.target.value)} className={selectClass}>
                  {MODEL_OPTIONS.map(m => <option key={m} value={m}>{MODEL_LABELS[m] || m}</option>)}
                </select>
              </div>
              <div>
                <select
                  value={pass.skill_name || ''}
                  onChange={(e) => updatePass(idx, 'skill_name', e.target.value || undefined)}
                  className={selectClass}
                >
                  <option value="">Default skill</option>
                  {availableSkills.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {pass.custom_prompt !== undefined && (
                <div className="col-span-3">
                  <input
                    type="text"
                    value={pass.custom_prompt || ''}
                    onChange={(e) => updatePass(idx, 'custom_prompt', e.target.value || undefined)}
                    className={fieldClass}
                    placeholder="Custom instruction for this iteration..."
                  />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-0.5 flex-shrink-0">
              <button
                onClick={() => updatePass(idx, 'custom_prompt', pass.custom_prompt !== undefined ? undefined : '')}
                className="text-[9px] text-slate-600 hover:text-slate-400 px-1"
                title={pass.custom_prompt !== undefined ? 'Remove prompt' : 'Add custom prompt'}
              >
                {pass.custom_prompt !== undefined ? '✕ prompt' : '+ prompt'}
              </button>
              <button onClick={() => removePass(idx)} className="text-[9px] text-red-500/60 hover:text-red-400 px-1">remove</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Playbook Edit Form ─────────────────────────────────────────────

const TARGET_TYPES = ['web_app', 'mobile_app', 'website', 'desktop_app', 'other'] as const;
const MODEL_OPTIONS = ['coder', 'medium', 'heavy', 'light', 'creative', 'codex', 'critic'] as const;
const FLEET_OPTIONS = ['any', 'local', 'remote', 'fastest'] as const;
const KNOWN_TOOLS = ['typescript', 'tailwind', 'react', 'next.js', 'express', 'postgresql', 'supabase', 'vercel-deploy', 'docker', 'prisma', 'drizzle', 'shadcn'];

function PlaybookEditForm({
  playbook,
  onSave,
  onCancel,
}: {
  playbook: OvPlaybook;
  onSave: (updates: Partial<CreatePlaybookInput>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(playbook.name);
  const [description, setDescription] = useState(playbook.description);
  const [targetType, setTargetType] = useState(playbook.target_type);
  const [model, setModel] = useState(playbook.model);
  const [fleetPref, setFleetPref] = useState(playbook.fleet_preference);
  const [tools, setTools] = useState<string[]>(playbook.tools);
  const [skills, setSkills] = useState<string[]>(playbook.skills);
  const [passes, setPasses] = useState<PlaybookPassConfig[]>(playbook.iteration_config.passes || []);
  const [escalationMode, setEscalationMode] = useState(playbook.iteration_config.escalation_mode || 'escalate');
  const [saving, setSaving] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);

  useEffect(() => {
    getOvSkills().then(s => setAvailableSkills(s.map(sk => sk.name))).catch(() => {});
  }, []);

  const minIter = passes.length > 0 ? passes.length : 1;
  const maxIter = Math.max(passes.length, 1);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        target_type: targetType,
        model,
        fleet_preference: fleetPref,
        iteration_config: {
          min: minIter,
          max: maxIter,
          passes: passes.length > 0 ? passes : undefined,
          escalation_mode: escalationMode as any,
        },
        tools,
        skills,
      });
    } finally { setSaving(false); }
  };

  const fieldClass = 'w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:border-indigo-600 transition-colors';
  const selectClass = 'bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-indigo-600 transition-colors';

  return (
    <div className="border border-indigo-500/30 rounded-xl bg-slate-900/80 p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-indigo-400">Edit Playbook</span>
        <div className="flex items-center gap-2">
          <button onClick={handleSubmit} disabled={saving || !name.trim()} className="px-3 py-1 rounded text-[10px] font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-all">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onCancel} className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-1">Cancel</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 font-medium">Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} autoFocus />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 font-medium">Target Type</label>
          <select value={targetType} onChange={(e) => setTargetType(e.target.value)} className={`${selectClass} w-full`}>
            {TARGET_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="text-[10px] text-slate-500 font-medium">Description</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClass} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 font-medium">Default Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)} className={`${selectClass} w-full`}>
            {MODEL_OPTIONS.map(m => <option key={m} value={m}>{MODEL_LABELS[m] || m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 font-medium">Fleet</label>
          <select value={fleetPref} onChange={(e) => setFleetPref(e.target.value)} className={`${selectClass} w-full`}>
            {FLEET_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 font-medium">Escalation</label>
          <select value={escalationMode} onChange={(e) => setEscalationMode(e.target.value)} className={`${selectClass} w-full`}>
            <option value="escalate">Escalate</option>
            <option value="force_complete">Force Complete</option>
            <option value="pause">Pause</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MultiSelectDropdown label="Tools" options={KNOWN_TOOLS} selected={tools} onChange={setTools} placeholder="Select tools..." />
        <MultiSelectDropdown label="Skills" options={availableSkills} selected={skills} onChange={setSkills} placeholder="Select skills..." />
      </div>

      <PassesEditor passes={passes} onChange={setPasses} availableSkills={availableSkills} />
    </div>
  );
}

// ─── Playbook Create Form ───────────────────────────────────────────

function PlaybookCreateForm({
  onSave,
  onCancel,
}: {
  onSave: (input: CreatePlaybookInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetType, setTargetType] = useState<string>('web_app');
  const [model, setModel] = useState('coder');
  const [fleetPref, setFleetPref] = useState('any');
  const [tools, setTools] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [passes, setPasses] = useState<PlaybookPassConfig[]>([]);
  const [escalationMode, setEscalationMode] = useState('escalate');
  const [saving, setSaving] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);

  useEffect(() => {
    getOvSkills().then(s => setAvailableSkills(s.map(sk => sk.name))).catch(() => {});
  }, []);

  const minIter = passes.length > 0 ? passes.length : 2;
  const maxIter = Math.max(passes.length, 5);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        target_type: targetType,
        model,
        fleet_preference: fleetPref,
        iteration_config: {
          min: minIter,
          max: maxIter,
          passes: passes.length > 0 ? passes : undefined,
          escalation_mode: escalationMode as any,
        },
        tools,
        skills,
      });
    } finally { setSaving(false); }
  };

  const fieldClass = 'w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:border-indigo-600 transition-colors';
  const selectClass = 'bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-indigo-600 transition-colors';

  return (
    <div className="border border-violet-500/30 rounded-xl bg-slate-900/80 p-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-violet-400">New Playbook</span>
        <div className="flex items-center gap-2">
          <button onClick={handleSubmit} disabled={saving || !name.trim()} className="px-3 py-1 rounded text-[10px] font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 transition-all">
            {saving ? 'Creating...' : 'Create'}
          </button>
          <button onClick={onCancel} className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-1">Cancel</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 font-medium">Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} autoFocus placeholder="My Playbook" />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 font-medium">Target Type</label>
          <select value={targetType} onChange={(e) => setTargetType(e.target.value)} className={`${selectClass} w-full`}>
            {TARGET_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="text-[10px] text-slate-500 font-medium">Description</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClass} placeholder="What this playbook does..." />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 font-medium">Default Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value)} className={`${selectClass} w-full`}>
            {MODEL_OPTIONS.map(m => <option key={m} value={m}>{MODEL_LABELS[m] || m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 font-medium">Fleet</label>
          <select value={fleetPref} onChange={(e) => setFleetPref(e.target.value)} className={`${selectClass} w-full`}>
            {FLEET_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 font-medium">Escalation</label>
          <select value={escalationMode} onChange={(e) => setEscalationMode(e.target.value)} className={`${selectClass} w-full`}>
            <option value="escalate">Escalate</option>
            <option value="force_complete">Force Complete</option>
            <option value="pause">Pause</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MultiSelectDropdown label="Tools" options={KNOWN_TOOLS} selected={tools} onChange={setTools} placeholder="Select tools..." />
        <MultiSelectDropdown label="Skills" options={availableSkills} selected={skills} onChange={setSkills} placeholder="Select skills..." />
      </div>

      <PassesEditor passes={passes} onChange={setPasses} availableSkills={availableSkills} />
    </div>
  );
}

