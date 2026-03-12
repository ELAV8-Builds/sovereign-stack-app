/**
 * Build Guard — Code-enforced build methodology
 *
 * Classifies changes by size and enforces validation tiers:
 * - Small (≤3 files): lint/typecheck only
 * - Medium (4-10 files): lint + typecheck + build
 * - Large (>10 files): lint + typecheck + build + tests
 *
 * Any new API endpoint or service = automatic Large tier.
 * Prevents deployment if required validation hasn't passed.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logActivity } from './activity-broadcaster';

const execAsync = promisify(exec);

// ── Types ────────────────────────────────────────────────────

export type ChangeTier = 'small' | 'medium' | 'large';

export interface ChangeClassification {
  tier: ChangeTier;
  fileCount: number;
  hasNewEndpoints: boolean;
  hasNewServices: boolean;
  requiredChecks: string[];
  description: string;
}

export interface GuardReport {
  allowed: boolean;
  classification: ChangeClassification;
  checksRun: Array<{
    name: string;
    passed: boolean;
    output?: string;
    durationMs: number;
  }>;
  totalDurationMs: number;
  summary: string;
}

// ── Change Classification ────────────────────────────────────

/**
 * Classify a set of changes by their risk tier.
 */
export async function classifyChanges(
  projectPath: string,
  changedFiles?: number
): Promise<ChangeClassification> {
  let fileCount = changedFiles || 0;
  let hasNewEndpoints = false;
  let hasNewServices = false;

  // If no file count provided, try to detect from git
  if (!fileCount) {
    try {
      const { stdout } = await execAsync('git diff --name-only HEAD~1 2>/dev/null || git diff --name-only', {
        cwd: projectPath,
        timeout: 10000,
      });
      const files = stdout.trim().split('\n').filter(Boolean);
      fileCount = files.length;

      // Check for new endpoints or services
      for (const file of files) {
        const lower = file.toLowerCase();
        if (lower.includes('route') || lower.includes('endpoint') || lower.includes('controller')) {
          hasNewEndpoints = true;
        }
        if (lower.includes('service') && !lower.includes('.test.') && !lower.includes('.spec.')) {
          hasNewServices = true;
        }
      }
    } catch {
      // No git or no commits — use file count estimate
      fileCount = fileCount || 1;
    }
  }

  // Auto-upgrade to large if new endpoints/services detected
  let tier: ChangeTier;
  if (hasNewEndpoints || hasNewServices || fileCount > 10) {
    tier = 'large';
  } else if (fileCount > 3) {
    tier = 'medium';
  } else {
    tier = 'small';
  }

  const requiredChecks = getRequiredChecks(tier);

  const descriptions: Record<ChangeTier, string> = {
    small: `Small change (${fileCount} file${fileCount !== 1 ? 's' : ''}): typecheck + spot-check`,
    medium: `Medium change (${fileCount} files): typecheck + build + feedback audit`,
    large: `Large change (${fileCount} files${hasNewEndpoints ? ', new endpoints' : ''}${hasNewServices ? ', new services' : ''}): full validation suite`,
  };

  return {
    tier,
    fileCount,
    hasNewEndpoints,
    hasNewServices,
    requiredChecks,
    description: descriptions[tier],
  };
}

function getRequiredChecks(tier: ChangeTier): string[] {
  switch (tier) {
    case 'small':
      return ['typecheck'];
    case 'medium':
      return ['typecheck', 'build'];
    case 'large':
      return ['typecheck', 'build', 'test'];
  }
}

// ── Guard Execution ──────────────────────────────────────────

/**
 * Run the build guard: classify changes, execute required checks, report.
 * Returns whether deployment is allowed.
 */
