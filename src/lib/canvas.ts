/**
 * Canvas API Client — CRUD + generate for canvas pages
 */

const API_BASE = '/api/sovereign';

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
  const res = await fetch(`${API_BASE}/canvas/pages`);
  if (!res.ok) throw new Error(`Failed to list pages: ${res.status}`);
  return res.json();
}

export async function getCanvasPage(id: string): Promise<CanvasPage> {
  const res = await fetch(`${API_BASE}/canvas/pages/${id}`);
  if (!res.ok) throw new Error(`Failed to get page: ${res.status}`);
  return res.json();
}

export async function createCanvasPage(data: {
  name: string;
  icon?: string;
  spec?: object;
  state?: object;
}): Promise<CanvasPage> {
  const res = await fetch(`${API_BASE}/canvas/pages`, {
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
  const res = await fetch(`${API_BASE}/canvas/pages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update page: ${res.status}`);
  return res.json();
}

export async function deleteCanvasPage(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/canvas/pages/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete page: ${res.status}`);
}

export async function duplicateCanvasPage(id: string, name: string): Promise<CanvasPage> {
  const res = await fetch(`${API_BASE}/canvas/pages/${id}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to duplicate page: ${res.status}`);
  return res.json();
}

// ── Data Refresh ──────────────────────────────────────────────────────

export async function refreshCanvasData(id: string): Promise<{
  data: Array<{
    sourceId: string;
    sourceName: string;
    sourceType: string;
    data: any;
    error?: string;
  }>;
  summary: string;
}> {
  const res = await fetch(`${API_BASE}/canvas/pages/${id}/refresh`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to refresh data: ${res.status}`);
  return res.json();
}

// ── Vault Status ──────────────────────────────────────────────────────

export interface VaultKeyStatus {
  id: string;
  name: string;
  category: string;
  configured: boolean;
}

export async function getVaultStatus(): Promise<VaultKeyStatus[]> {
  try {
    const res = await fetch(`${API_BASE}/settings/vault/registry`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.keys || []).map((k: any) => ({
      id: k.id,
      name: k.name,
      category: k.category,
      configured: k.configured,
    }));
  } catch {
    return [];
  }
}

// ── Streaming Generate ─────────────────────────────────────────────────

export interface IntegrationStatusEvent {
  type: 'integration_status';
  service: string;
  status: 'missing_key' | 'connected' | 'nango_available';
  message: string;
  keyId?: string;
  nangoIntegration?: string;
}

export interface GenerateCallbacks {
  onElement: (element: object) => void;
  onIntegrationStatus?: (event: IntegrationStatusEvent) => void;
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
  options?: { currentSpec?: object; pageId?: string; dataSources?: object }
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${API_BASE}/canvas/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentSpec: options?.currentSpec,
          pageId: options?.pageId,
          dataSources: options?.dataSources,
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
              } else if (element.type === 'integration_status') {
                callbacks.onIntegrationStatus?.(element as IntegrationStatusEvent);
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
