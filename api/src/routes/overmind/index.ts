/**
 * Overmind Routes — Barrel Export
 *
 * Mounts all Overmind sub-routers onto a single parent router.
 * All routes are served under `/api/overmind`.
 */
import { Router } from 'express';
import { chatRouter as overmindChatRouter } from './chat';
import { jobsRouter } from './jobs';
import { tasksRouter } from './tasks';
import { agentsRouter } from './agents';
import { skillsRouter } from './skills-routes';
import { systemRouter } from './system';
import { rulesRouter } from './rules';
import { recipesRouter } from './recipes';
import { fleetRouter } from './fleet';

export const overmindRouter = Router();

// Chat gateway — the primary interface for all conversations
overmindRouter.use(overmindChatRouter);

overmindRouter.use(jobsRouter);
overmindRouter.use(tasksRouter);
overmindRouter.use(agentsRouter);
overmindRouter.use(skillsRouter);
overmindRouter.use(systemRouter);
overmindRouter.use(rulesRouter);
overmindRouter.use(recipesRouter);
overmindRouter.use(fleetRouter);
