/**
 * RAG Routes — Document Knowledge Base Management
 *
 * Exposes AnythingLLM functionality through the Sovereign Stack API:
 * - Workspace CRUD
 * - Document upload + embedding
 * - RAG-powered queries
 * - Health / status
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import {
  checkAnythingLLMHealth,
  listWorkspaces,
  createWorkspace,
  getWorkspace,
  deleteWorkspace,
  listDocuments,
  uploadDocument,
  uploadTextDocument,
  embedDocumentsToWorkspace,
  removeDocumentsFromWorkspace,
  queryWorkspace,
  ensureDefaultWorkspace,
  getSystemInfo,
} from '../services/anythingllm';
import { logActivity } from '../services/activity-broadcaster';

export const ragRouter = Router();

// Multer for file uploads (10MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── Health & Status ──────────────────────────────────────

ragRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const healthy = await checkAnythingLLMHealth();
    const workspaces = healthy ? await listWorkspaces() : [];
    const systemInfo = healthy ? await getSystemInfo() : null;

    res.json({
      connected: healthy,
      workspaces: workspaces.map(w => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        documentCount: w.documents?.length || 0,
      })),
      system: systemInfo ? {
        vectorDB: systemInfo.settings?.VectorDB || 'lancedb',
        embeddingEngine: systemInfo.settings?.EmbeddingEngine || 'native',
      } : null,
    });
  } catch (e) {
    res.json({
      connected: false,
      error: (e as Error).message,
      workspaces: [],
      system: null,
    });
  }
});

// ── Workspaces ───────────────────────────────────────────

ragRouter.get('/workspaces', async (_req: Request, res: Response) => {
  try {
    const workspaces = await listWorkspaces();
    res.json({ workspaces });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

ragRouter.post('/workspaces', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    const workspace = await createWorkspace(name);
    res.json({ workspace });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

ragRouter.get('/workspaces/:slug', async (req: Request, res: Response) => {
  try {
    const workspace = await getWorkspace(req.params.slug as string);
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    res.json({ workspace });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

ragRouter.delete('/workspaces/:slug', async (req: Request, res: Response) => {
  try {
    const deleted = await deleteWorkspace(req.params.slug as string);
    res.json({ deleted });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── Documents ────────────────────────────────────────────

ragRouter.get('/documents', async (_req: Request, res: Response) => {
  try {
    const localFiles = await listDocuments();
    res.json({ documents: localFiles });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * Upload a file document.
 * POST /api/rag/documents/upload
 * Content-Type: multipart/form-data
 * Body: file (binary), workspace (optional slug)
 */
ragRouter.post('/documents/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const result = await uploadDocument(req.file.buffer, req.file.originalname);

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Upload failed' });
    }

    // If workspace slug provided, embed into workspace
    const workspaceSlug = req.body.workspace;
    if (workspaceSlug && result.documents) {
      const docPaths = result.documents.map((d: any) => d.location);
      await embedDocumentsToWorkspace(workspaceSlug, docPaths);
    }

    res.json({
      success: true,
      documents: result.documents,
      embedded: !!workspaceSlug,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * Upload raw text as a document.
 * POST /api/rag/documents/text
 * Body: { title, content, workspace? }
 */
ragRouter.post('/documents/text', async (req: Request, res: Response) => {
  try {
    const { title, content, workspace } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const result = await uploadTextDocument(title, content);

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Upload failed' });
    }

    // Embed into workspace if specified
    if (workspace && result.documents) {
      const docPaths = result.documents.map((d: any) => d.location);
      await embedDocumentsToWorkspace(workspace, docPaths);
    }

    res.json({
      success: true,
      documents: result.documents,
      embedded: !!workspace,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * Embed existing documents into a workspace.
 * POST /api/rag/workspaces/:slug/embed
 * Body: { documents: ["path/to/doc", ...] }
 */
ragRouter.post('/workspaces/:slug/embed', async (req: Request, res: Response) => {
  try {
    const { documents } = req.body;
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: 'documents array is required' });
    }

    const result = await embedDocumentsToWorkspace(req.params.slug as string, documents);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * Remove documents from a workspace.
 * POST /api/rag/workspaces/:slug/remove
 * Body: { documents: ["path/to/doc", ...] }
 */
ragRouter.post('/workspaces/:slug/remove', async (req: Request, res: Response) => {
  try {
    const { documents } = req.body;
    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: 'documents array is required' });
    }

    await removeDocumentsFromWorkspace(req.params.slug as string, documents);
    res.json({ removed: documents.length });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ── RAG Query ────────────────────────────────────────────

/**
 * Query the knowledge base with RAG.
 * POST /api/rag/query
 * Body: { question, workspace?, mode? }
 *
 * If workspace is not provided, uses/creates the default "sovereign" workspace.
 */
ragRouter.post('/query', async (req: Request, res: Response) => {
  try {
    const { question, workspace, mode = 'query' } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required' });
    }

    const slug = workspace || await ensureDefaultWorkspace();

    logActivity('rag', 'info', `RAG query: "${question.slice(0, 80)}..." → workspace: ${slug}`);

    const result = await queryWorkspace(slug, question, mode);

    if (result.error) {
      logActivity('rag', 'warning', `RAG query error: ${result.error}`);
      return res.status(500).json({ error: result.error });
    }

    logActivity('rag', 'success', `RAG query complete — ${result.sources.length} source(s)`);

    res.json({
      answer: result.answer,
      sources: result.sources,
      workspace: slug,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * Quick search — agent-friendly endpoint.
 * GET /api/rag/search?q=...&workspace=...
 */
ragRouter.get('/search', async (req: Request, res: Response) => {
  try {
    const question = req.query.q as string;
    if (!question) {
      return res.status(400).json({ error: 'q parameter is required' });
    }

    const slug = (req.query.workspace as string) || await ensureDefaultWorkspace();
    const result = await queryWorkspace(slug, question, 'query');

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      answer: result.answer,
      sources: result.sources,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
