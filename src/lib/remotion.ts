/**
 * Remotion API Client — Motion Graphics / Video Generation
 *
 * Communicates with /api/sovereign/remotion/* endpoints.
 * Provides:
 * - Project management (create, list, get)
 * - Render job management (start, poll status)
 * - Remotion health/status checking
 */

const API_BASE = '/api/sovereign/remotion';

// ── Types ────────────────────────────────────────────────

export interface RemotionProject {
  id: string;
  name: string;
  path: string;
  compositions: string[];
  created_at: string;
}

export interface RenderJob {
  id: string;
  project_id: string;
  composition: string;
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  output_path: string | null;
  progress: number;
  error: string | null;
  props: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface RemotionStatus {
  available: boolean;
  version?: string;
}

// ── Projects ─────────────────────────────────────────────

/**
 * List all Remotion projects.
 */
export async function listRemotionProjects(): Promise<RemotionProject[]> {
  try {
    const res = await fetch(`${API_BASE}/projects`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Failed (${res.status})`);
    const data = await res.json();
    return data.projects || [];
  } catch {
    return [];
  }
}

/**
 * Create a new Remotion project.
 */
export async function createRemotionProject(
  name: string,
  template?: string
): Promise<RemotionProject> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, template }),
    signal: AbortSignal.timeout(120000), // npm install can take a while
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Project creation failed' }));
    throw new Error(err.error || `Project creation failed (${res.status})`);
  }

  return res.json();
}

/**
 * Get a single project by ID.
 */
export async function getRemotionProject(id: string): Promise<RemotionProject | null> {
  try {
    const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed (${res.status})`);
    return res.json();
  } catch {
    return null;
  }
}

// ── Render Jobs ──────────────────────────────────────────

/**
 * Start a render job for a project composition.
 */
export async function startRender(
  projectId: string,
  composition: string,
  props?: Record<string, unknown>,
  outputFormat?: string
): Promise<RenderJob> {
  const res = await fetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/render`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ composition, props, outputFormat }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Render start failed' }));
    throw new Error(err.error || `Render start failed (${res.status})`);
  }

  return res.json();
}

/**
 * Get the status of a render job.
 */
export async function getRenderJob(jobId: string): Promise<RenderJob | null> {
  try {
    const res = await fetch(
      `${API_BASE}/render-jobs/${encodeURIComponent(jobId)}`,
      {
        signal: AbortSignal.timeout(10000),
      }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed (${res.status})`);
    return res.json();
  } catch {
    return null;
  }
}

/**
 * List all render jobs for a project.
 */
export async function listRenderJobs(projectId: string): Promise<RenderJob[]> {
  try {
    const res = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/render-jobs`,
      {
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) throw new Error(`Failed (${res.status})`);
    const data = await res.json();
    return data.jobs || [];
  } catch {
    return [];
  }
}

// ── Status ───────────────────────────────────────────────

/**
 * Check whether Remotion is available and get its version.
 */
export async function getRemotionStatus(): Promise<RemotionStatus> {
  try {
    const res = await fetch(`${API_BASE}/status`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  } catch {
    return { available: false };
  }
}

// ── Polling Helper ───────────────────────────────────────

/**
 * Poll a render job until it reaches a terminal state (completed or failed).
 * Returns the final job state.
 *
 * @param jobId - The render job ID to poll
 * @param onProgress - Optional callback called on each poll with the current job state
 * @param intervalMs - Polling interval in milliseconds (default: 2000)
 * @param timeoutMs - Maximum time to wait (default: 600000 = 10 minutes)
 */
export async function pollRenderJob(
  jobId: string,
  onProgress?: (job: RenderJob) => void,
  intervalMs = 2000,
  timeoutMs = 600000
): Promise<RenderJob> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await getRenderJob(jobId);
    if (!job) {
      throw new Error(`Render job not found: ${jobId}`);
    }

    if (onProgress) {
      onProgress(job);
    }

    if (job.status === 'completed' || job.status === 'failed') {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Render job ${jobId} timed out after ${timeoutMs / 1000}s`);
}
