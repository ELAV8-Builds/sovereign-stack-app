/**
 * Fleet Agent — Docker Container Manager
 *
 * Manages local Docker containers for task execution.
 * Uses the Docker Engine API via unix socket.
 *
 * NOTE: This is a scaffold. Full Docker integration will be wired
 * in when the actual worker container image is ready.
 */

import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  created_at: Date;
  ports: string[];
}

interface SpawnContainerOptions {
  name: string;
  image: string;
  env?: Record<string, string>;
  volumes?: string[];
  ports?: string[];
  command?: string[];
  memory_limit?: string;
}

// ---------------------------------------------------------------------------
// Docker Operations
// ---------------------------------------------------------------------------

/**
 * Check if Docker is available and running.
 */
export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * List running containers managed by this Fleet Agent.
 */
export function listContainers(): ContainerInfo[] {
  try {
    const output = execSync(
      'docker ps --filter "label=managed-by=fleet-agent" --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.CreatedAt}}|{{.Ports}}"',
      { encoding: 'utf-8', timeout: 5000 }
    );

    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [id, name, image, status, created, ports] = line.split('|');
        return {
          id: id || '',
          name: name || '',
          image: image || '',
          status: status || '',
          created_at: new Date(created || Date.now()),
          ports: (ports || '').split(',').filter(Boolean),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Spawn a new Docker container for task execution.
 */
export function spawnContainer(options: SpawnContainerOptions): string | null {
  const args = [
    'run', '-d',
    '--name', options.name,
    '--label', 'managed-by=fleet-agent',
  ];

  if (options.memory_limit) {
    args.push('--memory', options.memory_limit);
  }

  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push('-e', `${key}=${value}`);
    }
  }

  if (options.volumes) {
    for (const vol of options.volumes) {
      args.push('-v', vol);
    }
  }

  if (options.ports) {
    for (const port of options.ports) {
      args.push('-p', port);
    }
  }

  args.push(options.image);

  if (options.command) {
    args.push(...options.command);
  }

  try {
    const containerId = execSync(`docker ${args.join(' ')}`, {
      encoding: 'utf-8',
      timeout: 30000,
    }).trim();
    console.log(`[docker] Spawned container: ${options.name} (${containerId.slice(0, 12)})`);
    return containerId;
  } catch (err) {
    console.error(`[docker] Failed to spawn container ${options.name}:`, err);
    return null;
  }
}

/**
 * Stop and remove a container.
 */
export function killContainer(nameOrId: string): boolean {
  try {
    execSync(`docker stop ${nameOrId} && docker rm ${nameOrId}`, {
      stdio: 'pipe',
      timeout: 15000,
    });
    console.log(`[docker] Killed container: ${nameOrId}`);
    return true;
  } catch {
    // Try force remove
    try {
      execSync(`docker rm -f ${nameOrId}`, { stdio: 'pipe', timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get container logs.
 */
export function getContainerLogs(nameOrId: string, tail: number = 100): string {
  try {
    return execSync(`docker logs --tail ${tail} ${nameOrId}`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch {
    return '';
  }
}

/**
 * Clean up all fleet-agent managed containers.
 */
export function cleanupAllContainers(): number {
  const containers = listContainers();
  let cleaned = 0;

  for (const container of containers) {
    if (killContainer(container.id)) cleaned++;
  }

  if (cleaned > 0) {
    console.log(`[docker] Cleaned up ${cleaned} container(s)`);
  }

  return cleaned;
}
