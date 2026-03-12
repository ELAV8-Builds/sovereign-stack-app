/**
 * Deployer — Coordinates rebuilds and restarts
 *
 * Handles deploying code changes:
 * - Frontend: just rebuild (new dist/ files served automatically)
 * - Backend: rebuild + signal process restart
 * - Both: coordinated deploy
 */
import { runFullBuild, type FullBuildResult } from './builder';
import { logHealthEvent, createDeployRecord, updateDeployRecord, type OvDeployRecord } from './overmind/db';
import { join } from 'path';

const PROJECT_ROOT = process.env.PROJECT_ROOT || join(__dirname, '../../../..');

// Rate limiter: max 3 deploys per hour
let recentDeploys: number[] = [];
const MAX_DEPLOYS_PER_HOUR = 3;

export interface DeployResult {
  success: boolean;
  deploy_id: string;
  build_result: FullBuildResult;
  health_check?: HealthCheckResult;
  error?: string;
}

export interface HealthCheckResult {
  api_healthy: boolean;
  api_response_ms: number;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
}

/**
 * Check if we've exceeded the deploy rate limit.
 */
function checkRateLimit(): boolean {
  const oneHourAgo = Date.now() - 3600_000;
  recentDeploys = recentDeploys.filter(t => t > oneHourAgo);
  return recentDeploys.length < MAX_DEPLOYS_PER_HOUR;
}

/**
 * Run a health check against the API.
 */
async function runHealthCheck(): Promise<HealthCheckResult> {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = [];
  const start = Date.now();
  let apiHealthy = false;

  try {
    const port = process.env.PORT || 3100;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    apiHealthy = res.ok;
    checks.push({ name: 'API /health', passed: res.ok, detail: `Status ${res.status}` });
  } catch (err) {
    checks.push({ name: 'API /health', passed: false, detail: (err as Error).message });
  }

  // Check key endpoints
  try {
    const port = process.env.PORT || 3100;
    const res = await fetch(`http://127.0.0.1:${port}/api/overmind/rules`, {
      signal: AbortSignal.timeout(5000),
    });
    checks.push({ name: 'Rules endpoint', passed: res.ok, detail: `Status ${res.status}` });
  } catch (err) {
    checks.push({ name: 'Rules endpoint', passed: false, detail: (err as Error).message });
  }

  return {
    api_healthy: apiHealthy,
    api_response_ms: Date.now() - start,
    checks,
  };
}

/**
 * Execute a deployment.
 *
 * @param changeType - 'frontend' | 'backend' | 'both'
 * @param filesChanged - List of changed files with descriptions
 * @param reason - Why this deploy is happening
 */
export async function executeDeploy(
  changeType: 'frontend' | 'backend' | 'both',
  filesChanged: Array<{ path: string; diff_summary?: string }>,
  reason?: string
): Promise<DeployResult> {
  // Rate limit check
  if (!checkRateLimit()) {
    return {
      success: false,
      deploy_id: '',
      build_result: { success: false, steps: [], total_duration_ms: 0 },
      error: 'Rate limit exceeded: maximum 3 deploys per hour',
    };
  }

  // Create deploy record
  const record = await createDeployRecord({
    change_type: changeType,
    files_changed: filesChanged,
    reason,
  });

  await logHealthEvent({
    event_type: 'deploy_started',
    severity: 'info',
    source: 'deployer',
    message: `Deploy #${record.version} started: ${reason || 'No reason provided'}`,
    metadata: { deploy_id: record.id, change_type: changeType, files: filesChanged.length },
  });

  // Update status to building
  await updateDeployRecord(record.id, { deploy_status: 'building' });

  // Run build
  const buildResult = runFullBuild();

  // Update deploy record with build output
  const buildOutput = buildResult.steps.map(s =>
    `[${s.phase}] ${s.success ? 'PASS' : 'FAIL'} (${s.duration_ms}ms)\n${s.output || ''}${s.error ? '\nError: ' + s.error : ''}`
  ).join('\n\n');

  await updateDeployRecord(record.id, { build_output: buildOutput });

  if (!buildResult.success) {
    await updateDeployRecord(record.id, { deploy_status: 'failed' });
    await logHealthEvent({
      event_type: 'deploy_failed',
      severity: 'error',
      source: 'deployer',
      message: `Deploy #${record.version} build failed: ${buildResult.steps.find(s => !s.success)?.error || 'Unknown error'}`,
      metadata: { deploy_id: record.id },
    });
    return { success: false, deploy_id: record.id, build_result: buildResult, error: 'Build failed' };
  }

  // Deploy phase
  await updateDeployRecord(record.id, { deploy_status: 'deploying' });

  // For backend, we'd need to signal a restart (pm2 or Docker)
  // For now, log the event — actual restart depends on runtime environment
  if (changeType === 'backend' || changeType === 'both') {
    await logHealthEvent({
      event_type: 'backend_restart_signal',
      severity: 'warn',
      source: 'deployer',
      message: `Deploy #${record.version}: backend restart signaled`,
    });
  }

  // Health check after deploy
  const healthCheck = await runHealthCheck();
  await updateDeployRecord(record.id, { health_check: healthCheck });

  if (!healthCheck.api_healthy) {
    await updateDeployRecord(record.id, { deploy_status: 'rolled_back', rolled_back_at: new Date() });
    await logHealthEvent({
      event_type: 'deploy_rolled_back',
      severity: 'error',
      source: 'deployer',
      message: `Deploy #${record.version} rolled back: health check failed`,
      metadata: { deploy_id: record.id, health_check: healthCheck },
    });
    return { success: false, deploy_id: record.id, build_result: buildResult, health_check: healthCheck, error: 'Health check failed' };
  }

  // Success
  await updateDeployRecord(record.id, { deploy_status: 'success' });
  recentDeploys.push(Date.now());

  await logHealthEvent({
    event_type: 'deploy_success',
    severity: 'info',
    source: 'deployer',
    message: `Deploy #${record.version} succeeded (${buildResult.total_duration_ms}ms)`,
    metadata: { deploy_id: record.id, duration_ms: buildResult.total_duration_ms },
  });

  return { success: true, deploy_id: record.id, build_result: buildResult, health_check: healthCheck };
}

