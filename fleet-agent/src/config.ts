/**
 * Fleet Agent Configuration
 *
 * Validates all required environment variables on startup.
 * Fails fast if anything is missing — don't start with bad config.
 */

export interface FleetAgentConfig {
  /** Central Overmind API URL (e.g., http://192.168.1.60:3100) */
  overmindUrl: string;
  /** Unique fleet name (e.g., "mac-mini") */
  fleetName: string;
  /** Human-readable machine name */
  machineName: string;
  /** API key for authenticating with Overmind */
  apiKey: string;
  /** HMAC shared secret for request signing */
  hmacSecret: string;
  /** Port to listen on */
  port: number;
  /** Network region */
  region: string;
  /** Maximum concurrent workers */
  maxWorkers: number;
  /** Machine capabilities */
  capabilities: string[];
  /** Optional TLS cert path */
  tlsCert?: string;
  /** Optional TLS key path */
  tlsKey?: string;
  /** Docker socket path */
  dockerSocket: string;
}

export function loadConfig(): FleetAgentConfig {
  const required = (key: string, label: string): string => {
    const val = process.env[key];
    if (!val || val.trim() === '') {
      console.error(`[config] FATAL: ${label} (${key}) is required but not set`);
      process.exit(1);
    }
    return val.trim();
  };

  const optional = (key: string, fallback: string): string => {
    return (process.env[key] || '').trim() || fallback;
  };

  const config: FleetAgentConfig = {
    overmindUrl: required('OVERMIND_URL', 'Overmind API URL'),
    fleetName: required('FLEET_NAME', 'Fleet name'),
    machineName: required('MACHINE_NAME', 'Machine name'),
    apiKey: required('FLEET_API_KEY', 'Fleet API key'),
    hmacSecret: required('FLEET_HMAC_SECRET', 'HMAC shared secret'),
    port: parseInt(optional('PORT', '3300'), 10),
    region: optional('REGION', 'home-lan'),
    maxWorkers: parseInt(optional('MAX_WORKERS', '3'), 10),
    capabilities: optional('CAPABILITIES', 'docker,node,git')
      .split(',')
      .map(c => c.trim())
      .filter(Boolean),
    tlsCert: process.env.TLS_CERT || undefined,
    tlsKey: process.env.TLS_KEY || undefined,
    dockerSocket: optional('DOCKER_SOCKET', '/var/run/docker.sock'),
  };

  // Validate API key format
  if (!config.apiKey.startsWith('flk_')) {
    console.error('[config] FATAL: FLEET_API_KEY must start with "flk_"');
    process.exit(1);
  }

  // Validate HMAC secret format
  if (!config.hmacSecret.startsWith('hms_')) {
    console.error('[config] FATAL: FLEET_HMAC_SECRET must start with "hms_"');
    process.exit(1);
  }

  // Validate Overmind URL
  try {
    new URL(config.overmindUrl);
  } catch {
    console.error(`[config] FATAL: Invalid OVERMIND_URL: ${config.overmindUrl}`);
    process.exit(1);
  }

  return config;
}
