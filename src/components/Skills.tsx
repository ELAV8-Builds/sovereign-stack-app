import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  fetchSkills,
  fetchSkillDetail,
  installSkill,
  updateSkill,
  removeSkill,
  type SkillsResponse,
} from "@/lib/skills";

// ─── Category config ────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  quality: { label: "Quality", color: "text-green-400 bg-green-900/30 border-green-800", icon: "✓" },
  process: { label: "Process", color: "text-blue-400 bg-blue-900/30 border-blue-800", icon: "⟳" },
  infrastructure: { label: "Infra", color: "text-purple-400 bg-purple-900/30 border-purple-800", icon: "⚡" },
  build: { label: "Build", color: "text-amber-400 bg-amber-900/30 border-amber-800", icon: "🔨" },
  uncategorized: { label: "Other", color: "text-slate-400 bg-slate-800/50 border-slate-700", icon: "•" },
};

// ─── Filter tabs ────────────────────────────────────────────────────────

type Filter = "all" | "installed" | "available" | "updates";

// ─── Component ──────────────────────────────────────────────────────────

export function Skills() {
  const [data, setData] = useState<SkillsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [skillDetail, setSkillDetail] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // ── Fetch skills ──────────────────────────────────────────────────────

  const loadSkills = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchSkills();
      setData(result);
    } catch (err) {
      setError(
        `Unable to load skills — make sure the Sovereign Stack API is running.\n\n${err}`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  // ── Load skill detail ─────────────────────────────────────────────────

  const handleSelectSkill = async (name: string) => {
    if (selectedSkill === name) {
      setSelectedSkill(null);
      setSkillDetail(null);
      return;
    }

    setSelectedSkill(name);
    setDetailLoading(true);
    setSkillDetail(null);

    try {
      const detail = await fetchSkillDetail(name);
      setSkillDetail(detail.content);
    } catch {
      setSkillDetail("Unable to load skill details.");
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Actions ───────────────────────────────────────────────────────────

  const handleInstall = async (name: string) => {
    setActionInProgress(name);
    try {
      await installSkill(name);
      toast.success(`${name} installed`);
      await loadSkills();
    } catch (err) {
      toast.error(`Failed to install ${name}: ${err}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleUpdate = async (name: string) => {
    setActionInProgress(name);
    try {
      await updateSkill(name);
      toast.success(`${name} updated`);
      await loadSkills();
    } catch (err) {
      toast.error(`Failed to update ${name}: ${err}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRemove = async (name: string) => {
    setActionInProgress(name);
    try {
      await removeSkill(name);
      toast.success(`${name} removed`);
      await loadSkills();
      if (selectedSkill === name) {
        setSelectedSkill(null);
        setSkillDetail(null);
      }
    } catch (err) {
      toast.error(`Failed to remove ${name}: ${err}`);
    } finally {
      setActionInProgress(null);
    }
  };

  // ── Filter logic ──────────────────────────────────────────────────────

  const filteredSkills = (data?.skills || []).filter((skill) => {
    // Filter tab
    if (filter === "installed" && !skill.installed) return false;
    if (filter === "available" && skill.installed) return false;
    if (filter === "updates" && !skill.hasUpdate) return false;

    // Search
    if (search) {
      const q = search.toLowerCase();
      return (
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.tags.some((t) => t.toLowerCase().includes(q)) ||
        skill.category.toLowerCase().includes(q)
      );
    }

    return true;
  });

  // ── Loading state ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mb-3" />
        <p className="text-sm text-slate-500">Loading skills...</p>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex flex-col h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 items-center justify-center p-6">
        <div className="text-3xl mb-3">⚠️</div>
        <p className="text-sm text-slate-400 text-center max-w-md whitespace-pre-wrap">
          {error}
        </p>
        <button
          onClick={() => {
            setLoading(true);
            loadSkills();
          }}
          className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-medium text-slate-300 transition-all"
        >
          ↻ Retry
        </button>
      </div>
    );
  }

  const stats = data?.stats || { installed: 0, available: 0, updates: 0, total: 0 };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-5xl mx-auto w-full">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-white">Skills</h1>
              <p className="text-sm text-slate-500">
                Manage agent capabilities
              </p>
            </div>
            <button
              onClick={() => {
                setLoading(true);
                loadSkills();
              }}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-medium text-slate-300 transition-all duration-200"
            >
              ↻ Refresh
            </button>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                Installed
              </div>
              <div className="text-2xl font-bold text-green-400">
                {stats.installed}
              </div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                Available
              </div>
              <div className="text-2xl font-bold text-blue-400">
                {stats.available}
              </div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                Updates
              </div>
              <div className="text-2xl font-bold text-amber-400">
                {stats.updates}
              </div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                Total
              </div>
              <div className="text-2xl font-bold text-white">{stats.total}</div>
            </div>
          </div>

          {/* Search + Filter */}
          <div className="flex items-center gap-3 mb-4">
            {/* Search */}
            <div className="flex-1 relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search skills..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 pl-9 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                🔍
              </span>
            </div>

            {/* Filter tabs */}
            <div className="flex items-center gap-1 bg-slate-800/50 border border-slate-700/50 rounded-lg p-0.5">
              {(
                [
                  { id: "all" as Filter, label: "All" },
                  { id: "installed" as Filter, label: `Installed (${stats.installed})` },
                  { id: "available" as Filter, label: `Available (${stats.available})` },
                  { id: "updates" as Filter, label: `Updates (${stats.updates})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                    filter === tab.id
                      ? "bg-slate-700 text-white"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Skills list */}
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl overflow-hidden">
            {/* Empty state */}
            {filteredSkills.length === 0 && (
              <div className="px-5 py-12 text-center">
                <div className="text-3xl mb-3">🧩</div>
                <p className="text-sm text-slate-400 mb-1">
                  {search
                    ? "No skills match your search"
                    : filter === "updates"
                    ? "All skills are up to date"
                    : filter === "available"
                    ? "No new skills available"
                    : "No skills found"}
                </p>
                <p className="text-xs text-slate-600">
                  {search
                    ? "Try a different search term"
                    : "Skills are synced from the Sovereign Skill Exchange nightly"}
                </p>
              </div>
            )}

            {/* Skill rows */}
            {filteredSkills.map((skill) => (
              <div key={skill.name}>
                {/* Main row */}
                <div
                  className={`flex items-center gap-4 px-5 py-3.5 border-b border-slate-800/50 cursor-pointer transition-all duration-150 ${
                    selectedSkill === skill.name
                      ? "bg-slate-800/50"
                      : "hover:bg-slate-800/30"
                  }`}
                  onClick={() => handleSelectSkill(skill.name)}
                >
                  {/* Expand arrow */}
                  <span
                    className={`text-xs text-slate-500 transition-transform duration-200 ${
                      selectedSkill === skill.name ? "rotate-90" : ""
                    }`}
                  >
                    ▸
                  </span>

                  {/* Status indicator */}
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      skill.hasUpdate
                        ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]"
                        : skill.installed
                        ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]"
                        : "bg-slate-600"
                    }`}
                  />

                  {/* Name + description */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-white">
                        {skill.name}
                      </span>
                      <span className="text-xs text-slate-600 font-mono">
                        v{skill.version}
                      </span>
                      {skill.hasUpdate && (
                        <span className="text-[10px] text-amber-400 font-medium px-1.5 py-0.5 bg-amber-900/30 border border-amber-800/50 rounded">
                          UPDATE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">
                      {skill.description}
                    </p>
                  </div>

                  {/* Category badge */}
                  {(() => {
                    const cat = CATEGORY_CONFIG[skill.category] || CATEGORY_CONFIG.uncategorized;
                    return (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cat.color}`}
                      >
                        {cat.icon} {cat.label}
                      </span>
                    );
                  })()}

                  {/* Action buttons */}
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!skill.installed && (
                      <button
                        onClick={() => handleInstall(skill.name)}
                        disabled={actionInProgress === skill.name}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                          actionInProgress === skill.name
                            ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                            : "bg-blue-600 hover:bg-blue-500 text-white shadow-sm"
                        }`}
                      >
                        {actionInProgress === skill.name ? (
                          <span className="flex items-center gap-1">
                            <span className="animate-spin w-3 h-3 border border-slate-400 border-t-transparent rounded-full" />
                            Installing...
                          </span>
                        ) : (
                          "Install"
                        )}
                      </button>
                    )}
                    {skill.hasUpdate && (
                      <button
                        onClick={() => handleUpdate(skill.name)}
                        disabled={actionInProgress === skill.name}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                          actionInProgress === skill.name
                            ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                            : "bg-amber-600 hover:bg-amber-500 text-white shadow-sm"
                        }`}
                      >
                        {actionInProgress === skill.name ? (
                          <span className="flex items-center gap-1">
                            <span className="animate-spin w-3 h-3 border border-slate-400 border-t-transparent rounded-full" />
                            Updating...
                          </span>
                        ) : (
                          "Update"
                        )}
                      </button>
                    )}
                    {skill.installed && !skill.hasUpdate && (
                      <button
                        onClick={() => handleRemove(skill.name)}
                        disabled={actionInProgress === skill.name}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                          actionInProgress === skill.name
                            ? "text-slate-600 cursor-not-allowed"
                            : "text-red-400 hover:bg-red-900/30"
                        }`}
                        title="Remove skill"
                      >
                        {actionInProgress === skill.name ? (
                          <span className="animate-spin w-3 h-3 border border-red-400 border-t-transparent rounded-full inline-block" />
                        ) : (
                          "✕"
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded detail view */}
                {selectedSkill === skill.name && (
                  <div className="px-5 py-4 bg-black/30 border-b border-slate-800/50 animate-fadeIn">
                    {/* Tags */}
                    {skill.tags.length > 0 && (
                      <div className="flex items-center gap-1.5 mb-3">
                        {skill.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-400 font-mono"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* SKILL.md content */}
                    {detailLoading ? (
                      <div className="flex items-center gap-2 py-4 justify-center">
                        <span className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full" />
                        <span className="text-xs text-slate-500">
                          Loading skill details...
                        </span>
                      </div>
                    ) : (
                      <pre className="font-mono text-xs text-slate-400 whitespace-pre-wrap leading-5 max-h-64 overflow-y-auto bg-slate-900/50 rounded-lg p-4 border border-slate-800">
                        {skillDetail || "No details available"}
                      </pre>
                    )}

                    {/* Source info */}
                    <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-600">
                      <span>
                        Source:{" "}
                        {skill.source === "both"
                          ? "Local + Exchange"
                          : skill.source === "local"
                          ? "Local only"
                          : "Exchange"}
                      </span>
                      <span>Category: {skill.category}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer note */}
          <p className="text-center text-[10px] text-slate-600 mt-4">
            Skills sync nightly from the Sovereign Skill Exchange. Ask the agent to "add a skill" or "create a new skill" to extend capabilities.
          </p>
        </div>
      </div>
    </div>
  );
}
