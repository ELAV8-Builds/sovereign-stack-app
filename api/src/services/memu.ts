/**
 * memU Service — Semantic Long-Term Memory
 *
 * Wraps the memU REST API for:
 * - Storing memories (memorize)
 * - Retrieving memories by semantic similarity (retrieve)
 * - Health checks
 *
 * memU provides persistent semantic memory across conversations.
 * Memories are stored as embeddings and retrieved by similarity.
 */
import { logActivity } from './activity-broadcaster';

// ── Configuration ────────────────────────────────────────

const MEMU_URL = process.env.MEMU_URL || 'http://localhost:8090';

// ── Types ────────────────────────────────────────────────

export interface MemuMemory {
  content: string;
  text?: string;
  similarity?: number;
  score?: number;
  created_at?: string;
  timestamp?: string;
}

export interface MemuRetrieveResult {
  content: string;
  similarity: number | null;
  timestamp: string | null;
}

// ── Health Check ─────────────────────────────────────────

export async function checkMemuHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${MEMU_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.status > 0 && response.status < 500;
  } catch {
    return false;
  }
}

// ── Retrieve Memories ────────────────────────────────────

/**
 * Search semantic memory for relevant context.
 * Returns memories ranked by similarity to the query.
 */
export async function memuRetrieve(
  queryText: string,
  limit: number = 5
): Promise<MemuRetrieveResult[]> {
  try {
    const response = await fetch(`${MEMU_URL}/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryText, n_results: limit }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`memU retrieve failed (${response.status}): ${text}`);
    }

    const data = await response.json() as any;

    // memU returns various formats — normalize them
    const memories = data.results || data.memories || data.documents || [];

    if (Array.isArray(memories)) {
      return memories.map((m: any) => ({
        content: m.content || m.text || m.document || (typeof m === 'string' ? m : JSON.stringify(m)),
        similarity: m.similarity || m.score || m.distance || null,
        timestamp: m.created_at || m.timestamp || null,
      }));
    }

    // Handle case where memU returns { documents: [[...]], metadatas: [[...]], distances: [[...]] }
    if (data.documents && Array.isArray(data.documents[0])) {
      const docs = data.documents[0];
      const distances = data.distances?.[0] || [];
      const metadatas = data.metadatas?.[0] || [];

      return docs.map((doc: string, i: number) => ({
        content: doc,
        similarity: distances[i] ? 1 - distances[i] : null, // Convert distance to similarity
        timestamp: metadatas[i]?.created_at || null,
      }));
    }

    return [];
  } catch (err) {
    logActivity('memory', 'warning', `memU retrieve failed: ${(err as Error).message}`);
    throw err;
  }
}

// ── Memorize ─────────────────────────────────────────────

/**
 * Store content in semantic memory.
 * Content is embedded and persisted for future retrieval.
 */
export async function memuMemorize(content: string): Promise<void> {
  try {
    const response = await fetch(`${MEMU_URL}/memorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [
          {
            role: 'assistant',
            content: { text: content },
            created_at: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`memU memorize failed (${response.status}): ${text}`);
    }

    logActivity('memory', 'success', `Memory saved (${content.length} chars)`);
  } catch (err) {
    logActivity('memory', 'warning', `memU memorize failed: ${(err as Error).message}`);
    throw err;
  }
}
