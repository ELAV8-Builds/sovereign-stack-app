/**
 * Canvas — Page list sidebar
 */
import { PlusIcon, EditIcon, CopyIcon, TrashIcon } from "./Icons";
import type { PageSidebarProps } from "./types";

export function PageSidebar({
  pages,
  activePage,
  isLoading,
  editingName,
  editNameValue,
  confirmDeleteId,
  onSelectPage,
  onNewPage,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onEditNameValueChange,
  onDuplicate,
  onDelete,
}: PageSidebarProps) {
  return (
    <div className="w-56 flex-shrink-0 border-r border-white/[0.06] flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Pages</span>
        <button
          onClick={onNewPage}
          className="p-1 rounded-md hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
          title="New page"
        >
          <PlusIcon />
        </button>
      </div>

      {/* Page list */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {isLoading ? (
          <div className="p-4 text-center">
            <div className="animate-spin w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto" />
          </div>
        ) : pages.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500">
            No pages yet. Create one to get started.
          </div>
        ) : (
          pages.map((page) => (
            <div
              key={page.id}
              onClick={() => onSelectPage(page)}
              className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${
                activePage?.id === page.id
                  ? "bg-indigo-500/10 border border-indigo-500/20 text-white"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 border border-transparent"
              }`}
            >
              <span className="text-sm flex-shrink-0">{page.icon}</span>
              {editingName === page.id ? (
                <input
                  autoFocus
                  value={editNameValue}
                  onChange={(e) => onEditNameValueChange(e.target.value)}
                  onBlur={() => onSaveRename(page.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSaveRename(page.id);
                    if (e.key === "Escape") onCancelRename();
                  }}
                  className="flex-1 text-xs bg-transparent border-b border-indigo-500 outline-none text-white"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="flex-1 text-xs truncate">{page.name}</span>
              )}

              {/* Actions (hover) */}
              <div className="hidden group-hover:flex items-center gap-0.5">
                <button
                  onClick={(e) => onStartRename(page.id, page.name, e)}
                  className="p-0.5 rounded hover:bg-white/10 text-slate-500 hover:text-white"
                  title="Rename"
                >
                  <EditIcon />
                </button>
                <button
                  onClick={(e) => onDuplicate(page.id, page.name, e)}
                  className="p-0.5 rounded hover:bg-white/10 text-slate-500 hover:text-white"
                  title="Duplicate"
                >
                  <CopyIcon />
                </button>
                <button
                  onClick={(e) => onDelete(page.id, e)}
                  className={`p-0.5 rounded transition-all ${
                    confirmDeleteId === page.id
                      ? "bg-red-500/30 text-red-400 ring-1 ring-red-500/50"
                      : "hover:bg-red-500/20 text-slate-500 hover:text-red-400"
                  }`}
                  title={confirmDeleteId === page.id ? "Click again to confirm" : "Delete"}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
