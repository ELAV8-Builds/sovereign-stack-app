/**
 * Overmind Routes — Shared Helpers
 */
import { Response } from 'express';

export function badRequest(res: Response, msg: string) {
  return res.status(400).json({ error: msg });
}

export function notFound(res: Response, entity: string) {
  return res.status(404).json({ error: `${entity} not found` });
}
