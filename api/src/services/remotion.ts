/**
 * Remotion Service — Programmatic Video / Motion Graphics
 *
 * Manages Remotion projects and render jobs:
 * - Scaffold new Remotion projects from built-in templates
 * - List / inspect existing projects and compositions
 * - Queue and track render jobs (mp4, webm, gif)
 * - Background rendering via child_process.spawn
 *
 * Workspace: REMOTION_WORKSPACE env var (default: /workspace/remotion-projects)
 */
import { promises as fs } from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { query } from './database';
import { logActivity } from './activity-broadcaster';

const execAsync = promisify(exec);

// ── Configuration ────────────────────────────────────────
const REMOTION_WORKSPACE = process.env.REMOTION_WORKSPACE || '/workspace/remotion-projects';

// ── Types ────────────────────────────────────────────────
export interface RemotionProject {
  id: string;
  name: string;
  path: string;
  compositions: string[];
  created_at: string;
}

export interface RenderJob {
  id: string;
  project_id: string;
  composition: string;
  status: 'queued' | 'rendering' | 'completed' | 'failed';
  output_path: string | null;
  progress: number;
  error: string | null;
  props: Record<string, any>;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

// ── Table Migration ──────────────────────────────────────
let tablesMigrated = false;

export async function ensureRemotionTables(): Promise<void> {
  if (tablesMigrated) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS remotion_projects (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        compositions JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS remotion_render_jobs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        project_id TEXT NOT NULL,
        composition TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        output_path TEXT,
        progress REAL DEFAULT 0,
        error TEXT,
        props JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        duration_ms INT
      )
    `);
    tablesMigrated = true;
  } catch (err) {
    console.warn('Failed to create Remotion tables:', (err as Error).message);
  }
}

// ── Project Templates ────────────────────────────────────

function packageJsonTemplate(name: string): string {
  return JSON.stringify(
    {
      name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      version: '1.0.0',
      private: true,
      scripts: {
        start: 'npx remotion studio',
        build: 'npx remotion render',
        upgrade: 'npx remotion upgrade',
      },
      dependencies: {
        '@remotion/cli': '^4.0.0',
        '@remotion/compositor-linux-x64-gnu': '^4.0.0',
        react: '^18.3.0',
        'react-dom': '^18.3.0',
        remotion: '^4.0.0',
      },
      devDependencies: {
        '@types/react': '^18.3.0',
        typescript: '^5.4.0',
      },
    },
    null,
    2
  );
}

function tsconfigTemplate(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'commonjs',
        jsx: 'react-jsx',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        outDir: './dist',
        rootDir: './src',
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2
  );
}

const remotionConfigTemplate = `import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
`;

const rootTsxTemplate = `import { Composition } from "remotion";
import { TextReveal } from "./compositions/TextReveal";
import { Counter } from "./compositions/Counter";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TextReveal"
        component={TextReveal}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          text: "Hello World",
          color: "#ffffff",
          backgroundColor: "#000000",
        }}
      />
      <Composition
        id="Counter"
        component={Counter}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          from: 0,
          to: 100,
          suffix: "",
          color: "#ffffff",
          backgroundColor: "#1a1a2e",
        }}
      />
    </>
  );
};
`;

const textRevealTemplate = `import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from "remotion";

interface TextRevealProps {
  text: string;
  color: string;
  backgroundColor: string;
}

