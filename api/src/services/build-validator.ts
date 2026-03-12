/**
 * Build Validation Framework — Programmatic enforcement of BUILD RULES B5/B6
 *
 * Auto-detects project type and runs the appropriate validation steps
 * based on the tier (small/medium/large) determined by the number of
 * changed files.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

const execAsync = promisify(exec);
const MAX_COMMAND_TIMEOUT = 5 * 60 * 1000; // 5 min per step

// ── Types ────────────────────────────────────────────────────────────

export type ProjectType = 'node-ts' | 'node-js' | 'rust' | 'python' | 'docker' | 'static' | 'unknown';
export type ValidationTier = 'small' | 'medium' | 'large';
export type StepStatus = 'pass' | 'fail' | 'skip' | 'running';

export interface BuildStep {
  name: string;
  command: string;
  status: StepStatus;
  output: string;
  durationMs: number;
  required: boolean; // If false, failure is a warning not an error
}

export interface BuildReport {
  id: string;
  workspacePath: string;
  projectType: ProjectType;
  status: 'passing' | 'failing' | 'warning';
  steps: BuildStep[];
  tier: ValidationTier;
  createdAt: string;
  totalDurationMs: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Check if a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse a JSON file, returning null on failure.
 */
async function readJsonFile(filePath: string): Promise<any | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Check if a package.json has a specific script defined.
 */
async function hasNpmScript(dirPath: string, scriptName: string): Promise<boolean> {
  const pkg = await readJsonFile(path.join(dirPath, 'package.json'));
  return !!(pkg?.scripts?.[scriptName]);
}

// ── Core Functions ───────────────────────────────────────────────────

/**
 * Detect the project type based on configuration files present in the directory.
 */
export async function detectProjectType(dirPath: string): Promise<ProjectType> {
  if (await fileExists(path.join(dirPath, 'tsconfig.json'))) {
    return 'node-ts';
  }
  if (await fileExists(path.join(dirPath, 'package.json'))) {
    return 'node-js';
  }
  if (await fileExists(path.join(dirPath, 'Cargo.toml'))) {
    return 'rust';
  }
  if (
    (await fileExists(path.join(dirPath, 'pyproject.toml'))) ||
    (await fileExists(path.join(dirPath, 'setup.py')))
  ) {
    return 'python';
  }
  if (
    (await fileExists(path.join(dirPath, 'Dockerfile'))) ||
    (await fileExists(path.join(dirPath, 'docker-compose.yml')))
  ) {
    return 'docker';
  }
  if (await fileExists(path.join(dirPath, 'index.html'))) {
    return 'static';
  }
  return 'unknown';
}

/**
 * Determine the validation tier based on the number of changed files (B6).
 *
 * - 0-2 files: 'small'
 * - 3-5 files: 'medium'
 * - 6+: 'large'
 * - Default to 'medium' if changedFiles not provided
 */
export function determineTier(changedFiles?: number): ValidationTier {
  if (changedFiles === undefined || changedFiles === null) {
    return 'medium';
  }
  if (changedFiles <= 2) return 'small';
  if (changedFiles <= 5) return 'medium';
  return 'large';
}

/**
 * Get the validation steps for a given project type and tier.
 */
