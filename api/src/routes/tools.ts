import { Router, Request, Response } from 'express';
import { chatCompletion, generateImage } from '../services/litellm';
import { query } from '../services/database';
import { logActivity } from '../services/activity-broadcaster';

export const toolsRouter = Router();

// ── List all available tools ─────────────────────────────
toolsRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    tools: [
      { id: 'iteration-engine', name: '3-Cycle Iteration Engine', status: 'ready', description: 'Generate → Critique → Refine over 3 rounds for any creative output' },
      { id: 'creative-engine', name: 'Creative Engine', status: 'ready', description: 'Multi-variant creative exploration with scoring' },
      { id: 'motion-builder', name: 'Motion Graphics Builder', status: 'ready', description: 'Generate motion design specs and animation code' },
      { id: 'design-audit', name: 'Design Audit', status: 'ready', description: 'Comprehensive UI/UX audit with severity scoring' },
      { id: 'image-gen', name: 'Image Generation', status: 'ready', description: 'Generate images via Gemini (app icons, illustrations, hero images)' },
      { id: 'component-library', name: 'Component Library Generator', status: 'ready', description: 'Generate full component library from design tokens' },
      { id: 'copy-generator', name: 'Copy Generator', status: 'ready', description: 'Generate UI copy, microcopy, error messages, onboarding text' },
      { id: 'color-palette', name: 'Color Palette Analyzer', status: 'ready', description: 'Analyze and generate accessible color palettes' },
      { id: 'user-flow', name: 'User Flow Simulator', status: 'ready', description: 'Map and simulate user journeys through the app' },
      { id: 'responsive-preview', name: 'Responsive Preview', status: 'ready', description: 'Generate responsive layout specs for all breakpoints' },
    ],
  });
});

// ── Run a tool ───────────────────────────────────────────
toolsRouter.post('/run/:toolId', async (req: Request, res: Response) => {
  const { toolId } = req.params;
  const { input } = req.body;

  if (!input) {
    return res.status(400).json({ error: 'input is required' });
  }

  logActivity('tools', 'info', `Running tool: ${toolId}`);

  // Save artifact entry
  let artifactId: string | null = null;
  try {
    const result = await query(
      'INSERT INTO tool_artifacts (tool_name, input, status) VALUES ($1, $2, $3) RETURNING id',
      [toolId, JSON.stringify(input), 'running']
    );
    artifactId = result.rows[0]?.id;
  } catch { /* DB might be down */ }

  try {
    let output: any;

    switch (toolId) {
      case 'iteration-engine':
        output = await runIterationEngine(input);
        break;
      case 'creative-engine':
        output = await runCreativeEngine(input);
        break;
      case 'motion-builder':
        output = await runMotionBuilder(input);
        break;
      case 'design-audit':
        output = await runDesignAudit(input);
        break;
      case 'image-gen':
        output = await runImageGeneration(input);
        break;
      case 'component-library':
        output = await runComponentLibrary(input);
        break;
      case 'copy-generator':
        output = await runCopyGenerator(input);
        break;
      case 'color-palette':
        output = await runColorPalette(input);
        break;
      case 'user-flow':
        output = await runUserFlow(input);
        break;
      case 'responsive-preview':
        output = await runResponsivePreview(input);
        break;
      default:
        return res.status(404).json({ error: `Unknown tool: ${toolId}` });
    }

    // Update artifact
    if (artifactId) {
      try {
        await query(
          'UPDATE tool_artifacts SET output = $1, status = $2, completed_at = NOW() WHERE id = $3',
          [JSON.stringify(output), 'completed', artifactId]
        );
      } catch { /* DB might be down */ }
    }

    logActivity('tools', 'success', `Tool ${toolId} completed`);
    res.json({ toolId, output, artifactId });
  } catch (e) {
    const error = (e as Error).message;

    if (artifactId) {
      try {
        await query(
          'UPDATE tool_artifacts SET status = $1, error = $2, completed_at = NOW() WHERE id = $3',
          ['failed', error, artifactId]
        );
      } catch { /* DB might be down */ }
    }

    logActivity('tools', 'error', `Tool ${toolId} failed: ${error}`);
    res.status(500).json({ error });
  }
});

