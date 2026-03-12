/**
 * Canvas Service — Persistent visual pages powered by json-render
 *
 * Stores canvas pages (AI-generated JSON specs) in PostgreSQL.
 * Each page has a name, icon, spec (the json-render UI tree), and optional
 * data sources for live data binding.
 */
import { query } from './database';

export interface CanvasPage {
  id: string;
  name: string;
  icon: string;
  spec: object | null;
  state: object | null;       // Runtime state for data-bound components
  data_sources: object | null; // Data connector configs (URLs, polling intervals)
  created_at: string;
  updated_at: string;
}

export interface CreatePageInput {
  name: string;
  icon?: string;
  spec?: object;
  state?: object;
  data_sources?: object;
}

export interface UpdatePageInput {
  name?: string;
  icon?: string;
  spec?: object;
  state?: object;
  data_sources?: object;
}

// ── Database schema migration ──────────────────────────────────────────

export async function initCanvasSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS canvas_pages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📊',
      spec JSONB,
      state JSONB,
      data_sources JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_canvas_pages_updated
    ON canvas_pages (updated_at DESC)
  `);
}

// ── CRUD Operations ────────────────────────────────────────────────────

export async function listPages(): Promise<CanvasPage[]> {
  const result = await query(
    'SELECT * FROM canvas_pages ORDER BY updated_at DESC'
  );
  return result.rows;
}

export async function getPage(id: string): Promise<CanvasPage | null> {
  const result = await query(
    'SELECT * FROM canvas_pages WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function createPage(input: CreatePageInput): Promise<CanvasPage> {
  const result = await query(
    `INSERT INTO canvas_pages (name, icon, spec, state, data_sources)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.name,
      input.icon || '📊',
      input.spec ? JSON.stringify(input.spec) : null,
      input.state ? JSON.stringify(input.state) : null,
      input.data_sources ? JSON.stringify(input.data_sources) : null,
    ]
  );
  return result.rows[0];
}

export async function updatePage(id: string, input: UpdatePageInput): Promise<CanvasPage | null> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(input.name);
  }
  if (input.icon !== undefined) {
    sets.push(`icon = $${idx++}`);
    values.push(input.icon);
  }
  if (input.spec !== undefined) {
    sets.push(`spec = $${idx++}`);
    values.push(JSON.stringify(input.spec));
  }
  if (input.state !== undefined) {
    sets.push(`state = $${idx++}`);
    values.push(JSON.stringify(input.state));
  }
  if (input.data_sources !== undefined) {
    sets.push(`data_sources = $${idx++}`);
    values.push(JSON.stringify(input.data_sources));
  }

  if (sets.length === 0) return getPage(id);

  sets.push(`updated_at = NOW()`);
  values.push(id);

  const result = await query(
    `UPDATE canvas_pages SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function deletePage(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM canvas_pages WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function duplicatePage(id: string, newName: string): Promise<CanvasPage | null> {
  const source = await getPage(id);
  if (!source) return null;

  return createPage({
    name: newName,
    icon: source.icon,
    spec: source.spec || undefined,
    state: source.state || undefined,
    data_sources: source.data_sources || undefined,
  });
}
