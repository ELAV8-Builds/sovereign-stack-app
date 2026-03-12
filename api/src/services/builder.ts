/**
 * Builder — TypeScript + Vite build service
 *
 * Runs tsc and vite build, captures output,
 * reports success/failure with logs.
 */
import { execSync } from 'child_process';
import { join } from 'path';

const PROJECT_ROOT = process.env.PROJECT_ROOT || join(__dirname, '../../../..');

export interface BuildResult {
  success: boolean;
  phase: 'typecheck' | 'build' | 'api-typecheck';
  output: string;
  duration_ms: number;
  error?: string;
}

export interface FullBuildResult {
  success: boolean;
  steps: BuildResult[];
  total_duration_ms: number;
}

/**
 * Run TypeScript type checking for the frontend.
 */
export function runFrontendTypecheck(): BuildResult {
  const start = Date.now();
  try {
    const output = execSync('npx tsc --noEmit', {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      timeout: 120000,
    }).toString();
    return { success: true, phase: 'typecheck', output: output || 'Clean', duration_ms: Date.now() - start };
  } catch (err: any) {
    return { success: false, phase: 'typecheck', output: err.stdout?.toString() || '', duration_ms: Date.now() - start, error: err.stderr?.toString() || err.message };
  }
}

/**
 * Run Vite build for the frontend.
 */
export function runViteBuild(): BuildResult {
  const start = Date.now();
  try {
    const output = execSync('npx vite build', {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      timeout: 120000,
    }).toString();
    return { success: true, phase: 'build', output, duration_ms: Date.now() - start };
  } catch (err: any) {
    return { success: false, phase: 'build', output: err.stdout?.toString() || '', duration_ms: Date.now() - start, error: err.stderr?.toString() || err.message };
  }
}

/**
 * Run TypeScript type checking for the API.
 */
export function runApiTypecheck(): BuildResult {
  const start = Date.now();
  try {
    const output = execSync('npx tsc --noEmit', {
      cwd: join(PROJECT_ROOT, 'api'),
      stdio: 'pipe',
      timeout: 120000,
    }).toString();
    return { success: true, phase: 'api-typecheck', output: output || 'Clean', duration_ms: Date.now() - start };
  } catch (err: any) {
    return { success: false, phase: 'api-typecheck', output: err.stdout?.toString() || '', duration_ms: Date.now() - start, error: err.stderr?.toString() || err.message };
  }
}

/**
 * Run the full build pipeline: frontend tsc → vite build → api tsc
 */
export function runFullBuild(): FullBuildResult {
  const steps: BuildResult[] = [];

  // Step 1: Frontend typecheck
  const tsc = runFrontendTypecheck();
  steps.push(tsc);
  if (!tsc.success) {
    return { success: false, steps, total_duration_ms: steps.reduce((s, r) => s + r.duration_ms, 0) };
  }

  // Step 2: Vite build
  const vite = runViteBuild();
  steps.push(vite);
  if (!vite.success) {
    return { success: false, steps, total_duration_ms: steps.reduce((s, r) => s + r.duration_ms, 0) };
  }

  // Step 3: API typecheck
  const api = runApiTypecheck();
  steps.push(api);

  return {
    success: api.success,
    steps,
    total_duration_ms: steps.reduce((s, r) => s + r.duration_ms, 0),
  };
}
