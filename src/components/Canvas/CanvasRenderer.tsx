/**
 * Canvas — Spec renderer area (rendered JSON UI or empty placeholder)
 */
import { Renderer, JSONUIProvider } from "@json-render/react";
import { canvasRegistry } from "@/lib/canvas-catalog";
import { SparkleIcon } from "./Icons";
import type { CanvasRendererProps } from "./types";

export function CanvasRenderer({ activeSpec, isGenerating }: CanvasRendererProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      {activeSpec ? (
        <div className="max-w-5xl mx-auto">
          <JSONUIProvider registry={canvasRegistry}>
            <Renderer
              spec={activeSpec}
              registry={canvasRegistry}
              loading={isGenerating}
            />
          </JSONUIProvider>
        </div>
      ) : !isGenerating ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-slate-500">
              <SparkleIcon />
            </div>
            <p className="text-sm text-slate-400 mb-1">This page is empty</p>
            <p className="text-xs text-slate-500">
              Describe what you want to build below
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