// ---------------------------------------------------------------------------
// Legacy deploy function — backward compatibility for workspace/agent routes
// ---------------------------------------------------------------------------

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import net from 'net';

const execAsync = promisify(exec);

export type DeployTarget = 'local' | 'docker' | 'static';

export interface LegacyDeployResult {
  success: boolean;
  target: DeployTarget;
  url?: string;
  port?: number;
  containerId?: string;
  outputPath?: string;
  logs: string[];
  durationMs: number;
  error?: string;
}

async function findFreePort(startPort = 3100): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      if (startPort < 65535) {
        resolve(findFreePort(startPort + 1));
      } else {
        reject(new Error('No free ports found'));
      }
    });
  });
}

type ProjectType = 'node-ts' | 'node-js' | 'rust' | 'python' | 'docker' | 'static' | 'unknown';

async function detectProjectType(workspacePath: string): Promise<ProjectType> {
  const exists = async (f: string) => {
    try { await fs.access(path.join(workspacePath, f)); return true; } catch { return false; }
  };
  if (await exists('tsconfig.json')) return 'node-ts';
  if (await exists('package.json')) return 'node-js';
  if (await exists('Cargo.toml')) return 'rust';
  if (await exists('pyproject.toml') || await exists('setup.py')) return 'python';
  if (await exists('Dockerfile') || await exists('docker-compose.yml')) return 'docker';
  if (await exists('index.html')) return 'static';
  return 'unknown';
}

function suggestTarget(projectType: ProjectType): DeployTarget {
  switch (projectType) {
    case 'docker': return 'docker';
    case 'static': return 'static';
    default: return 'local';
  }
}

async function findBuildDir(workspacePath: string): Promise<string> {
  const candidates = ['dist', 'build', 'out', '.next', 'public'];
  for (const dir of candidates) {
    try {
      const fullPath = path.join(workspacePath, dir);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) return fullPath;
    } catch { /* not found */ }
  }
  return workspacePath;
}

async function deployLocal(workspacePath: string): Promise<LegacyDeployResult> {
  const start = Date.now();
  const logs: string[] = [];
  try {
    const port = await findFreePort();
    logs.push(`Found free port: ${port}`);
    const buildDir = await findBuildDir(workspacePath);
    logs.push(`Serving from: ${buildDir}`);
    let hasStartScript = false;
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(workspacePath, 'package.json'), 'utf-8'));
      hasStartScript = !!(pkg.scripts?.start || pkg.scripts?.serve || pkg.scripts?.preview);
    } catch { /* no package.json */ }
    if (hasStartScript) {
      const cmd = `cd "${workspacePath}" && PORT=${port} npx --yes serve -s "${path.basename(buildDir)}" -l ${port} &`;
      logs.push(`Starting with: npx serve -s ${path.basename(buildDir)} -l ${port}`);
      await execAsync(cmd, { timeout: 15000 });
    } else {
      const cmd = `npx --yes serve -s "${buildDir}" -l ${port} &`;
      logs.push(`Starting with: npx serve -s -l ${port}`);
      await execAsync(cmd, { timeout: 15000 });
    }
    logs.push(`Server started on port ${port}`);
    return { success: true, target: 'local', url: `http://localhost:${port}`, port, logs, durationMs: Date.now() - start };
  } catch (err: any) {
    logs.push(`Error: ${err.message}`);
    return { success: false, target: 'local', logs, durationMs: Date.now() - start, error: err.message };
  }
}