export const TextReveal: React.FC<TextRevealProps> = ({
  text,
  color,
  backgroundColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  const scale = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 100 },
  });

  const translateY = interpolate(frame, [0, 30], [40, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          color,
          fontSize: 80,
          fontWeight: "bold",
          fontFamily: "Arial, sans-serif",
          opacity,
          transform: \`scale(\${scale}) translateY(\${translateY}px)\`,
          textAlign: "center",
          padding: "0 60px",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
`;

const counterTemplate = `import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
} from "remotion";

interface CounterProps {
  from: number;
  to: number;
  suffix: string;
  color: string;
  backgroundColor: string;
}

export const Counter: React.FC<CounterProps> = ({
  from,
  to,
  suffix,
  color,
  backgroundColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const progress = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 50 },
    durationInFrames: durationInFrames - 30,
  });

  const currentValue = Math.round(interpolate(progress, [0, 1], [from, to]));

  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const scale = interpolate(frame, [0, 20], [0.5, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          color,
          fontSize: 120,
          fontWeight: "bold",
          fontFamily: "monospace",
          opacity,
          transform: \`scale(\${scale})\`,
          textAlign: "center",
        }}
      >
        {currentValue.toLocaleString()}
        {suffix}
      </div>
    </AbsoluteFill>
  );
};
`;

const indexTsTemplate = `import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
`;

// ── Workspace ────────────────────────────────────────────

async function ensureWorkspace(): Promise<void> {
  await fs.mkdir(REMOTION_WORKSPACE, { recursive: true });
}

// ── Project Management ───────────────────────────────────

export async function createRemotionProject(
  name: string,
  _template?: string
): Promise<RemotionProject> {
  await ensureRemotionTables();
  await ensureWorkspace();

  // Generate a slug from the name
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const projectPath = path.join(REMOTION_WORKSPACE, slug);

  // Check if directory already exists
  try {
    await fs.access(projectPath);
    throw new Error(`Project directory already exists: ${slug}`);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    // ENOENT is expected — directory does not exist yet
  }

  logActivity('remotion', 'info', `Creating Remotion project: ${name}`);

  // Scaffold project files
  await fs.mkdir(path.join(projectPath, 'src', 'compositions'), {
    recursive: true,
  });
  await fs.mkdir(path.join(projectPath, 'out'), { recursive: true });

  await Promise.all([
    fs.writeFile(
      path.join(projectPath, 'package.json'),
      packageJsonTemplate(name)
    ),
    fs.writeFile(path.join(projectPath, 'tsconfig.json'), tsconfigTemplate()),
    fs.writeFile(
      path.join(projectPath, 'remotion.config.ts'),
      remotionConfigTemplate
    ),
    fs.writeFile(path.join(projectPath, 'src', 'index.ts'), indexTsTemplate),
    fs.writeFile(path.join(projectPath, 'src', 'Root.tsx'), rootTsxTemplate),
    fs.writeFile(
      path.join(projectPath, 'src', 'compositions', 'TextReveal.tsx'),
      textRevealTemplate
    ),
    fs.writeFile(
      path.join(projectPath, 'src', 'compositions', 'Counter.tsx'),
      counterTemplate
    ),
  ]);

  // Install dependencies
  logActivity('remotion', 'info', `Installing dependencies for ${name}...`);
  try {
    await execAsync('npm install --prefer-offline 2>&1', {
      cwd: projectPath,
      timeout: 5 * 60 * 1000,
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (err: any) {
    logActivity(
      'remotion',
      'warning',
      `npm install had warnings: ${(err.stderr || '').slice(0, 200)}`
    );
    // Continue even if there are warnings — deps may still be usable
  }

  const compositions = ['TextReveal', 'Counter'];

  // Persist to DB
  const result = await query(
    `INSERT INTO remotion_projects (name, path, compositions)
     VALUES ($1, $2, $3)
     RETURNING id, name, path, compositions, created_at`,
    [name, projectPath, JSON.stringify(compositions)]
  );

  const row = result.rows[0];
  logActivity('remotion', 'success', `Created Remotion project: ${name} (${row.id})`);

  return {
    id: row.id,
    name: row.name,
    path: row.path,
    compositions: row.compositions,
    created_at: row.created_at,
  };
}

export async function listRemotionProjects(): Promise<RemotionProject[]> {
  await ensureRemotionTables();
  const result = await query(
    'SELECT id, name, path, compositions, created_at FROM remotion_projects ORDER BY created_at DESC'
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    path: row.path,
    compositions: row.compositions || [],
    created_at: row.created_at,
  }));
}

export async function getRemotionProject(
  id: string
): Promise<RemotionProject | null> {
  await ensureRemotionTables();
  const result = await query(
    'SELECT id, name, path, compositions, created_at FROM remotion_projects WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    compositions: row.compositions || [],
    created_at: row.created_at,
  };
}

// ── Render Jobs ──────────────────────────────────────────

export async function startRender(params: {
  projectId: string;
  composition: string;
  props?: Record<string, any>;
  outputFormat?: 'mp4' | 'webm' | 'gif';
}): Promise<RenderJob> {
  await ensureRemotionTables();

  const project = await getRemotionProject(params.projectId);
  if (!project) {
    throw new Error(`Project not found: ${params.projectId}`);
  }

  const format = params.outputFormat || 'mp4';
  const props = params.props || {};
  const outputFilename = `${params.composition}-${Date.now()}.${format}`;
  const outputPath = path.join(project.path, 'out', outputFilename);

  // Create the render job in DB
  const result = await query(
    `INSERT INTO remotion_render_jobs (project_id, composition, status, output_path, props)
     VALUES ($1, $2, 'queued', $3, $4)
     RETURNING id, project_id, composition, status, output_path, progress, error, props, created_at, completed_at, duration_ms`,
    [params.projectId, params.composition, outputPath, JSON.stringify(props)]
  );

  const job: RenderJob = {
    id: result.rows[0].id,
    project_id: result.rows[0].project_id,
    composition: result.rows[0].composition,
    status: result.rows[0].status,
    output_path: result.rows[0].output_path,
    progress: result.rows[0].progress,
    error: result.rows[0].error,
    props: result.rows[0].props,
    created_at: result.rows[0].created_at,
    completed_at: result.rows[0].completed_at,
    duration_ms: result.rows[0].duration_ms,
  };

  logActivity(
    'remotion',
    'info',
    `Queued render job ${job.id}: ${params.composition} (${format})`
  );

  // Start render in background (non-blocking)
  runRenderProcess(job.id, project.path, params.composition, outputPath, props, format);

  return job;
}

/**
 * Spawn the Remotion render process in the background.
 * Updates the DB row as the render progresses.
 */
function runRenderProcess(
  jobId: string,
  projectPath: string,
  composition: string,
  outputPath: string,
  props: Record<string, any>,
  format: string
): void {
  const startMs = Date.now();

  // Mark as rendering
  query(
    `UPDATE remotion_render_jobs SET status = 'rendering' WHERE id = $1`,
    [jobId]
  ).catch(() => {});

  logActivity('remotion', 'info', `Starting render process for job ${jobId}`);

  const args = [
    'remotion',
    'render',
    composition,
    outputPath,
  ];

  // Add props if any
  if (Object.keys(props).length > 0) {
    args.push(`--props=${JSON.stringify(props)}`);
  }

  // Add codec for non-mp4 formats
  if (format === 'webm') {
    args.push('--codec=vp8');
  } else if (format === 'gif') {
    args.push('--codec=gif');
  }

  const child = spawn('npx', args, {
    cwd: projectPath,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';

  child.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    // Try to parse progress from Remotion output
    const progressMatch = text.match(/(\d+)%/);
    if (progressMatch) {
      const progress = parseInt(progressMatch[1], 10);
      query(
        `UPDATE remotion_render_jobs SET progress = $1 WHERE id = $2`,
        [progress, jobId]
      ).catch(() => {});
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    stderrBuf += data.toString();
    // Remotion often outputs progress to stderr as well
    const progressMatch = stderrBuf.match(/(\d+)%/);
    if (progressMatch) {
      const progress = parseInt(progressMatch[1], 10);
      query(
        `UPDATE remotion_render_jobs SET progress = $1 WHERE id = $2`,
        [progress, jobId]
      ).catch(() => {});
    }
  });

  child.on('close', (code) => {
    const durationMs = Date.now() - startMs;

    if (code === 0) {
      query(
        `UPDATE remotion_render_jobs
         SET status = 'completed', progress = 100, completed_at = NOW(), duration_ms = $1
         WHERE id = $2`,
        [durationMs, jobId]
      ).catch(() => {});
      logActivity('remotion', 'success', `Render job ${jobId} completed in ${(durationMs / 1000).toFixed(1)}s`);
    } else {
      const errorMsg = stderrBuf.slice(-500) || `Process exited with code ${code}`;
      query(
        `UPDATE remotion_render_jobs
         SET status = 'failed', error = $1, completed_at = NOW(), duration_ms = $2
         WHERE id = $3`,
        [errorMsg, durationMs, jobId]
      ).catch(() => {});
      logActivity('remotion', 'error', `Render job ${jobId} failed: ${errorMsg.slice(0, 200)}`);
    }
  });

  child.on('error', (err) => {
    const durationMs = Date.now() - startMs;
    const errorMsg = `Spawn error: ${err.message}`;
    query(
      `UPDATE remotion_render_jobs
       SET status = 'failed', error = $1, completed_at = NOW(), duration_ms = $2
       WHERE id = $3`,
      [errorMsg, durationMs, jobId]
    ).catch(() => {});
    logActivity('remotion', 'error', `Render job ${jobId} spawn failed: ${err.message}`);
  });
}

export async function getRenderJob(id: string): Promise<RenderJob | null> {
  await ensureRemotionTables();
  const result = await query(
    `SELECT id, project_id, composition, status, output_path, progress, error, props,
            created_at, completed_at, duration_ms
     FROM remotion_render_jobs WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    project_id: row.project_id,
    composition: row.composition,
    status: row.status,
    output_path: row.output_path,
    progress: row.progress,
    error: row.error,
    props: row.props || {},
    created_at: row.created_at,
    completed_at: row.completed_at,
    duration_ms: row.duration_ms,
  };
}

export async function listRenderJobs(projectId: string): Promise<RenderJob[]> {
  await ensureRemotionTables();
  const result = await query(
    `SELECT id, project_id, composition, status, output_path, progress, error, props,
            created_at, completed_at, duration_ms
     FROM remotion_render_jobs WHERE project_id = $1
     ORDER BY created_at DESC`,
    [projectId]
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    project_id: row.project_id,
    composition: row.composition,
    status: row.status,
    output_path: row.output_path,
    progress: row.progress,
    error: row.error,
    props: row.props || {},
    created_at: row.created_at,
    completed_at: row.completed_at,
    duration_ms: row.duration_ms,
  }));
}

// ── Health Check ─────────────────────────────────────────

export async function checkRemotionHealth(): Promise<{
  available: boolean;
  version?: string;
}> {
  try {
    const { stdout } = await execAsync('npx remotion --version 2>/dev/null', {
      timeout: 15000,
    });
    const version = stdout.trim();
    return { available: true, version };
  } catch {
    return { available: false };
  }
}
