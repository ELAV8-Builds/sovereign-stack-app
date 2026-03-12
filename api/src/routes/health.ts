import { Router, Request, Response } from 'express';
import { checkLiteLLMHealth } from '../services/litellm';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const checks = {
    api: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  res.json({ status: 'ok', ...checks });
});

healthRouter.get('/full', async (_req: Request, res: Response) => {
  const services: Record<string, boolean> = {};

  // Check LiteLLM
  services.litellm = await checkLiteLLMHealth();

  // Check Ollama
  try {
    const r = await fetch(process.env.OLLAMA_URL || 'http://localhost:11434', { signal: AbortSignal.timeout(3000) });
    services.ollama = r.ok;
  } catch { services.ollama = false; }

  // Check memU
  try {
    const r = await fetch(`${process.env.MEMU_URL || 'http://localhost:8090'}/health`, { signal: AbortSignal.timeout(3000) });
    services.memu = r.ok;
  } catch { services.memu = false; }

  // Check AnythingLLM
  try {
    const r = await fetch(`${process.env.ANYTHINGLLM_URL || 'http://localhost:3001'}/api/v1/auth`, { signal: AbortSignal.timeout(3000) });
    services.anythingllm = r.status !== 0;
  } catch { services.anythingllm = false; }

  const allHealthy = Object.values(services).every(Boolean);

  res.status(allHealthy ? 200 : 207).json({
    status: allHealthy ? 'healthy' : 'degraded',
    services,
    timestamp: new Date().toISOString(),
  });
});
