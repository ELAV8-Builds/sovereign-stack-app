import { createClient, RedisClientType } from 'redis';

let client: RedisClientType | null = null;

export async function initRedis(): Promise<void> {
  client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  client.on('error', (err) => {
    console.error('Redis error:', err.message);
  });

  await client.connect();
}

export function getRedis(): RedisClientType {
  if (!client) throw new Error('Redis not initialized');
  return client;
}

// Convenience: cache with TTL
export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await getRedis().get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds = 300): Promise<void> {
  try {
    await getRedis().setEx(key, ttlSeconds, value);
  } catch {
    // Fail silently in degraded mode
  }
}
