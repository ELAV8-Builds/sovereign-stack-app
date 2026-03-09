/**
 * DeployPhase — Phase 6: kick off deployment (local / docker / static)
 */
import { CheckIcon, XIcon, SpinnerIcon, RocketIcon } from "./Icons";
import type { DeployPhaseProps } from "./types";

const DEPLOY_TARGETS = [
  { id: "local", label: "Local Server", desc: "Serve on a local port", icon: "\uD83D\uDCBB" },
  { id: "docker", label: "Docker", desc: "Build & run a container", icon: "\uD83D\uDC33" },
  { id: "static", label: "Static Export", desc: "Copy to served directory", icon: "\uD83D\uDCE6" },
];

export function DeployPhase({
  deployTarget,
  setDeployTarget,
  deployResult,
  deploying,
  handleDeploy,
  handleReset,
}: DeployPhaseProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <RocketIcon />
        <div>
          <h2 className="text-lg font-semibold text-white">Deploy</h2>
          <p className="text-sm text-slate-400">Choose a deployment target and launch.</p>
        </div>
      </div>

      {/* Target selector */}
      <div className="grid grid-cols-3 gap-3">
        {DEPLOY_TARGETS.map((t) => (
          <button
            key={t.id}
            onClick={() => setDeployTarget(t.id)}
            className={`text-left p-4 rounded-xl border transition-all ${
              deployTarget === t.id
                ? "bg-indigo-500/10 border-indigo-500/40 ring-1 ring-indigo-500/20"
                : "bg-slate-900/50 border-white/[0.06] hover:border-white/[0.12]"
            }`}
          >
            <div className="text-lg mb-1">{t.icon}</div>
            <div className="text-sm font-medium text-white">{t.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">{t.desc}</div>
          </button>
        ))}
      </div>

      {/* Deploy button */}
      {!deployResult && (
        <button
          onClick={handleDeploy}
          disabled={deploying}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 hover:bg-indigo-400 disabled:bg-indigo-500/50 disabled:cursor-wait text-white rounded-lg text-sm font-medium transition-colors"
        >
          {deploying ? <><SpinnerIcon /> Deploying...</> : "Deploy Now"}
        </button>
      )}

      {/* Deploy result */}
      {deployResult && (
        <div className={`p-4 rounded-xl border ${
          deployResult.success
            ? "bg-emerald-500/10 border-emerald-500/30"
            : "bg-red-500/10 border-red-500/30"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {deployResult.success ? (
              <span className="text-emerald-400"><CheckIcon /></span>
            ) : (
              <span className="text-red-400"><XIcon /></span>
            )}
            <span className={`text-sm font-medium ${deployResult.success ? "text-emerald-300" : "text-red-300"}`}>
              {deployResult.success ? "Deployed!" : "Deploy failed"}
            </span>
          </div>

          {deployResult.url && (
            <div className="mt-2">
              <span className="text-xs text-slate-500">URL: </span>
              <a
                href={deployResult.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-indigo-400 hover:underline font-mono"
              >
                {deployResult.url}
              </a>
            </div>
          )}

          {deployResult.logs?.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400">
                Deploy logs ({deployResult.logs.length} entries)
              </summary>
              <pre className="text-xs text-slate-400 mt-2 whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">
                {deployResult.logs.join("\n")}
              </pre>
            </details>
          )}

          {deployResult.error && !deployResult.success && (
            <div className="text-xs text-red-400 mt-2 font-mono">{deployResult.error}</div>
          )}

          {/* Build another */}
          <button
            onClick={handleReset}
            className="mt-4 px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-slate-300 rounded-lg text-xs font-medium transition-colors"
          >
            Build Another Project
          </button>
        </div>
      )}
    </div>
  );
}
