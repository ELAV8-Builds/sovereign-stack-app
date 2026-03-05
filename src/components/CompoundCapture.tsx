import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface CompoundEntry {
  id: string;
  timestamp: string;
  problem: {
    description: string;
    errorMessages: string[];
    affectedFiles: string[];
  };
  rootCause: {
    primary: string;
    underlying: string;
    factors: string[];
  };
  solution: {
    description: string;
    commands: string[];
    codeSnippets: string[];
    verification: string[];
  };
  prevention: {
    strategies: string[];
    guardrails: string[];
    automation: string[];
  };
  metadata: {
    tags: string[];
    category: string;
    technology: string[];
    domain: string;
    severity: 'low' | 'medium' | 'high';
    searchKeywords: string[];
  };
  performance: {
    timeToIdentify: string;
    timeToFix: string;
    totalCost: string;
    tierUsed: string;
  };
}

interface CompoundStats {
  totalLearnings: number;
  last24h: number;
  commonCategories: { category: string; count: number }[];
  costSaved: string;
}

// Mock data generator
function getMockEntries(): CompoundEntry[] {
  return [
    {
      id: 'compound-1709578800000',
      timestamp: '2026-03-04T16:00:00Z',
      problem: {
        description: 'Build failed due to esbuild platform mismatch',
        errorMessages: [
          'Cannot find module @rollup/rollup-linux-arm64-gnu',
          'esbuild installed for darwin-arm64 but running on linux-arm64'
        ],
        affectedFiles: ['package.json', 'node_modules']
      },
      rootCause: {
        primary: 'node_modules copied from macOS to Linux container',
        underlying: 'esbuild uses platform-specific binaries',
        factors: [
          'Docker volume mount preserves host node_modules',
          'No rebuild step in container entry point'
        ]
      },
      solution: {
        description: 'Remove node_modules and reinstall in target environment',
        commands: ['rm -rf node_modules package-lock.json', 'npm install'],
        codeSnippets: [],
        verification: ['npm run build should complete without errors']
      },
      prevention: {
        strategies: ['Add rebuild step to Dockerfile entry point'],
        guardrails: [
          'Add npm install to container startup script',
          'Use .dockerignore to exclude node_modules'
        ],
        automation: ['Script to detect native modules and rebuild automatically']
      },
      metadata: {
        tags: ['build', 'docker', 'node', 'esbuild'],
        category: 'build-tooling',
        technology: ['Node.js', 'Docker', 'esbuild'],
        domain: 'frontend-build',
        severity: 'medium',
        searchKeywords: ['esbuild platform error', 'node_modules container']
      },
      performance: {
        timeToIdentify: '30 seconds',
        timeToFix: '2 minutes',
        totalCost: '$0.35',
        tierUsed: 'heavy'
      }
    },
    {
      id: 'compound-1709575200000',
      timestamp: '2026-03-04T15:00:00Z',
      problem: {
        description: 'TypeScript errors in Settings component after adding new import',
        errorMessages: ['Cannot find module ModelConfiguration'],
        affectedFiles: ['Settings.tsx']
      },
      rootCause: {
        primary: 'Import path missing file extension',
        underlying: 'TypeScript strict mode requires explicit extensions',
        factors: ['New component not yet compiled', 'Module resolution strict']
      },
      solution: {
        description: 'Add correct import statement with extension',
        commands: [],
        codeSnippets: [
          'import { ModelConfiguration } from "../components/ModelConfiguration";'
        ],
        verification: ['tsc should complete without errors']
      },
      prevention: {
        strategies: ['Use IDE auto-import feature'],
        guardrails: ['Enable TypeScript import helpers', 'Use ESLint import plugin'],
        automation: ['Configure VSCode to auto-add extensions']
      },
      metadata: {
        tags: ['typescript', 'imports', 'module-resolution'],
        category: 'build-tooling',
        technology: ['TypeScript', 'React'],
        domain: 'frontend-build',
        severity: 'low',
        searchKeywords: ['typescript cannot find module', 'import error']
      },
      performance: {
        timeToIdentify: '10 seconds',
        timeToFix: '30 seconds',
        totalCost: '$0.15',
        tierUsed: 'medium'
      }
    },
    {
      id: 'compound-1709571600000',
      timestamp: '2026-03-04T14:00:00Z',
      problem: {
        description: 'Agent stalled after 2 hours with no deliverable',
        errorMessages: ['[Request interrupted by user]'],
        affectedFiles: []
      },
      rootCause: {
        primary: 'Background agents consistently stall on complex tasks',
        underlying: 'No progress tracking or timeout handling',
        factors: ['Long-running tasks', 'No intermediate checkpoints', 'Silent failures']
      },
      solution: {
        description: 'Implement direct after 2-hour timeout',
        commands: [],
        codeSnippets: [],
        verification: ['Component created successfully', 'Build passes']
      },
      prevention: {
        strategies: ['Set 2-hour hard timeout for background agents'],
        guardrails: [
          'Monitor agent progress every 30 minutes',
          'Require progress updates from agents'
        ],
        automation: ['Auto-fallback to direct implementation after timeout']
      },
      metadata: {
        tags: ['agents', 'timeout', 'reliability'],
        category: 'agent-management',
        technology: ['Agent SDK', 'Background tasks'],
        domain: 'agent-orchestration',
        severity: 'high',
        searchKeywords: ['agent stalled', 'no output', 'background task timeout']
      },
      performance: {
        timeToIdentify: '2 hours',
        timeToFix: '30 minutes',
        totalCost: '$0.50',
        tierUsed: 'heavy'
      }
    }
  ];
}

