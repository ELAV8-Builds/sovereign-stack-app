import { Router, Request, Response } from 'express';
import { logActivity } from '../services/activity-broadcaster';

export const servicesRouter = Router();

interface ServiceInfo {
  name: string;
  port: number | null;
  status: 'running' | 'stopped' | 'unknown';
  runtime: string;
  healthUrl?: string;
}

const SERVICE_DEFS: { name: string; port: number | null; runtime: string; healthUrl?: string; internalUrl?: string }[] = [
  { name: 'NanoClaw', port: null, runtime: 'Node.js', internalUrl: 'http://localhost:18789' },
  { name: 'LiteLLM', port: 4000, runtime: 'Python', healthUrl: 'http://localhost:4000/health/liveliness' },
  { name: 'Ollama', port: 11434, runtime: 'Native Binary', healthUrl: 'http://localhost:11434' },
  { name: 'memU', port: 8090, runtime: 'Node.js', healthUrl: 'http://localhost:8090/health' },
  { name: 'PostgreSQL', port: 5432, runtime: 'Docker' },
  { name: 'Redis', port: 6379, runtime: 'Docker' },
  { name: 'AnythingLLM', port: 3001, runtime: 'Docker', healthUrl: 'http://localhost:3001/api/v1/auth' },
];

async function checkServiceHealth(svc: typeof SERVICE_DEFS[0]): Promise<'running' | 'stopped'> {
  const url = svc.healthUrl || svc.internalUrl;
  if (!url) {
    // For services without health URLs, try TCP connect via fetch
    if (svc.port) {
      try {
        const host = svc.name.toLowerCase().replace(/\s/g, '');
        await fetch(`http://${host}:${svc.port}`, { signal: AbortSignal.timeout(2000) });
        return 'running';
      } catch (e: any) {
        // ECONNREFUSED means stopped, other errors (like bad response) mean running
        if (e?.cause?.code === 'ECONNREFUSED' || e?.name === 'AbortError') return 'stopped';
        return 'running'; // Got a response (even error = running)
      }
    }
    return 'unknown' as any;
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status !== 0 ? 'running' : 'stopped';
  } catch {
    return 'stopped';
  }
}

// Get all service statuses
servicesRouter.get('/', async (_req: Request, res: Response) => {
  logActivity('api', 'info', 'Checking service health...');

  const results: ServiceInfo[] = await Promise.all(
    SERVICE_DEFS.map(async (svc) => ({
      name: svc.name,
      port: svc.port,
      status: await checkServiceHealth(svc),
      runtime: svc.runtime,
    }))
  );

  const running = results.filter(s => s.status === 'running').length;
  logActivity('api', 'success', `Health check complete: ${running}/${results.length} running`);

  res.json({ services: results });
});

// Get single service status
servicesRouter.get('/:name', async (req: Request, res: Response) => {
  const paramName = String(req.params.name).toLowerCase();
  const svc = SERVICE_DEFS.find(s => s.name.toLowerCase() === paramName);
  if (!svc) {
    return res.status(404).json({ error: 'Service not found' });
  }

  res.json({
    name: svc.name,
    port: svc.port,
    status: await checkServiceHealth(svc),
    runtime: svc.runtime,
  });
});

// Note: In Docker Compose, services are managed by Docker, not launchctl.
// Start/stop/restart are exposed but may require Docker socket access.
servicesRouter.post('/:name/restart', async (req: Request, res: Response) => {
  const name = String(req.params.name).toLowerCase();
  logActivity('api', 'info', `Restart requested for ${name}`);

  // In Docker Compose, we'd need Docker socket access to restart containers.
  // For now, return a helpful message.
  res.json({
    message: `Service restart for ${name} — use 'docker compose restart ${name}' from the host`,
    note: 'Container-level restart requires Docker socket access (planned feature)',
  });
});

// Get service logs (via Docker)
servicesRouter.get('/:name/logs', async (req: Request, res: Response) => {
  const name = String(req.params.name).toLowerCase();
  const lines = Math.min(parseInt(req.query.lines as string) || 100, 500);

  // In a Docker setup, logs come from Docker. For now, return recent activity.
  try {
    const { query: dbQuery } = await import('../services/database');
    const result = await dbQuery(
      'SELECT agent, level, message, created_at FROM agent_activity WHERE LOWER(agent) = $1 ORDER BY created_at DESC LIMIT $2',
      [name, lines]
    );
    res.json({ logs: result.rows.reverse() });
  } catch {
    res.json({ logs: [], note: 'Database not available, logs from Docker: docker compose logs ' + name });
  }
});