// Get tool artifact history
toolsRouter.get('/artifacts', async (req: Request, res: Response) => {
  try {
    const tool = req.query.tool as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    let sql = 'SELECT id, tool_name, status, created_at, completed_at FROM tool_artifacts';
    const params: any[] = [];

    if (tool) {
      sql += ' WHERE tool_name = $1';
      params.push(tool);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);
    res.json({ artifacts: result.rows });
  } catch {
    res.json({ artifacts: [] });
  }
});

// Get single artifact with full output
toolsRouter.get('/artifacts/:id', async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM tool_artifacts WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});


// ════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ════════════════════════════════════════════════════════

async function runIterationEngine(input: { prompt: string; context?: string; cycles?: number }) {
  const cycles = input.cycles || 3;
  const results: any[] = [];

  logActivity('iteration-engine', 'thinking', `Starting ${cycles}-cycle iteration`);

  let current = '';

  for (let i = 0; i < cycles; i++) {
    // Generate
    const genPrompt = i === 0
      ? `Create a high-quality response for: ${input.prompt}\n\nContext: ${input.context || 'None'}`
      : `Improve this based on the critique below.\n\nCurrent version:\n${current}\n\nCritique:\n${results[results.length - 1]?.critique}`;

    current = await chatCompletion({
      model: 'coder',
      messages: [{ role: 'user', content: genPrompt }],
    });

    // Critique (skip on last cycle)
    let critique = '';
    if (i < cycles - 1) {
      critique = await chatCompletion({
        model: 'medium',
        messages: [{
          role: 'user',
          content: `Critically evaluate this output. What's strong? What's weak? What specific improvements would make it significantly better?\n\n${current}`,
        }],
      });
    }

    results.push({
      cycle: i + 1,
      output: current,
      critique,
    });

    logActivity('iteration-engine', 'info', `Cycle ${i + 1}/${cycles} complete`);
  }

  return { cycles: results, finalOutput: current };
}

async function runCreativeEngine(input: { prompt: string; variants?: number; context?: string }) {
  const variants = Math.min(input.variants || 3, 5);

  logActivity('creative-engine', 'thinking', `Generating ${variants} creative variants`);

  const variantResults = await Promise.all(
    Array.from({ length: variants }, (_, i) =>
      chatCompletion({
        model: 'creative',
        messages: [{
          role: 'user',
          content: `Generate creative variant #${i + 1} for: ${input.prompt}\n\nContext: ${input.context || 'None'}\n\nBe bold, unique, and distinctive. Each variant should take a different creative direction.`,
        }],
        temperature: 0.9 + (i * 0.05),
      })
    )
  );

  // Score them
  const scoring = await chatCompletion({
    model: 'medium',
    messages: [{
      role: 'user',
      content: `Score each of these ${variants} creative variants from 1-10 on: Originality, Impact, Feasibility, Polish. Return JSON array.\n\n${variantResults.map((v, i) => `--- Variant ${i + 1} ---\n${v}`).join('\n\n')}`,
    }],
  });

  return {
    variants: variantResults.map((v, i) => ({ id: i + 1, content: v })),
    scoring,
  };
}

async function runMotionBuilder(input: { description: string; framework?: string; duration?: number }) {
  logActivity('motion-builder', 'thinking', 'Generating motion graphics spec');

  const spec = await chatCompletion({
    model: 'creative',
    messages: [{
      role: 'user',
      content: `Create a detailed motion graphics specification for: ${input.description}

Framework: ${input.framework || 'CSS/Framer Motion'}
Duration: ${input.duration || 2}s

Include:
1. Timing breakdown (stagger, easing, delays)
2. Property animations (transform, opacity, scale, etc.)
3. Code implementation (React + ${input.framework || 'Framer Motion'})
4. Fallback for reduced-motion preference
5. Performance considerations`,
    }],
  });

  return { spec };
}

