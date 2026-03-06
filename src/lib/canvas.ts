/**
 * Canvas API Client — CRUD + generate for canvas pages
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3100';

export interface CanvasPage {
  id: string;
  name: string;
  icon: string;
  spec: object | null;
  state: object | null;
  data_sources: object | null;
  created_at: string;
  updated_at: string;
}

// ── Page CRUD ──────────────────────────────────────────────────────────

export async function listCanvasPages(): Promise<CanvasPage[]> {
  const res = await fetch(`${API_BASE}/api/canvas/pages`);
  if (!res.ok) throw new Error(`Failed to list pages: ${res.status}`);
  return res.json();
}

export async function getCanvasPage(id: string): Promise<CanvasPage> {
  const res = await fetch(`${API_BASE}/api/canvas/pages/${id}`);
  if (!res.ok) throw new Error(`Failed to get page: ${res.status}`);
  return res.json();
}

export async function createCanvasPage(data: {
  name: string;
  icon?: string;
  spec?: object;
  state?: object;
}): Promise<CanvasPage> {
  const res = await fetch(`${API_BASE}/api/canvas/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create page: ${res.status}`);
  return res.json();
}

export async function updateCanvasPage(
  id: string,
  data: Partial<Pick<CanvasPage, 'name' | 'icon' | 'spec' | 'state' | 'data_sources'>>
): Promise<CanvasPage> {
  const res = await fetch(`${API_BASE}/api/canvas/pages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update page: ${res.status}`);
  return res.json();
}

export async function deleteCanvasPage(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/canvas/pages/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete page: ${res.status}`);
}

export async function duplicateCanvasPage(id: string, name: string): Promise<CanvasPage> {
  const res = await fetch(`${API_BASE}/api/canvas/pages/${id}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to duplicate page: ${res.status}`);
  return res.json();
}

// ── Streaming Generate ─────────────────────────────────────────────────

export interface GenerateCallbacks {
  onElement: (element: object) => void;
  onError?: (error: string) => void;
  onComplete?: () => void;
}

/**
 * Stream UI generation from the backend.
 * The backend streams JSONL elements via SSE.
 * Returns an abort function.
 */
export function generateCanvasUI(
  prompt: string,
  callbacks: GenerateCallbacks,
  options?: { currentSpec?: object; pageId?: string }
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/canvas/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentSpec: options?.currentSpec,
          pageId: options?.pageId,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        callbacks.onError?.(`Generate failed: ${res.status}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError?.('No response body');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // SSE format: "data: ..."
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              callbacks.onComplete?.();
              return;
            }
            try {
              const element = JSON.parse(data);
              if (element.error) {
                callbacks.onError?.(element.error);
              } else {
                callbacks.onElement(element);
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      callbacks.onComplete?.();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        callbacks.onError?.(err.message);
      }
    }
  })();

  return () => controller.abort();
}
