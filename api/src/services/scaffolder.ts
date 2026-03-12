/**
 * Project Scaffolder — Template-based project generation
 *
 * Provides templates for common project types and scaffolds them
 * into the workspace filesystem with all necessary files.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Template Interface ──────────────────────────────────────────────

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  files: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  postScaffold?: string[];
}

// ── Template Definitions ────────────────────────────────────────────

const TEMPLATES: ProjectTemplate[] = [
  // ── React + Vite + TypeScript ───────────────────────────────────
  {
    id: 'react-vite-ts',
    name: 'React + Vite + TypeScript',
    description: 'Modern React app with Vite bundler and TypeScript support',
    icon: '⚛️',
    category: 'frontend',
    files: {
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            useDefineForClassFields: true,
            lib: ['ES2020', 'DOM', 'DOM.Iterable'],
            module: 'ESNext',
            skipLibCheck: true,
            moduleResolution: 'bundler',
            allowImportingTsExtensions: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            jsx: 'react-jsx',
            strict: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            noFallthroughCasesInSwitch: true,
          },
          include: ['src'],
          references: [{ path: './tsconfig.node.json' }],
        },
        null,
        2
      ),
      'tsconfig.node.json': JSON.stringify(
        {
          compilerOptions: {
            composite: true,
            skipLibCheck: true,
            module: 'ESNext',
            moduleResolution: 'bundler',
            allowSyntheticDefaultImports: true,
          },
          include: ['vite.config.ts'],
        },
        null,
        2
      ),
      'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
  },
});
`,
      'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{PROJECT_NAME}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
      'src/App.tsx': `import React from 'react';

function App() {
  return (
    <div className="app">
      <h1>Hello World</h1>
      <p>Welcome to {PROJECT_NAME}</p>
    </div>
  );
}

export default App;
`,
      'src/App.css': `*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
    Ubuntu, Cantarell, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #0a0a0a;
  color: #ededed;
}

.app {
  text-align: center;
  padding: 2rem;
}

.app h1 {
  font-size: 2.5rem;
  margin-bottom: 1rem;
}

.app p {
  color: #888;
  font-size: 1.1rem;
}
`,
      'src/vite-env.d.ts': `/// <reference types="vite/client" />
`,
    },
    dependencies: {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
    },
    devDependencies: {
      '@types/react': '^18.3.3',
      '@types/react-dom': '^18.3.0',
      '@vitejs/plugin-react': '^4.3.1',
      typescript: '^5.5.3',
      vite: '^5.4.2',
    },
    postScaffold: ['npm install'],
  },

  // ── Express + TypeScript API ────────────────────────────────────
  {
    id: 'express-api',
    name: 'Express + TypeScript API',
    description: 'REST API server with Express and TypeScript',
    icon: '🚀',
    category: 'backend',
    files: {
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            lib: ['ES2020'],
            outDir: './dist',
            rootDir: './src',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            declaration: true,
            declarationMap: true,
            sourceMap: true,
          },
          include: ['src'],
          exclude: ['node_modules', 'dist'],
        },
        null,
        2
      ),
      'src/index.ts': `import express from 'express';
import { healthRouter } from './routes/health';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ name: '{PROJECT_NAME}', version: '1.0.0' });
});

app.use('/health', healthRouter);

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
`,
      'src/routes/health.ts': `import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
`,
    },
    dependencies: {
      express: '^4.19.2',
    },
    devDependencies: {
      '@types/express': '^4.17.21',
      '@types/node': '^20.14.10',
      typescript: '^5.5.3',
      'ts-node': '^10.9.2',
    },
    postScaffold: ['npm install'],
  },

  // ── Static Site ─────────────────────────────────────────────────
  {
    id: 'static-site',
    name: 'Static Site',
    description: 'Simple HTML, CSS, and JavaScript website',
    icon: '🌐',
    category: 'frontend',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{PROJECT_NAME}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header>
    <h1>{PROJECT_NAME}</h1>
  </header>
  <main>
    <section class="hero">
      <p>Welcome to your new project.</p>
    </section>
  </main>
  <footer>
    <p>Built with Sovereign Stack</p>
  </footer>
  <script src="script.js"></script>
</body>
</html>
`,
      'styles.css': `*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --bg: #0a0a0a;
  --fg: #ededed;
  --muted: #888;
  --accent: #3b82f6;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
    Ubuntu, Cantarell, sans-serif;
  background: var(--bg);
  color: var(--fg);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  padding: 2rem;
  text-align: center;
  border-bottom: 1px solid #222;
}

main {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2rem;
}

.hero {
  text-align: center;
}

.hero p {
  font-size: 1.2rem;
  color: var(--muted);
}

footer {
  padding: 1rem;
  text-align: center;
  color: var(--muted);
  font-size: 0.85rem;
  border-top: 1px solid #222;
}
`,
      'script.js': `document.addEventListener('DOMContentLoaded', () => {
  console.log('{PROJECT_NAME} loaded');
});
`,
    },
  },

  // ── Blank Project ───────────────────────────────────────────────
  {
    id: 'blank',
    name: 'Blank Project',
    description: 'Empty project with just a README',
    icon: '📄',
    category: 'other',
    files: {
      'README.md': `# {PROJECT_NAME}\n\nNew project created with Sovereign Stack.`,
    },
  },
];

// ── Public API ──────────────────────────────────────────────────────

/**
 * Return all available project templates.
 */