async function runDesignAudit(input: { description: string; screenshot?: string; focusAreas?: string[] }) {
  logActivity('design-audit', 'thinking', 'Running design audit');

  const audit = await chatCompletion({
    model: 'creative',
    messages: [{
      role: 'user',
      content: `Perform a comprehensive UI/UX design audit for: ${input.description}

${input.focusAreas ? `Focus areas: ${input.focusAreas.join(', ')}` : ''}

Evaluate and score (1-10) each area:
1. Visual Hierarchy — Is the most important content most prominent?
2. Consistency — Are patterns, spacing, colors consistent?
3. Accessibility — WCAG 2.1 AA compliance (contrast, labels, keyboard)
4. Whitespace — Is spacing intentional and balanced?
5. Typography — Font sizes, weights, line heights appropriate?
6. Color — Palette harmony, meaning, dark mode support?
7. Responsiveness — Will it work on all breakpoints?
8. Interaction — Are hover/focus/active states clear?
9. Loading States — Skeletons, spinners, optimistic updates?
10. Error Handling — Error messages clear and actionable?

For each issue found, assign severity: 🔴 Critical | 🟡 Warning | 🔵 Suggestion

End with a prioritized action plan.`,
    }],
  });

  return { audit };
}

async function runImageGeneration(input: {
  prompt: string;
  type?: 'icon' | 'illustration' | 'hero' | 'og-card' | 'empty-state';
  sizes?: string[];
  style?: string;
}) {
  logActivity('image-gen', 'thinking', `Generating ${input.type || 'image'} via Gemini`);

  // Enhance prompt with Opus, generate with Gemini
  const enhancedPrompt = await chatCompletion({
    model: 'heavy',
    messages: [{
      role: 'user',
      content: `Enhance this image generation prompt for best results with an AI image generator. Make it specific, visual, and detailed. Keep the core intent.

Type: ${input.type || 'general'}
Style: ${input.style || 'modern, clean, professional'}
Original prompt: ${input.prompt}

Return ONLY the enhanced prompt, nothing else.`,
    }],
  });

  const sizes = input.sizes || ['1024x1024'];
  const results: any[] = [];

  for (const size of sizes) {
    try {
      const result = await generateImage(enhancedPrompt, { size });
      results.push({ size, ...result });
    } catch (e) {
      results.push({ size, error: (e as Error).message });
    }
  }

  return {
    originalPrompt: input.prompt,
    enhancedPrompt,
    type: input.type,
    images: results,
  };
}

async function runComponentLibrary(input: {
  tokens: {
    colors?: Record<string, string>;
    spacing?: Record<string, string>;
    typography?: Record<string, any>;
    borderRadius?: Record<string, string>;
  };
  components?: string[];
  framework?: string;
}) {
  logActivity('component-library', 'thinking', 'Generating component library');

  const components = input.components || [
    'Button', 'Input', 'Card', 'Badge', 'Alert',
    'Modal', 'Dropdown', 'Toggle', 'Tabs', 'Avatar',
  ];

  const library = await chatCompletion({
    model: 'coder',
    messages: [{
      role: 'user',
      content: `Generate a complete component library for ${input.framework || 'React + Tailwind CSS'}.

Design Tokens:
${JSON.stringify(input.tokens, null, 2)}

Components to generate: ${components.join(', ')}

For each component, provide:
1. TypeScript component code with proper props interface
2. Variants (primary, secondary, ghost, danger for buttons; sm, md, lg for sizes)
3. Accessibility (ARIA attributes, keyboard navigation)
4. Usage examples
5. Storybook-style documentation

Use the design tokens consistently. Export everything from an index file.`,
    }],
    max_tokens: 8000,
  });

  return { components: components, library };
}

async function runCopyGenerator(input: {
  type: 'microcopy' | 'onboarding' | 'error-messages' | 'empty-states' | 'tooltips' | 'cta' | 'all';
  context: string;
  tone?: string;
  brand?: string;
}) {
  logActivity('copy-generator', 'thinking', `Generating ${input.type} copy`);

  const copy = await chatCompletion({
    model: 'creative',
    messages: [{
      role: 'user',
      content: `Generate UI copy for a software application.

Type: ${input.type}
Context: ${input.context}
Tone: ${input.tone || 'professional, friendly, clear'}
Brand voice: ${input.brand || 'modern tech, approachable, not corporate'}

Generate copy for:
${input.type === 'all' ? `
- Onboarding flow (welcome, setup steps, completion)
- Error messages (network, validation, permission, 404, 500)
- Empty states (no data, first use, search no results)
- Tooltips and help text
- Button labels and CTAs
- Loading states and progress messages
- Success/confirmation messages
- Notification text
` : `
Generate comprehensive ${input.type} copy.
`}

For each piece of copy:
1. Primary text
2. Supporting/secondary text
3. Context where it appears
4. A/B variant for testing

Format as structured JSON.`,
    }],
  });

  return { type: input.type, copy };
}

