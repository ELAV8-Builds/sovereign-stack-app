/**
 * Overmind Routes — Recipes
 *
 * CRUD endpoints for build recipes, plus matching and application.
 * Recipes capture HOW to build something: tools, rules, steps,
 * iteration config, and LLM tier preferences.
 */
import { Router, Request, Response } from 'express';
import {
  createRecipe,
  getRecipe,
  listRecipes,
  updateRecipe,
  deleteRecipe,
  findMatchingRecipes,
  recordRecipeUsage,
  recipeToJobConfig,
  BUILT_IN_RECIPES,
  type CreateRecipeInput,
} from '../../services/overmind/recipes';
import { badRequest, notFound } from './helpers';
import type { TargetType } from '../../services/overmind/types';

export const recipesRouter = Router();

// ── GET /recipes — List all recipes ──────────────────────────────────

recipesRouter.get('/recipes', async (req: Request, res: Response) => {
  const targetType = req.query.target_type as TargetType | undefined;

  try {
    const recipes = await listRecipes(targetType);
    res.json({ recipes, total: recipes.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to list recipes: ${err}` });
  }
});

// ── GET /recipes/:id — Get a single recipe ───────────────────────────

recipesRouter.get('/recipes/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const recipe = await getRecipe(id);
    if (!recipe) return notFound(res, 'Recipe');
    res.json(recipe);
  } catch (err) {
    res.status(500).json({ error: `Failed to get recipe: ${err}` });
  }
});

// ── POST /recipes — Create a new recipe ──────────────────────────────

recipesRouter.post('/recipes', async (req: Request, res: Response) => {
  const { name, target_type } = req.body || {};

  if (!name || typeof name !== 'string') {
    return badRequest(res, 'name is required');
  }
  if (!target_type || typeof target_type !== 'string') {
    return badRequest(res, 'target_type is required');
  }

  try {
    const recipe = await createRecipe(req.body as CreateRecipeInput);
    res.status(201).json(recipe);
  } catch (err) {
    res.status(500).json({ error: `Failed to create recipe: ${err}` });
  }
});

// ── PATCH /recipes/:id — Update a recipe ─────────────────────────────

recipesRouter.patch('/recipes/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const updated = await updateRecipe(id, req.body);
    if (!updated) return notFound(res, 'Recipe');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: `Failed to update recipe: ${err}` });
  }
});

// ── DELETE /recipes/:id — Delete a recipe ────────────────────────────

recipesRouter.delete('/recipes/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const deleted = await deleteRecipe(id);
    if (!deleted) return notFound(res, 'Recipe');
    res.json({ deleted: true, id });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete recipe: ${err}` });
  }
});

// ── GET /recipes/match — Find matching recipes ───────────────────────

recipesRouter.get('/recipes/match', async (req: Request, res: Response) => {
  const targetType = req.query.target_type as TargetType;
  const description = req.query.description as string | undefined;

  if (!targetType) {
    return badRequest(res, 'target_type query parameter is required');
  }

  try {
    const matches = await findMatchingRecipes(targetType, description);
    res.json({ matches, total: matches.length });
  } catch (err) {
    res.status(500).json({ error: `Failed to find matching recipes: ${err}` });
  }
});

// ── POST /recipes/:id/apply — Use a recipe for a new job ────────────

recipesRouter.post('/recipes/:id/apply', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const recipe = await getRecipe(id);
    if (!recipe) return notFound(res, 'Recipe');

    // Convert recipe to job config format
    const jobConfig = recipeToJobConfig(recipe);

    // Record usage
    await recordRecipeUsage(recipe.id);

    res.json({
      recipe_id: recipe.id,
      recipe_name: recipe.name,
      job_config: jobConfig,
      message: `Recipe "${recipe.name}" applied. Use this config when creating a job.`,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to apply recipe: ${err}` });
  }
});

// ── POST /recipes/seed — Seed built-in recipes ──────────────────────

recipesRouter.post('/recipes/seed', async (_req: Request, res: Response) => {
  try {
    const created = [];
    for (const template of BUILT_IN_RECIPES) {
      const recipe = await createRecipe(template);
      created.push(recipe);
    }
    res.json({ seeded: true, count: created.length, recipes: created });
  } catch (err) {
    res.status(500).json({ error: `Failed to seed recipes: ${err}` });
  }
});