export async function getValidationSteps(
  type: ProjectType,
  tier: ValidationTier,
  dirPath: string
): Promise<{ name: string; command: string; required: boolean }[]> {
  const steps: { name: string; command: string; required: boolean }[] = [];

  switch (type) {
    case 'node-ts': {
      // Small: tsc --noEmit, npm run build
      steps.push({ name: 'TypeScript type-check', command: 'npx tsc --noEmit', required: true });
      if (await hasNpmScript(dirPath, 'build')) {
        steps.push({ name: 'Build', command: 'npm run build', required: true });
      }

      // Medium: + npm test (if test script exists)
      if (tier === 'medium' || tier === 'large') {
        if (await hasNpmScript(dirPath, 'test')) {
          steps.push({ name: 'Tests', command: 'npm test', required: false });
        }
      }

      // Large: + check for mock data, env wiring
      if (tier === 'large') {
        steps.push({
          name: 'Mock data audit',
          command: 'grep -rn "mock\\|MOCK\\|dummy\\|placeholder" src/ --include="*.ts" --include="*.tsx" -l || true',
          required: false,
        });
        steps.push({
          name: 'Environment wiring check',
          command: 'grep -rn "process\\.env\\." src/ --include="*.ts" --include="*.tsx" -l || true',
          required: false,
        });
      }
      break;
    }

    case 'node-js': {
      // Small: npm run build (if build script exists)
      if (await hasNpmScript(dirPath, 'build')) {
        steps.push({ name: 'Build', command: 'npm run build', required: true });
      }

      // Medium: + npm test
      if (tier === 'medium' || tier === 'large') {
        if (await hasNpmScript(dirPath, 'test')) {
          steps.push({ name: 'Tests', command: 'npm test', required: false });
        }
      }
      break;
    }

    case 'rust': {
      // Small: cargo check
      steps.push({ name: 'Cargo check', command: 'cargo check', required: true });

      // Medium: + cargo build
      if (tier === 'medium' || tier === 'large') {
        steps.push({ name: 'Cargo build', command: 'cargo build', required: true });
      }

      // Large: + cargo test
      if (tier === 'large') {
        steps.push({ name: 'Cargo test', command: 'cargo test', required: false });
      }
      break;
    }

    case 'python': {
      // Small: python -m py_compile on all .py files
      steps.push({
        name: 'Python syntax check',
        command: 'find . -name "*.py" -not -path "*/venv/*" -not -path "*/.venv/*" -not -path "*/__pycache__/*" -exec python3 -m py_compile {} +',
        required: true,
      });

      // Medium: + pytest (if exists)
      if (tier === 'medium' || tier === 'large') {
        const hasPytest =
          (await fileExists(path.join(dirPath, 'pytest.ini'))) ||
          (await fileExists(path.join(dirPath, 'setup.cfg'))) ||
          (await fileExists(path.join(dirPath, 'pyproject.toml')));
        if (hasPytest) {
          steps.push({ name: 'Pytest', command: 'python3 -m pytest --tb=short -q', required: false });
        }
      }
      break;
    }

    case 'docker': {
      // Small: docker compose config (if compose exists)
      if (await fileExists(path.join(dirPath, 'docker-compose.yml'))) {
        steps.push({ name: 'Docker Compose config validate', command: 'docker compose config --quiet', required: true });
      } else if (await fileExists(path.join(dirPath, 'docker-compose.yaml'))) {
        steps.push({ name: 'Docker Compose config validate', command: 'docker compose config --quiet', required: true });
      }

      // Medium: + docker build .
      if (tier === 'medium' || tier === 'large') {
        if (await fileExists(path.join(dirPath, 'Dockerfile'))) {
          steps.push({ name: 'Docker build', command: 'docker build .', required: true });
        }
      }
      break;
    }

    case 'static': {
      // Just check that index.html exists
      steps.push({ name: 'Index file check', command: 'test -f index.html', required: true });
      break;
    }

    case 'unknown': {
      // Just check that index.html exists (if present)
      if (await fileExists(path.join(dirPath, 'index.html'))) {
        steps.push({ name: 'Index file check', command: 'test -f index.html', required: true });
      } else {
        steps.push({ name: 'Directory exists', command: 'test -d .', required: true });
      }
      break;
    }
  }

  return steps;
}

/**
 * Run build validation on a workspace directory.
 *
 * Detects project type, determines tier, gets validation steps,
 * runs each step sequentially, and returns a BuildReport.
 */
export async function runValidation(
  workspacePath: string,
  changedFiles?: number
): Promise<BuildReport> {
  const reportId = crypto.randomUUID();
  const startTime = Date.now();

  const projectType = await detectProjectType(workspacePath);
  const tier = determineTier(changedFiles);
  const stepDefs = await getValidationSteps(projectType, tier, workspacePath);

  const steps: BuildStep[] = [];

  for (const stepDef of stepDefs) {
    const stepStart = Date.now();
    let status: StepStatus = 'running';
    let output = '';

    try {
      const result = await execAsync(stepDef.command, {
        cwd: workspacePath,
        maxBuffer: 5 * 1024 * 1024,
        timeout: MAX_COMMAND_TIMEOUT,
        env: {
          ...process.env,
          HOME: process.env.HOME || '/root',
          PATH: process.env.PATH,
          CI: 'true', // Suppress interactive prompts
        },
      });

      output = ((result.stdout || '') + '\n' + (result.stderr || '')).trim();
      status = 'pass';
    } catch (err: any) {
      output = ((err.stdout || '') + '\n' + (err.stderr || err.message || '')).trim();
      status = 'fail';
    }

    // Truncate output to 5000 chars
    if (output.length > 5000) {
      output = output.slice(0, 5000) + '\n... [truncated]';
    }

    const durationMs = Date.now() - stepStart;

    steps.push({
      name: stepDef.name,
      command: stepDef.command,
      status,
      output,
      durationMs,
      required: stepDef.required,
    });
  }

  // Determine overall status
  const hasRequiredFailure = steps.some(s => s.status === 'fail' && s.required);
  const hasOptionalFailure = steps.some(s => s.status === 'fail' && !s.required);

  let overallStatus: 'passing' | 'failing' | 'warning';
  if (hasRequiredFailure) {
    overallStatus = 'failing';
  } else if (hasOptionalFailure) {
    overallStatus = 'warning';
  } else {
    overallStatus = 'passing';
  }

  const totalDurationMs = Date.now() - startTime;

  return {
    id: reportId,
    workspacePath,
    projectType,
    status: overallStatus,
    steps,
    tier,
    createdAt: new Date().toISOString(),
    totalDurationMs,
  };
}