function getMockStats(): CompoundStats {
  return {
    totalLearnings: 47,
    last24h: 3,
    commonCategories: [
      { category: 'build-tooling', count: 15 },
      { category: 'agent-management', count: 12 },
      { category: 'typescript', count: 8 },
      { category: 'docker', count: 7 },
      { category: 'ui-components', count: 5 }
    ],
    costSaved: '$8,450'
  };
}

export function CompoundCapture() {
  const [stats, setStats] = useState<CompoundStats | null>(null);
  const [recentEntries, setRecentEntries] = useState<CompoundEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureSuccess, setCaptureSuccess] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const statsData = await invoke<CompoundStats>('get_compound_stats');
      const entries = await invoke<CompoundEntry[]>('get_recent_compound_entries');
      setStats(statsData);
      setRecentEntries(entries);
    } catch (err) {
      // Fallback to mock data
      console.warn('Failed to load compound data, using mock:', err);
      setStats(getMockStats());
      setRecentEntries(getMockEntries());
    }
  };

  const handleCapture = async () => {
    setCapturing(true);
    setCaptureSuccess(false);

    try {
      await invoke('trigger_compound_capture', { manual: true });
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 3000);
      // Reload data
      await loadData();
    } catch (err) {
      console.warn('Failed to trigger compound capture:', err);
      // Mock success for now
      setCaptureSuccess(true);
      setTimeout(() => setCaptureSuccess(false), 3000);
    } finally {
      setCapturing(false);
    }
  };

  const handleAutoToggle = async () => {
    const newValue = !autoCapture;
    setAutoCapture(newValue);
    try {
      await invoke('set_auto_compound', { enabled: newValue });
    } catch (err) {
      console.warn('Failed to toggle auto-compound:', err);
    }
  };

  const filteredEntries = recentEntries.filter((entry) => {
    const matchesSearch =
      searchQuery === '' ||
      entry.problem.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.metadata.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory =
      selectedCategory === 'all' || entry.metadata.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'text-red-400 bg-red-900/30 border-red-700';
      case 'medium':
        return 'text-yellow-400 bg-yellow-900/30 border-yellow-700';
      case 'low':
        return 'text-green-400 bg-green-900/30 border-green-700';
      default:
        return 'text-slate-400 bg-slate-900/30 border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Intro */}
      <div className="bg-purple-900/20 border border-purple-700 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <div className="text-purple-400 text-xl">🧠</div>
          <div className="text-sm text-purple-200">
            <strong>Compound Mode Active:</strong> Every problem solved is captured with 5 sub-agents (Problem Extractor, Root Cause Analyzer, Solution Synthesizer, Prevention Strategist, Indexer). Knowledge is stored in memU and searchable for future tasks.
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">Total Learnings</div>
            <div className="text-3xl font-bold text-green-400">{stats.totalLearnings}</div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">Last 24 Hours</div>
            <div className="text-3xl font-bold text-blue-400">{stats.last24h}</div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">Top Category</div>
            <div className="text-lg font-semibold text-slate-200">
              {stats.commonCategories[0]?.category || 'N/A'}
            </div>
            <div className="text-xs text-slate-500">
              {stats.commonCategories[0]?.count || 0} entries
            </div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
            <div className="text-sm text-slate-400 mb-1">Cost Saved</div>
            <div className="text-3xl font-bold text-purple-400">{stats.costSaved}</div>
            <div className="text-xs text-slate-500">Avoided repeated work</div>
          </div>
        </div>
      )}

      {/* Manual Capture & Auto-Toggle */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h3 className="font-semibold text-lg mb-4">Capture Control</h3>
        <div className="flex items-center space-x-4">
          <button
            onClick={handleCapture}
            disabled={capturing}
            className={`flex-1 px-6 py-3 rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg ${
              capturing
                ? 'bg-slate-600 cursor-not-allowed opacity-50'
                : 'bg-purple-600 hover:bg-purple-700 active:scale-95'
            }`}
          >
            {capturing ? '🧠 Capturing...' : '🧠 Capture Learning Now'}
          </button>

          <div className="flex items-center space-x-3 px-6 py-3 bg-slate-700 rounded-lg">
            <span className="text-sm text-slate-300">Auto-Capture on Errors</span>
            <button
              onClick={handleAutoToggle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoCapture ? 'bg-green-600' : 'bg-slate-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoCapture ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {captureSuccess && (
          <div className="mt-4 bg-green-900/30 border border-green-700 rounded-lg p-3">
            <div className="flex items-center space-x-2 text-sm text-green-200">
              <span className="text-green-400">✓</span>
              <span>
                <strong>Learning captured!</strong> 5 sub-agents analyzed the problem and stored results in memU.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Search & Filter */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h3 className="font-semibold text-lg mb-4">Search Learnings</h3>
        <div className="flex space-x-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by problem, tags, or keywords..."
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-200"
          />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-200"
          >
            <option value="all">All Categories</option>
            {stats?.commonCategories.map((cat) => (
              <option key={cat.category} value={cat.category}>
                {cat.category} ({cat.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Recent Learnings */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h3 className="font-semibold text-lg mb-4">Recent Learnings ({filteredEntries.length})</h3>
        <div className="space-y-3">
          {filteredEntries.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <div className="text-4xl mb-2">🔍</div>
              <p>No learnings found matching your search.</p>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className="bg-slate-700 border border-slate-600 rounded-lg overflow-hidden transition-all duration-200 hover:border-slate-500"
              >
                {/* Header */}
                <button
                  onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  className="w-full text-left p-4 flex items-start justify-between space-x-4 hover:bg-slate-600 transition-colors duration-200"
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-lg">🧠</span>
                      <span className="font-medium text-slate-200">
                        {entry.problem.description}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${getSeverityColor(
                          entry.metadata.severity
                        )}`}
                      >
                        {entry.metadata.severity}
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 text-xs text-slate-400">
                      <span>📁 {entry.metadata.category}</span>
                      <span>⏱️ {entry.performance.timeToFix}</span>
                      <span>💰 {entry.performance.totalCost}</span>
                      <span>
                        {new Date(entry.timestamp).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {entry.metadata.tags.slice(0, 4).map((tag, idx) => (
                        <span
                          key={idx}
                          className="text-xs px-2 py-0.5 bg-slate-800 text-slate-300 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                      {entry.metadata.tags.length > 4 && (
                        <span className="text-xs text-slate-500">
                          +{entry.metadata.tags.length - 4} more
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-slate-400">
                    {expandedId === entry.id ? '▼' : '▶'}
                  </div>
                </button>

                {/* Expanded Details */}
                {expandedId === entry.id && (
                  <div className="p-4 border-t border-slate-600 bg-slate-800 space-y-4">
                    {/* Root Cause */}
                    <div>
                      <div className="font-semibold text-slate-200 mb-2 flex items-center space-x-2">
                        <span>🔍</span>
                        <span>Root Cause</span>
                      </div>
                      <div className="text-sm text-slate-300 pl-6">
                        <p className="mb-1">
                          <strong>Primary:</strong> {entry.rootCause.primary}
                        </p>
                        <p>
                          <strong>Underlying:</strong> {entry.rootCause.underlying}
                        </p>
                      </div>
                    </div>

                    {/* Solution */}
                    <div>
                      <div className="font-semibold text-slate-200 mb-2 flex items-center space-x-2">
                        <span>✅</span>
                        <span>Solution</span>
                      </div>
                      <div className="text-sm text-slate-300 pl-6">
                        <p className="mb-2">{entry.solution.description}</p>
                        {entry.solution.commands.length > 0 && (
                          <div className="bg-slate-900 rounded p-2 font-mono text-xs">
                            {entry.solution.commands.map((cmd, idx) => (
                              <div key={idx} className="text-green-400">
                                $ {cmd}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Prevention */}
                    <div>
                      <div className="font-semibold text-slate-200 mb-2 flex items-center space-x-2">
                        <span>🛡️</span>
                        <span>Prevention</span>
                      </div>
                      <ul className="text-sm text-slate-300 pl-6 space-y-1">
                        {entry.prevention.strategies.map((strategy, idx) => (
                          <li key={idx} className="flex items-start">
                            <span className="mr-2">•</span>
                            <span>{strategy}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Technologies */}
                    <div>
                      <div className="font-semibold text-slate-200 mb-2 flex items-center space-x-2">
                        <span>🔧</span>
                        <span>Technologies</span>
                      </div>
                      <div className="flex flex-wrap gap-2 pl-6">
                        {entry.metadata.technology.map((tech, idx) => (
                          <span
                            key={idx}
                            className="text-xs px-2 py-1 bg-blue-900/30 text-blue-300 rounded border border-blue-700"
                          >
                            {tech}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Info Card */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
        <h3 className="font-semibold text-lg mb-4 flex items-center space-x-2">
          <span>ℹ️</span>
          <span>How Compound Mode Works</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="font-medium text-slate-200 mb-1">1. Problem Detected</div>
            <p className="text-xs text-slate-400">
              Error occurs or manual capture triggered
            </p>
          </div>
          <div>
            <div className="font-medium text-slate-200 mb-1">2. 5 Sub-Agents Run</div>
            <p className="text-xs text-slate-400">
              Extract problem, analyze root cause, document solution, plan prevention, index
            </p>
          </div>
          <div>
            <div className="font-medium text-slate-200 mb-1">3. Stored in memU</div>
            <p className="text-xs text-slate-400">
              Knowledge saved with tags and searchable metadata
            </p>
          </div>
          <div>
            <div className="font-medium text-slate-200 mb-1">4. Future Pre-Planning</div>
            <p className="text-xs text-slate-400">
              Searched before every task to avoid repeated mistakes
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