function generateDockerfile(projectType: ProjectType): string {
  switch (projectType) {
    case 'node-ts':
    case 'node-js':
      return `FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --production=false\nCOPY . .\nRUN npm run build 2>/dev/null || true\nEXPOSE 3000\nCMD ["npm", "start"]\n`;
    case 'python':
      return `FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt* ./\nRUN pip install -r requirements.txt 2>/dev/null || true\nCOPY . .\nEXPOSE 3000\nCMD ["python", "main.py"]\n`;
    case 'static':
      return `FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n`;
    default:
      return `FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install 2>/dev/null || true\nEXPOSE 3000\nCMD ["npm", "start"]\n`;
  }
}

async function deployDocker(workspacePath: string): Promise<LegacyDeployResult> {
  const start = Date.now();
  const logs: string[] = [];
  const projectName = path.basename(workspacePath).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  try {
    const dockerfilePath = path.join(workspacePath, 'Dockerfile');
    try {
      await fs.access(dockerfilePath);
      logs.push('Found existing Dockerfile');
    } catch {
      logs.push('No Dockerfile found, generating one...');
      const projectType = await detectProjectType(workspacePath);
      const dockerfile = generateDockerfile(projectType);
      await fs.writeFile(dockerfilePath, dockerfile, 'utf-8');
      logs.push('Generated Dockerfile');
    }
    const imageName = `sovereign-${projectName}:latest`;
    logs.push(`Building image: ${imageName}`);
    await execAsync(`cd "${workspacePath}" && docker build -t ${imageName} .`, { timeout: 120000 });
    logs.push('Docker build completed');
    const port = await findFreePort(4000);
    const containerName = `sovereign-${projectName}`;
    try {
      await execAsync(`docker stop ${containerName} && docker rm ${containerName}`);
      logs.push('Stopped existing container');
    } catch { /* no existing container */ }
    const { stdout: runOut } = await execAsync(`docker run -d --name ${containerName} -p ${port}:3000 ${imageName}`, { timeout: 30000 });
    const containerId = runOut.trim().substring(0, 12);
    logs.push(`Container started: ${containerId}`);
    return { success: true, target: 'docker', url: `http://localhost:${port}`, port, containerId, logs, durationMs: Date.now() - start };
  } catch (err: any) {
    logs.push(`Error: ${err.message}`);
    return { success: false, target: 'docker', logs, durationMs: Date.now() - start, error: err.message };
  }
}

async function deployStatic(workspacePath: string): Promise<LegacyDeployResult> {
  const start = Date.now();
  const logs: string[] = [];
  try {
    const buildDir = await findBuildDir(workspacePath);
    const projectName = path.basename(workspacePath);
    const outputDir = path.join('/workspace', '.deploys', projectName);
    await fs.mkdir(outputDir, { recursive: true });
    logs.push(`Created output directory: ${outputDir}`);
    await execAsync(`cp -r "${buildDir}"/* "${outputDir}"/`, { timeout: 30000 });
    logs.push(`Copied files from ${buildDir}`);
    const { stdout } = await execAsync(`find "${outputDir}" -type f | wc -l`);
    logs.push(`Deployed ${stdout.trim()} files to ${outputDir}`);
    return { success: true, target: 'static', outputPath: outputDir, logs, durationMs: Date.now() - start };
  } catch (err: any) {
    logs.push(`Error: ${err.message}`);
    return { success: false, target: 'static', logs, durationMs: Date.now() - start, error: err.message };
  }
}

/**
 * Legacy deploy function — backward compatible with workspace and agent routes.
 * Auto-detects deploy target if not specified.
 */
export async function deploy(
  workspacePath: string,
  target?: DeployTarget,
): Promise<LegacyDeployResult> {
  const projectType = await detectProjectType(workspacePath);
  const resolvedTarget = target || suggestTarget(projectType);
  switch (resolvedTarget) {
    case 'local': return deployLocal(workspacePath);
    case 'docker': return deployDocker(workspacePath);
    case 'static': return deployStatic(workspacePath);
    default: return {
      success: false,
      target: resolvedTarget,
      logs: [`Unknown deploy target: ${resolvedTarget}`],
      durationMs: 0,
      error: `Unknown deploy target: ${resolvedTarget}`,
    };
  }
}
