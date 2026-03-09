/**
 * AppBuilder — 6-phase project creation wizard
 *
 * Phases:
 *   1. Describe  — user describes what they want to build
 *   2. Template  — pick a starter template + name the project
 *   3. Build     — scaffold + install dependencies (terminal-style output)
 *   4. Validate  — run build-validator, show step-by-step pass/fail
 *   5. Review    — summary card with project metadata
 *   6. Deploy    — kick off deployment (local / docker / static)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import {
  listTemplates,
  createWorkspace,
  getWorkspace,
  validateWorkspace,
  deployWorkspace,
  type WorkspaceTemplate,
  type Workspace,
  type BuildReport,
} from "@/lib/workspace";

import { PHASES } from "./types";
import type { Phase } from "./types";
import { PhaseStepper } from "./PhaseStepper";
import { DescribePhase } from "./DescribePhase";
import { TemplatePhase } from "./TemplatePhase";
import { BuildPhase } from "./BuildPhase";
import { ValidatePhase } from "./ValidatePhase";
import { ReviewPhase } from "./ReviewPhase";
import { DeployPhase } from "./DeployPhase";
import { NavigationFooter } from "./NavigationFooter";

// ── Main Component ──────────────────────────────────────────────────────

export function AppBuilder() {
  const [phase, setPhase] = useState<Phase>("describe");
  const [completedPhases, setCompletedPhases] = useState<Set<Phase>>(new Set());

  // ── Phase 1: Describe
  const [description, setDescription] = useState("");

  // ── Phase 2: Template
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("react-vite-ts");
  const [projectName, setProjectName] = useState("");
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // ── Phase 3: Build
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [building, setBuilding] = useState(false);
  const buildLogRef = useRef<HTMLDivElement>(null);

  // ── Phase 4: Validate
  const [buildReport, setBuildReport] = useState<BuildReport | null>(null);
  const [validating, setValidating] = useState(false);

  // ── Phase 6: Deploy
  const [deployResult, setDeployResult] = useState<any>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployTarget, setDeployTarget] = useState<string>("local");

  // ── Load templates on mount ───────────────────────────────────────────

  useEffect(() => {
    setLoadingTemplates(true);
    listTemplates()
      .then(setTemplates)
      .catch((err) => {
        console.warn("Failed to load templates:", err);
        // Provide fallback templates when API is unavailable
        setTemplates([
          { id: "react-vite-ts", name: "React + Vite + TypeScript", description: "Full React app with TypeScript, Vite, and TailwindCSS", icon: "\u269B\uFE0F", category: "frontend" },
          { id: "express-api", name: "Express API", description: "RESTful API with Express.js, TypeScript, and validation", icon: "\uD83D\uDD0C", category: "backend" },
          { id: "static-site", name: "Static Site", description: "Simple HTML/CSS/JS static website", icon: "\uD83D\uDCC4", category: "frontend" },
          { id: "blank", name: "Blank Project", description: "Empty project \u2014 start from scratch", icon: "\uD83D\uDCC1", category: "other" },
        ]);
      })
      .finally(() => setLoadingTemplates(false));
  }, []);

  // ── Auto-scroll build logs ────────────────────────────────────────────

  useEffect(() => {
    if (buildLogRef.current) {
      buildLogRef.current.scrollTop = buildLogRef.current.scrollHeight;
    }
  }, [buildLogs]);

  // ── Phase index for stepper ───────────────────────────────────────────

  const phaseIndex = PHASES.findIndex((p) => p.id === phase);

  // ── Phase transition helpers ──────────────────────────────────────────

  const completePhase = (current: Phase) => {
    setCompletedPhases((prev) => new Set([...prev, current]));
  };

  const goNext = () => {
    const idx = PHASES.findIndex((p) => p.id === phase);
    if (idx < PHASES.length - 1) {
      completePhase(phase);
      setPhase(PHASES[idx + 1].id);
    }
  };

  const goBack = () => {
    const idx = PHASES.findIndex((p) => p.id === phase);
    if (idx > 0) {
      setPhase(PHASES[idx - 1].id);
    }
  };

  // ── Phase 3: Create workspace + scaffold ──────────────────────────────

  const handleBuild = useCallback(async () => {
    if (!projectName.trim()) {
      toast.error("Please enter a project name");
      return;
    }

    setBuilding(true);
    setBuildLogs(["[scaffold] Creating workspace..."]);

    try {
      const ws = await createWorkspace(
        projectName.trim(),
        selectedTemplate,
        description || undefined,
      );
      setWorkspace(ws);
      setBuildLogs((prev) => [...prev, `[scaffold] Workspace created: ${ws.slug}`, `[scaffold] Template: ${selectedTemplate}`, "[scaffold] Scaffolding files..."]);

      // Poll workspace status until scaffolding is complete
      let attempts = 0;
      const maxAttempts = 60; // 30 seconds

      const poll = async (): Promise<Workspace> => {
        const updated = await getWorkspace(ws.id);
        if (updated.status === "scaffolding" && attempts < maxAttempts) {
          attempts++;
          setBuildLogs((prev) => [...prev, `[scaffold] Waiting... (${attempts}s)`]);
          await new Promise((r) => setTimeout(r, 500));
          return poll();
        }
        return updated;
      };

      const final = await poll();
      setWorkspace(final);

      if (final.status === "ready") {
        const bs = final.build_status as any;
        setBuildLogs((prev) => [
          ...prev,
          `[scaffold] \u2713 Files created: ${bs?.filesCreated ?? "unknown"}`,
          "[scaffold] \u2713 Project ready",
          "",
          "Scaffolding complete. Proceed to validation \u2192",
        ]);
      } else {
        const bs = final.build_status as any;
        setBuildLogs((prev) => [
          ...prev,
          `[scaffold] \u2717 Status: ${final.status}`,
          ...(bs?.errors?.map((e: string) => `[error] ${e}`) || []),
        ]);
      }
    } catch (err: any) {
      setBuildLogs((prev) => [...prev, `[error] ${err.message}`]);
      toast.error("Build failed \u2014 check logs");
    } finally {
      setBuilding(false);
    }
  }, [projectName, selectedTemplate, description]);

  // ── Phase 4: Run validation ───────────────────────────────────────────

  const handleValidate = useCallback(async () => {
    if (!workspace) return;

    setValidating(true);
    setBuildReport(null);

    try {
      const report = await validateWorkspace(workspace.id);
      setBuildReport(report);

      if (report.status === "passing") {
        toast.success("All checks passed!");
      } else if (report.status === "warning") {
        toast("Validation passed with warnings", { icon: "\u26A0\uFE0F" });
      } else {
        toast.error("Validation failed \u2014 check results");
      }
    } catch (err: any) {
      toast.error(`Validation error: ${err.message}`);
    } finally {
      setValidating(false);
    }
  }, [workspace]);

  // ── Phase 6: Deploy ───────────────────────────────────────────────────

  const handleDeploy = useCallback(async () => {
    if (!workspace) return;

    setDeploying(true);
    setDeployResult(null);

    try {
      const result = await deployWorkspace(workspace.id, deployTarget);
      setDeployResult(result);

      if (result.success) {
        toast.success(`Deployed to ${result.url || result.target}!`);
      } else {
        toast.error(`Deploy failed: ${result.error}`);
      }
    } catch (err: any) {
      toast.error(`Deploy error: ${err.message}`);
      setDeployResult({ success: false, error: err.message, logs: [] });
    } finally {
      setDeploying(false);
    }
  }, [workspace, deployTarget]);

  // ── Reset wizard ──────────────────────────────────────────────────────

  const handleReset = () => {
    setPhase("describe");
    setCompletedPhases(new Set());
    setDescription("");
    setSelectedTemplate("react-vite-ts");
    setProjectName("");
    setWorkspace(null);
    setBuildLogs([]);
    setBuildReport(null);
    setDeployResult(null);
  };

  // ── Can advance? ──────────────────────────────────────────────────────

  const canAdvance = (): boolean => {
    switch (phase) {
      case "describe": return description.trim().length > 5;
      case "template": return !!selectedTemplate && projectName.trim().length > 0;
      case "build": return workspace?.status === "ready";
      case "validate": return buildReport?.status === "passing" || buildReport?.status === "warning";
      case "review": return true;
      case "deploy": return !!deployResult?.success;
      default: return false;
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-hidden">
      {/* ── Phase Stepper ────────────────────────────────────────────── */}
      <PhaseStepper
        phases={PHASES}
        currentPhase={phase}
        completedPhases={completedPhases}
        phaseIndex={phaseIndex}
        setPhase={setPhase}
      />

      {/* ── Phase Content ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {phase === "describe" && (
            <DescribePhase
              description={description}
              setDescription={setDescription}
            />
          )}

          {phase === "template" && (
            <TemplatePhase
              projectName={projectName}
              setProjectName={setProjectName}
              templates={templates}
              selectedTemplate={selectedTemplate}
              setSelectedTemplate={setSelectedTemplate}
              loadingTemplates={loadingTemplates}
            />
          )}

          {phase === "build" && (
            <BuildPhase
              projectName={projectName}
              selectedTemplate={selectedTemplate}
              buildLogs={buildLogs}
              building={building}
              buildLogRef={buildLogRef}
              handleBuild={handleBuild}
            />
          )}

          {phase === "validate" && (
            <ValidatePhase
              buildReport={buildReport}
              validating={validating}
              handleValidate={handleValidate}
            />
          )}

          {phase === "review" && (
            <ReviewPhase
              workspace={workspace}
              buildReport={buildReport}
              description={description}
            />
          )}

          {phase === "deploy" && (
            <DeployPhase
              deployTarget={deployTarget}
              setDeployTarget={setDeployTarget}
              deployResult={deployResult}
              deploying={deploying}
              handleDeploy={handleDeploy}
              handleReset={handleReset}
            />
          )}
        </div>
      </div>

      {/* ── Navigation Footer ────────────────────────────────────────── */}
      <NavigationFooter
        phase={phase}
        phaseIndex={phaseIndex}
        totalPhases={PHASES.length}
        canAdvance={canAdvance()}
        building={building}
        validating={validating}
        deploying={deploying}
        buildLogs={buildLogs}
        buildReport={buildReport}
        deployResult={deployResult}
        goBack={goBack}
        goNext={goNext}
        handleBuild={handleBuild}
        handleValidate={handleValidate}
        handleDeploy={handleDeploy}
      />
    </div>
  );
}
