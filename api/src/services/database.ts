import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

export async function initDatabase(): Promise<void> {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://sovereign:sovereign@localhost:5432/sovereign',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Test connection
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

export async function query(text: string, params?: any[]) {
  const p = getPool();
  return p.query(text, params);
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