export function getTemplates(): ProjectTemplate[] {
  return TEMPLATES;
}

/**
 * Return a single template by ID.
 */
export function getTemplate(id: string): ProjectTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * Scaffold a project from a template into the given target path.
 *
 * - Creates the target directory
 * - Writes all template files (with {PROJECT_NAME} placeholder replacement)
 * - Generates package.json if dependencies are defined
 * - Runs postScaffold commands (e.g. npm install)
 */
export async function scaffoldProject(
  templateId: string,
  name: string,
  targetPath: string
): Promise<{ success: boolean; filesCreated: number; errors: string[] }> {
  const template = getTemplate(templateId);
  if (!template) {
    return { success: false, filesCreated: 0, errors: [`Template "${templateId}" not found`] };
  }

  const errors: string[] = [];
  let filesCreated = 0;

  try {
    // Create the target directory
    await fs.mkdir(targetPath, { recursive: true });

    // Write all template files
    for (const [filePath, rawContent] of Object.entries(template.files)) {
      const content = rawContent.replace(/\{PROJECT_NAME\}/g, name);
      const fullPath = path.join(targetPath, filePath);

      // Ensure parent directories exist
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      try {
        await fs.writeFile(fullPath, content, 'utf-8');
        filesCreated++;
      } catch (err) {
        errors.push(`Failed to write ${filePath}: ${err}`);
      }
    }

    // Generate package.json if the template has dependencies
    if (template.dependencies || template.devDependencies) {
      const packageJson = {
        name: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        version: '0.1.0',
        private: true,
        description: `${name} — created with Sovereign Stack`,
        scripts: buildScripts(templateId),
        dependencies: template.dependencies || {},
        devDependencies: template.devDependencies || {},
      };

      const pkgPath = path.join(targetPath, 'package.json');
      try {
        await fs.writeFile(pkgPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
        filesCreated++;
      } catch (err) {
        errors.push(`Failed to write package.json: ${err}`);
      }
    }

    // Run postScaffold commands
    if (template.postScaffold && template.postScaffold.length > 0) {
      for (const cmd of template.postScaffold) {
        try {
          await execAsync(cmd, { cwd: targetPath, timeout: 120_000 });
        } catch (err) {
          errors.push(`postScaffold command "${cmd}" failed: ${err}`);
        }
      }
    }

    return { success: errors.length === 0, filesCreated, errors };
  } catch (err) {
    errors.push(`Scaffolding failed: ${err}`);
    return { success: false, filesCreated, errors };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Return sensible default scripts for each template type.
 */
function buildScripts(templateId: string): Record<string, string> {
  switch (templateId) {
    case 'react-vite-ts':
      return {
        dev: 'vite',
        build: 'tsc && vite build',
        preview: 'vite preview',
      };
    case 'express-api':
      return {
        dev: 'ts-node src/index.ts',
        build: 'tsc',
        start: 'node dist/index.js',
      };
    default:
      return {};
  }
}
