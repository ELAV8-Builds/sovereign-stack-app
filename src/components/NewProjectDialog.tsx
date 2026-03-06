import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  listTemplates,
  createWorkspace,
  type Workspace,
  type WorkspaceTemplate,
} from '@/lib/workspace';

// ── Types ──────────────────────────────────────────────────────────────

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (workspace: Workspace) => void;
}

// ── Component ──────────────────────────────────────────────────────────

export function NewProjectDialog({ open, onClose, onCreated }: NewProjectDialogProps) {
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // ── Fetch templates when dialog opens ──────────────────────────────

  useEffect(() => {
    if (!open) return;

    // Reset state when dialog opens
    setSelectedTemplate(null);
    setName('');
    setDescription('');
    setIsCreating(false);

    listTemplates()
      .then((data) => setTemplates(data))
      .catch((err) => {
        toast.error(`Failed to load templates: ${err.message}`);
      });
  }, [open]);

  // ── Handlers ───────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!name.trim() || !selectedTemplate) return;

    setIsCreating(true);
    try {
      const workspace = await createWorkspace(
        name.trim(),
        selectedTemplate,
        description.trim() || undefined,
      );
      toast.success(`Project "${workspace.name}" created!`);
      onCreated(workspace);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  // ── Don't render when closed ───────────────────────────────────────

  if (!open) return null;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="w-full max-w-2xl mx-4 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-fadeIn">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.06]">
          <h2 className="text-lg font-semibold text-white">New Project</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/[0.06] text-slate-500 hover:text-white transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Template picker */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-3">
              Choose a template
            </label>
            <div className="grid grid-cols-2 gap-3">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => setSelectedTemplate(tpl.id)}
                  className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-200 ${
                    selectedTemplate === tpl.id
                      ? 'ring-2 ring-indigo-500 border-indigo-500/40 bg-indigo-500/5'
                      : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12]'
                  }`}
                >
                  <span className="text-2xl flex-shrink-0 mt-0.5">{tpl.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white">{tpl.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/[0.06] text-slate-500 border border-white/[0.06]">
                        {tpl.category}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2">{tpl.description}</p>
                  </div>
                </button>
              ))}
            </div>

            {templates.length === 0 && (
              <div className="p-8 text-center rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <div className="animate-spin w-5 h-5 border-2 border-slate-600 border-t-slate-400 rounded-full mx-auto mb-3" />
                <p className="text-xs text-slate-500">Loading templates...</p>
              </div>
            )}
          </div>

          {/* Name input */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Project name <span className="text-red-400">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My awesome project"
              autoFocus
              className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 transition-all"
            />
          </div>

          {/* Description textarea */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Description <span className="text-slate-600">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of what this project does..."
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 resize-none transition-all"
            />
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating || !name.trim() || !selectedTemplate}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-medium transition-all ${
              isCreating || !name.trim() || !selectedTemplate
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 active:scale-[0.98]'
            }`}
          >
            {isCreating ? (
              <>
                <div className="animate-spin w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full" />
                Scaffolding...
              </>
            ) : (
              'Create Project'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
