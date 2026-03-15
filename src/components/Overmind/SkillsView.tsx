import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  fetchSkills,
  fetchSkillDetail,
  installSkill,
  updateSkill,
  removeSkill,
  type SkillsResponse,
} from '@/lib/skills';

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  quality: { label: 'Quality', color: 'text-green-400 bg-green-900/30 border-green-800', icon: '✓' },
  process: { label: 'Process', color: 'text-blue-400 bg-blue-900/30 border-blue-800', icon: '⟳' },
  infrastructure: { label: 'Infra', color: 'text-purple-400 bg-purple-900/30 border-purple-800', icon: '⚡' },
  build: { label: 'Build', color: 'text-amber-400 bg-amber-900/30 border-amber-800', icon: '🔨' },
  uncategorized: { label: 'Other', color: 'text-slate-400 bg-slate-800/50 border-slate-700', icon: '•' },
};

type Filter = 'all' | 'installed' | 'available' | 'updates';

export function SkillsView() {
  const [data, setData] = useState<SkillsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [skillDetail, setSkillDetail] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchSkills();
      setData(result);
    } catch (err) {
      setError(`Unable to load skills: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const handleSelectSkill = async (name: string) => {
    if (selectedSkill === name) { setSelectedSkill(null); setSkillDetail(null); return; }
    setSelectedSkill(name);
    setDetailLoading(true);
    setSkillDetail(null);
    try {
      const detail = await fetchSkillDetail(name);
      setSkillDetail(detail.content);
    } catch { setSkillDetail('Unable to load skill details.'); }
    finally { setDetailLoading(false); }
  };

  const handleInstall = async (name: string) => {
    setActionInProgress(name);
    try { await installSkill(name); toast.success(`${name} installed`); await loadSkills(); }
    catch (err) { toast.error(`Failed: ${err}`); }
    finally { setActionInProgress(null); }
  };

  const handleUpdate = async (name: string) => {
    setActionInProgress(name);
    try { await updateSkill(name); toast.success(`${name} updated`); await loadSkills(); }
    catch (err) { toast.error(`Failed: ${err}`); }
    finally { setActionInProgress(null); }
  };

  const handleRemove = async (name: string) => {
    setActionInProgress(name);
    try {
      await removeSkill(name); toast.success(`${name} removed`); await loadSkills();
      if (selectedSkill === name) { setSelectedSkill(null); setSkillDetail(null); }
    } catch (err) { toast.error(`Failed: ${err}`); }
    finally { setActionInProgress(null); }
  };

  const filteredSkills = (data?.skills || []).filter((skill) => {
    if (filter === 'installed' && !skill.installed) return false;
    if (filter === 'available' && skill.installed) return false;
    if (filter === 'updates' && !skill.hasUpdate) return false;
    if (search) {
      const q = search.toLowerCase();
      return skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q) || skill.tags.some((t) => t.toLowerCase().includes(q));
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="animate-spin w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 p-4">
        <span className="text-2xl mb-2">⚠️</span>
        <p className="text-xs text-slate-400 text-center max-w-sm">{error}</p>
        <button onClick={() => { setLoading(true); loadSkills(); }} className="mt-3 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 hover:bg-slate-700 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  const stats = data?.stats || { installed: 0, available: 0, updates: 0, total: 0 };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-emerald-400 font-medium">{stats.installed}</span>
            <span className="text-[10px] text-slate-600">installed</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-400 font-medium">{stats.available}</span>
            <span className="text-[10px] text-slate-600">available</span>
          </div>
          {stats.updates > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-400 font-medium">{stats.updates}</span>
              <span className="text-[10px] text-slate-600">updates</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const name = window.prompt('Skill name:');
              if (!name?.trim()) return;
              toast('Skill creation requires a skill definition file. Use the CLI or create a SKILL.md in the skills directory.', { icon: 'ℹ️', duration: 5000 });
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-all"
          >
            + Create
          </button>
          <button onClick={() => { setLoading(true); loadSkills(); }} className="px-2 py-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
            ↻
          </button>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-2">
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..." className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-600 transition-colors"
        />
        <div className="flex items-center gap-0.5 bg-slate-800/50 rounded-lg p-0.5">
          {(['all', 'installed', 'available', 'updates'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${filter === f ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Skills List */}
      <div className="border border-white/[0.06] rounded-xl bg-slate-900/50 overflow-hidden">
        {filteredSkills.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <span className="text-2xl block mb-2">🧩</span>
            <p className="text-xs text-slate-500">{search ? 'No skills match your search' : 'No skills found'}</p>
          </div>
        ) : (
          filteredSkills.map((skill) => (
            <div key={skill.name}>
              <div
                className={`flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.03] cursor-pointer transition-colors ${selectedSkill === skill.name ? 'bg-slate-800/50' : 'hover:bg-white/[0.02]'}`}
                onClick={() => handleSelectSkill(skill.name)}
              >
                <span className={`text-[10px] text-slate-500 transition-transform ${selectedSkill === skill.name ? 'rotate-90' : ''}`}>▸</span>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${skill.hasUpdate ? 'bg-amber-400' : skill.installed ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white">{skill.name}</span>
                    <span className="text-[10px] text-slate-600 font-mono">v{skill.version}</span>
                    {skill.hasUpdate && <span className="text-[9px] text-amber-400 font-medium px-1 py-0.5 bg-amber-900/30 border border-amber-800/50 rounded">UPDATE</span>}
                  </div>
                  <p className="text-[10px] text-slate-500 truncate">{skill.description}</p>
                </div>
                {(() => { const cat = CATEGORY_CONFIG[skill.category] || CATEGORY_CONFIG.uncategorized; return <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${cat.color}`}>{cat.icon} {cat.label}</span>; })()}
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {!skill.installed && (
                    <button onClick={() => handleInstall(skill.name)} disabled={actionInProgress === skill.name} className="px-2 py-1 rounded text-[10px] font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-all">
                      {actionInProgress === skill.name ? '...' : 'Install'}
                    </button>
                  )}
                  {skill.hasUpdate && (
                    <button onClick={() => handleUpdate(skill.name)} disabled={actionInProgress === skill.name} className="px-2 py-1 rounded text-[10px] font-medium bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 transition-all">
                      {actionInProgress === skill.name ? '...' : 'Update'}
                    </button>
                  )}
                  {skill.installed && !skill.hasUpdate && (
                    <button onClick={() => handleRemove(skill.name)} disabled={actionInProgress === skill.name} className="px-1.5 py-1 text-[10px] text-red-400 hover:bg-red-900/20 rounded disabled:opacity-50 transition-all">
                      {actionInProgress === skill.name ? '...' : '✕'}
                    </button>
                  )}
                </div>
              </div>
              {selectedSkill === skill.name && (
                <div className="px-4 py-3 bg-black/20 border-b border-white/[0.03]">
                  {skill.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {skill.tags.map((tag) => <span key={tag} className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[9px] text-slate-500 font-mono">{tag}</span>)}
                    </div>
                  )}
                  {detailLoading ? (
                    <div className="flex items-center gap-2 py-3 justify-center">
                      <span className="animate-spin w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full" />
                      <span className="text-[10px] text-slate-500">Loading...</span>
                    </div>
                  ) : (
                    <pre className="font-mono text-[10px] text-slate-400 whitespace-pre-wrap leading-4 max-h-48 overflow-y-auto bg-slate-900/50 rounded-lg p-3 border border-slate-800">
                      {skillDetail || 'No details available'}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
