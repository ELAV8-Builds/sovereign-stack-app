/**
 * KnowledgeBase — Document management & RAG interface
 *
 * Shows AnythingLLM connection status, workspaces, document upload,
 * and a query tester.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import {
  getRAGStatus,
  listWorkspaces,
  createWorkspace,
  deleteWorkspace,
  uploadFile,
  uploadText,
  queryKnowledgeBase,
  type RAGStatus,
  type RAGWorkspace,
  type RAGQueryResult,
} from "@/lib/rag";

export function KnowledgeBase() {
  const [status, setStatus] = useState<RAGStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<RAGWorkspace[]>([]);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Text upload state
  const [showTextUpload, setShowTextUpload] = useState(false);
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");

  // New workspace
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  // Query tester
  const [queryText, setQueryText] = useState("");
  const [querying, setQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState<RAGQueryResult | null>(null);

  // ── Load status ────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const s = await getRAGStatus();
      setStatus(s);
      if (s.connected) {
        const ws = await listWorkspaces();
        setWorkspaces(ws);
        if (ws.length > 0 && !selectedWorkspace) {
          setSelectedWorkspace(ws[0].slug);
        }
      }
    } catch (e) {
      setStatus({
        connected: false,
        error: (e as Error).message,
        workspaces: [],
        system: null,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedWorkspace]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // ── Handlers ───────────────────────────────────────────

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadFile(file, selectedWorkspace || undefined);
        toast.success(`Uploaded: ${file.name}`);
      }
      await loadStatus();
    } catch (err) {
      toast.error(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleTextUpload = async () => {
    if (!textTitle.trim() || !textContent.trim()) {
      toast.error("Title and content are required");
      return;
    }

    setUploading(true);
    try {
      await uploadText(textTitle, textContent, selectedWorkspace || undefined);
      toast.success(`Text document uploaded: ${textTitle}`);
      setTextTitle("");
      setTextContent("");
      setShowTextUpload(false);
      await loadStatus();
    } catch (err) {
      toast.error(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;

    setCreatingWorkspace(true);
    try {
      const ws = await createWorkspace(newWorkspaceName.trim());
      toast.success(`Workspace created: ${ws.name}`);
      setNewWorkspaceName("");
      setSelectedWorkspace(ws.slug);
      await loadStatus();
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const handleDeleteWorkspace = async (slug: string) => {
    if (!confirm(`Delete workspace "${slug}"? This cannot be undone.`)) return;

    try {
      await deleteWorkspace(slug);
      toast.success("Workspace deleted");
      if (selectedWorkspace === slug) setSelectedWorkspace("");
      await loadStatus();
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  };

  const handleQuery = async () => {
    if (!queryText.trim()) return;

    setQuerying(true);
    setQueryResult(null);
    try {
      const result = await queryKnowledgeBase(
        queryText,
        selectedWorkspace || undefined,
        "query"
      );
      setQueryResult(result);
    } catch (err) {
      toast.error(`Query failed: ${(err as Error).message}`);
    } finally {
      setQuerying(false);
    }
  };

  // ── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          📚 Knowledge Base
        </h3>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
          <span className="ml-3 text-sm text-slate-400">Checking AnythingLLM connection...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Status */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          📚 Knowledge Base
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              status?.connected ? "bg-green-400" : "bg-red-400"
            }`}
          />
          <span className="text-xs text-slate-400">
            {status?.connected ? "Connected" : "Disconnected"}
          </span>
          <button
            onClick={loadStatus}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {!status?.connected && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-sm text-red-300">
            AnythingLLM is not connected.{" "}
            {status?.error || "Add your AnythingLLM API key in Settings → Security → Key Vault."}
          </p>
        </div>
      )}

      {status?.connected && (
        <>
          {/* System Info */}
          {status.system && (
            <div className="bg-slate-800/50 rounded-lg p-3 flex items-center gap-4 text-xs text-slate-400">
              <span>Vector DB: <span className="text-slate-300">{status.system.vectorDB}</span></span>
              <span>Embedder: <span className="text-slate-300">{status.system.embeddingEngine}</span></span>
              <span>Workspaces: <span className="text-slate-300">{workspaces.length}</span></span>
            </div>
          )}

          {/* Workspace Selector */}
          <div className="space-y-3">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Workspace
            </label>
            <div className="flex gap-2">
              <select
                value={selectedWorkspace}
                onChange={(e) => setSelectedWorkspace(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                {workspaces.length === 0 && (
                  <option value="">No workspaces — create one</option>
                )}
                {workspaces.map((ws) => (
                  <option key={ws.slug} value={ws.slug}>
                    {ws.name} ({ws.documents?.length || 0} docs)
                  </option>
                ))}
              </select>
              {selectedWorkspace && (
                <button
                  onClick={() => handleDeleteWorkspace(selectedWorkspace)}
                  className="px-3 py-2 bg-red-500/20 text-red-400 rounded-lg text-xs hover:bg-red-500/30 transition-colors"
                  title="Delete workspace"
                >
                  🗑
                </button>
              )}
            </div>

            {/* New Workspace */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateWorkspace()}
                placeholder="New workspace name..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleCreateWorkspace}
                disabled={creatingWorkspace || !newWorkspaceName.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creatingWorkspace ? "..." : "+ Create"}
              </button>
            </div>
          </div>

          {/* Document Upload */}
          <div className="space-y-3">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Upload Documents
            </label>

            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || !selectedWorkspace}
                className="flex-1 px-4 py-3 bg-slate-800 border border-dashed border-slate-600 rounded-lg text-sm text-slate-400 hover:border-blue-500 hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full" />
                    Uploading...
                  </span>
                ) : (
                  "📎 Choose files (PDF, TXT, MD, DOCX...)"
                )}
              </button>
              <button
                onClick={() => setShowTextUpload(!showTextUpload)}
                disabled={!selectedWorkspace}
                className="px-3 py-3 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                title="Paste text"
              >
                📝
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileUpload}
              multiple
              accept=".pdf,.txt,.md,.docx,.doc,.csv,.json,.html,.htm,.epub"
              className="hidden"
            />

            {/* Text Upload Panel */}
            {showTextUpload && (
              <div className="bg-slate-800/50 rounded-lg p-4 space-y-3 border border-slate-700">
                <input
                  type="text"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  placeholder="Document title..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                />
                <textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="Paste text content here..."
                  rows={6}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none resize-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowTextUpload(false)}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleTextUpload}
                    disabled={uploading || !textTitle.trim() || !textContent.trim()}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {uploading ? "Uploading..." : "Upload Text"}
                  </button>
                </div>
              </div>
            )}

            {!selectedWorkspace && (
              <p className="text-xs text-slate-500">
                Create a workspace first to upload documents.
              </p>
            )}
          </div>

          {/* Query Tester */}
          <div className="space-y-3">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Query Knowledge Base
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleQuery()}
                placeholder="Ask a question about your documents..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleQuery}
                disabled={querying || !queryText.trim() || !selectedWorkspace}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {querying ? (
                  <span className="flex items-center gap-1">
                    <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                    ...
                  </span>
                ) : (
                  "🔍 Search"
                )}
              </button>
            </div>

            {/* Query Results */}
            {queryResult && (
              <div className="bg-slate-800/50 rounded-lg p-4 space-y-3 border border-slate-700">
                {queryResult.answer ? (
                  <>
                    <div className="text-sm text-white whitespace-pre-wrap">
                      {queryResult.answer}
                    </div>
                    {queryResult.sources.length > 0 && (
                      <div className="border-t border-slate-700 pt-3 mt-3">
                        <p className="text-xs font-medium text-slate-400 mb-2">
                          Sources ({queryResult.sources.length})
                        </p>
                        {queryResult.sources.map((s, i) => (
                          <div
                            key={i}
                            className="text-xs text-slate-500 bg-slate-900/50 rounded px-2 py-1.5 mb-1"
                          >
                            <span className="text-slate-300">{s.title}</span>
                            {s.text && (
                              <p className="mt-1 text-slate-500 truncate">
                                {s.text.slice(0, 200)}...
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-slate-500">
                    No relevant results found. Make sure documents are uploaded and embedded in this workspace.
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