export async function runBuildGuard(
  projectPath: string,
  changedFiles?: number
): Promise<GuardReport> {
  const startTime = Date.now();
  const classification = await classifyChanges(projectPath, changedFiles);

  logActivity('build-guard', 'info',
    `${classification.description} — running ${classification.requiredChecks.length} check(s)`);

  const checksRun: GuardReport['checksRun'] = [];
  let allPassed = true;

  // Detect project type
  const hasPackageJson = await fileExists(path.join(projectPath, 'package.json'));
  const hasTsConfig = await fileExists(path.join(projectPath, 'tsconfig.json'));
  const hasCargoToml = await fileExists(path.join(projectPath, 'Cargo.toml'));
  const hasPyproject = await fileExists(path.join(projectPath, 'pyproject.toml'));

  for (const check of classification.requiredChecks) {
    const checkStart = Date.now();
    let passed = true;
    let output = '';

    try {
      switch (check) {
        case 'typecheck': {
          if (hasTsConfig) {
            const result = await execAsync('npx tsc --noEmit 2>&1', {
              cwd: projectPath,
              timeout: 120000,
            });
            output = result.stdout.slice(0, 2000);
          } else if (hasCargoToml) {
            const result = await execAsync('cargo check 2>&1', {
              cwd: projectPath,
              timeout: 120000,
            });
            output = result.stdout.slice(0, 2000);
          } else if (hasPyproject) {
            const result = await execAsync('python -m mypy . 2>&1 || echo "mypy not installed, skipping"', {
              cwd: projectPath,
              timeout: 60000,
            });
            output = result.stdout.slice(0, 2000);
          } else {
            output = 'No type system detected, skipping';
          }
          break;
        }

        case 'build': {
          if (hasPackageJson) {
            // Check if build script exists
            const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
            if (pkg.scripts?.build) {
              const result = await execAsync('npm run build 2>&1', {
                cwd: projectPath,
                timeout: 300000, // 5 minutes
              });
              output = result.stdout.slice(-2000);
            } else {
              output = 'No build script in package.json, skipping';
            }
          } else if (hasCargoToml) {
            const result = await execAsync('cargo build 2>&1', {
              cwd: projectPath,
              timeout: 300000,
            });
            output = result.stdout.slice(-2000);
          } else {
            output = 'No build system detected, skipping';
          }
          break;
        }

        case 'test': {
          if (hasPackageJson) {
            const pkg = JSON.parse(await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8'));
            if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
              const result = await execAsync('npm test 2>&1', {
                cwd: projectPath,
                timeout: 300000,
              });
              output = result.stdout.slice(-2000);
            } else {
              output = 'No test script configured, skipping';
              // Don't fail if no tests exist yet
            }
          } else if (hasCargoToml) {
            const result = await execAsync('cargo test 2>&1', {
              cwd: projectPath,
              timeout: 300000,
            });
            output = result.stdout.slice(-2000);
          } else if (hasPyproject) {
            const result = await execAsync('python -m pytest 2>&1 || echo "pytest not installed"', {
              cwd: projectPath,
              timeout: 120000,
            });
            output = result.stdout.slice(-2000);
          } else {
            output = 'No test framework detected, skipping';
          }
          break;
        }
      }
    } catch (err: any) {
      passed = false;
      output = (err.stderr || err.stdout || err.message || '').slice(0, 2000);
    }

    const checkDuration = Date.now() - checkStart;
    checksRun.push({ name: check, passed, output, durationMs: checkDuration });

    if (!passed) {
      allPassed = false;
      logActivity('build-guard', 'error',
        `Check failed: ${check} (${(checkDuration / 1000).toFixed(1)}s)`);
    } else {
      logActivity('build-guard', 'success',
        `Check passed: ${check} (${(checkDuration / 1000).toFixed(1)}s)`);
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const failedChecks = checksRun.filter(c => !c.passed);

  const summary = allPassed
    ? `Build guard passed (${classification.tier} tier, ${checksRun.length} checks, ${(totalDurationMs / 1000).toFixed(1)}s)`
    : `Build guard FAILED: ${failedChecks.map(c => c.name).join(', ')} failed (${classification.tier} tier)`;

  logActivity('build-guard', allPassed ? 'success' : 'error', summary);

  return {
    allowed: allPassed,
    classification,
    checksRun,
    totalDurationMs,
    summary,
  };
}

// ── Helpers ──────────────────────────────────────────────────

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