async function runColorPalette(input: {
  baseColor?: string;
  mode?: 'generate' | 'analyze' | 'extend';
  existingPalette?: Record<string, string>;
  requirements?: string;
}) {
  logActivity('color-palette', 'thinking', 'Analyzing color palette');

  const palette = await chatCompletion({
    model: 'creative',
    messages: [{
      role: 'user',
      content: `${input.mode === 'analyze' ? 'Analyze' : 'Generate'} a color palette for a software application.

${input.baseColor ? `Base color: ${input.baseColor}` : ''}
${input.existingPalette ? `Existing palette: ${JSON.stringify(input.existingPalette)}` : ''}
${input.requirements ? `Requirements: ${input.requirements}` : ''}

Provide:
1. Primary palette (50-950 scale, like Tailwind)
2. Secondary/accent palette
3. Semantic colors (success, warning, error, info)
4. Neutral/gray palette
5. Dark mode variants
6. WCAG AA contrast ratios for all text/background combinations
7. CSS custom properties / Tailwind config
8. Suggested usage guidelines (which color for what)
9. Color harmony analysis (complementary, analogous, triadic)
10. Accessibility report

Return as structured JSON with hex values.`,
    }],
  });

  return { mode: input.mode || 'generate', palette };
}

async function runUserFlow(input: {
  app: string;
  flows?: string[];
  persona?: string;
}) {
  logActivity('user-flow', 'thinking', 'Simulating user flows');

  const flows = input.flows || [
    'First-time onboarding',
    'Core task completion',
    'Error recovery',
    'Settings change',
    'Return after absence',
  ];

  const simulation = await chatCompletion({
    model: 'creative',
    messages: [{
      role: 'user',
      content: `Simulate and map user flows for: ${input.app}

${input.persona ? `Persona: ${input.persona}` : 'Persona: New user, moderately technical'}

Flows to simulate:
${flows.map((f, i) => `${i + 1}. ${f}`).join('\n')}

For each flow, provide:
1. Step-by-step journey (screen → action → screen)
2. Expected user emotions at each step (😊 confident → 😐 neutral → 😕 confused)
3. Potential friction points and drop-off risks
4. Cognitive load assessment (low/medium/high at each step)
5. Time estimate per step
6. Suggested improvements
7. Success metrics (completion rate target, time-to-complete target)

Also provide:
- Happy path diagram (text-based flowchart)
- Edge case paths
- Error recovery paths
- Accessibility flow notes`,
    }],
    max_tokens: 6000,
  });

  return { flows, simulation };
}

async function runResponsivePreview(input: {
  component: string;
  breakpoints?: Record<string, number>;
  framework?: string;
}) {
  logActivity('responsive-preview', 'thinking', 'Generating responsive specs');

  const breakpoints = input.breakpoints || {
    'mobile-sm': 320,
    'mobile': 375,
    'mobile-lg': 428,
    'tablet': 768,
    'laptop': 1024,
    'desktop': 1280,
    'desktop-lg': 1536,
    'ultrawide': 1920,
  };

  const specs = await chatCompletion({
    model: 'coder',
    messages: [{
      role: 'user',
      content: `Generate responsive layout specifications for: ${input.component}

Framework: ${input.framework || 'React + Tailwind CSS'}

Breakpoints:
${Object.entries(breakpoints).map(([name, px]) => `- ${name}: ${px}px`).join('\n')}

For each breakpoint, specify:
1. Layout changes (grid columns, flex direction, visibility)
2. Typography scale adjustments
3. Spacing modifications
4. Component-specific adaptations (stack, hide, reflow)
5. Touch target sizes (mobile ≥ 44px)
6. Image/media handling

Provide:
- Tailwind responsive classes for each breakpoint
- CSS Grid/Flexbox specifications
- Container query approach (where applicable)
- Testing checklist per breakpoint
- Common responsive pitfalls to avoid

Return as implementable code + specs.`,
    }],
  });

  return { breakpoints, specs };
}
