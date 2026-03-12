/**
 * Deployer — Multi-target deployment engine
 *
 * Supports three deployment targets:
 * - local: Serve built files on a free port using npx serve or node
 * - docker: Build a Docker image and run a container
 * - static: Copy dist/ to a served directory
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import net from 'net';

const execAsync = promisify(exec);

// ── Types ────────────────────────────────────────────────────

export type DeployTarget = 'local' | 'docker' | 'static';

export interface DeployResult {
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

// ── Port Discovery ──────────────────────────────────────────

async function findFreePort(startPort = 3100): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // Port in use, try next
      if (startPort < 65535) {
        resolve(findFreePort(startPort + 1));
      } else {
        reject(new Error('No free ports found'));
      }
    });
  });
}

// ── Project Type Detection (reuse pattern from build-validator) ──

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

// Auto-detect best target
function suggestTarget(projectType: ProjectType): DeployTarget {
  switch (projectType) {
    case 'docker': return 'docker';
    case 'static': return 'static';
    default: return 'local';
  }
}

// ── Find build output directory ─────────────────────────────

async function findBuildDir(workspacePath: string): Promise<string> {
  // Check common build output directories
  const candidates = ['dist', 'build', 'out', '.next', 'public'];
  for (const dir of candidates) {
    try {
      const fullPath = path.join(workspacePath, dir);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) return fullPath;
    } catch { /* not found */ }
  }
  // Fallback to workspace root
  return workspacePath;
}

// ── Deploy: Local ───────────────────────────────────────────

async function deployLocal(workspacePath: string): Promise<DeployResult> {
  const start = Date.now();
  const logs: string[] = [];

  try {
    const port = await findFreePort();
    logs.push(`Found free port: ${port}`);

    const buildDir = await findBuildDir(workspacePath);
    logs.push(`Serving from: ${buildDir}`);

    // Check if project has a start script
    let hasStartScript = false;
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(workspacePath, 'package.json'), 'utf-8'));
      hasStartScript = !!(pkg.scripts?.start || pkg.scripts?.serve || pkg.scripts?.preview);
    } catch { /* no package.json */ }

    if (hasStartScript) {
      // Use the project's own start script with PORT env
      const cmd = `cd "${workspacePath}" && PORT=${port} npx --yes serve -s "${path.basename(buildDir)}" -l ${port} &`;
      logs.push(`Starting with: npx serve -s ${path.basename(buildDir)} -l ${port}`);
      await execAsync(cmd, { timeout: 15000 });
    } else {
      // Use npx serve for static files
      const cmd = `npx --yes serve -s "${buildDir}" -l ${port} &`;
      logs.push(`Starting with: npx serve -s -l ${port}`);
      await execAsync(cmd, { timeout: 15000 });
    }

    logs.push(`Server started on port ${port}`);

    return {
      success: true,
      target: 'local',
      url: `http://localhost:${port}`,
      port,
      logs,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    logs.push(`Error: ${err.message}`);
    return {
      success: false,
      target: 'local',
      logs,
      durationMs: Date.now() - start,
      error: err.message,
    };
  }
}

// ── Deploy: Docker ──────────────────────────────────────────

async function deployDocker(workspacePath: string): Promise<DeployResult> {
  const start = Date.now();
  const logs: string[] = [];
  const projectName = path.basename(workspacePath).toLowerCase().replace(/[^a-z0-9-]/g, '-');

  try {
    // Check for Dockerfile, generate one if missing
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

    // Build image
    const imageName = `sovereign-${projectName}:latest`;
    logs.push(`Building image: ${imageName}`);
    const { stdout: buildOut } = await execAsync(
      `cd "${workspacePath}" && docker build -t ${imageName} .`,
      { timeout: 120000 }
    );
    logs.push('Docker build completed');

    // Find free port and run container
    const port = await findFreePort(4000);
    const containerName = `sovereign-${projectName}`;

    // Stop existing container if running
    try {
      await execAsync(`docker stop ${containerName} && docker rm ${containerName}`);
      logs.push('Stopped existing container');
    } catch { /* no existing container */ }

    const { stdout: runOut } = await execAsync(
      `docker run -d --name ${containerName} -p ${port}:3000 ${imageName}`,
      { timeout: 30000 }
    );
    const containerId = runOut.trim().substring(0, 12);
    logs.push(`Container started: ${containerId}`);

    return {
      success: true,
      target: 'docker',
      url: `http://localhost:${port}`,
      port,
      containerId,
      logs,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    logs.push(`Error: ${err.message}`);
    return {
      success: false,
      target: 'docker',
      logs,
      durationMs: Date.now() - start,
      error: err.message,
    };
  }
}

function generateDockerfile(projectType: ProjectType): string {
  switch (projectType) {
    case 'node-ts':
    case 'node-js':
      return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build 2>/dev/null || true
EXPOSE 3000
CMD ["npm", "start"]
`;
    case 'python':
      return `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* ./
RUN pip install -r requirements.txt 2>/dev/null || true
COPY . .
EXPOSE 3000
CMD ["python", "main.py"]
`;
    case 'static':
      return `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
    default:
      return `FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install 2>/dev/null || true
EXPOSE 3000
CMD ["npm", "start"]
`;
  }
}

// ── Deploy: Static ──────────────────────────────────────────

async function deployStatic(workspacePath: string): Promise<DeployResult> {
  const start = Date.now();
  const logs: string[] = [];

  try {
    const buildDir = await findBuildDir(workspacePath);
    const projectName = path.basename(workspacePath);
    const outputDir = path.join('/workspace', '.deploys', projectName);

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });
    logs.push(`Created output directory: ${outputDir}`);

    // Copy build files
    await execAsync(`cp -r "${buildDir}"/* "${outputDir}"/`, { timeout: 30000 });
    logs.push(`Copied files from ${buildDir}`);

    // Count files
    const { stdout } = await execAsync(`find "${outputDir}" -type f | wc -l`);
    logs.push(`Deployed ${stdout.trim()} files to ${outputDir}`);

    return {
      success: true,
      target: 'static',
      outputPath: outputDir,
      logs,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    logs.push(`Error: ${err.message}`);
    return {
      success: false,
      target: 'static',
      logs,
      durationMs: Date.now() - start,
      error: err.message,
    };
  }
}

// ── Main Deploy Function ────────────────────────────────────

export async function deploy(
  workspacePath: string,
  target?: DeployTarget,
): Promise<DeployResult> {
  // Auto-detect target if not specified
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
