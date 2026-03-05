import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-center p-8" role="alert">
          <div className="max-w-lg bg-slate-800 rounded-xl p-8 border-2 border-red-500 shadow-2xl">
            <div className="text-center mb-4">
              <div className="text-6xl mb-4">⚠️</div>
              <h1 className="text-3xl font-bold mb-2 text-red-400">Something went wrong</h1>
            </div>
            <p className="text-slate-300 mb-6 text-center">
              The application encountered an unexpected error. Please try restarting the app.
            </p>
            {this.state.error && (
              <details className="bg-slate-900 rounded-lg p-4 text-sm mb-6 border border-slate-700">
                <summary className="cursor-pointer font-semibold mb-2 text-slate-400 hover:text-slate-300">
                  🔍 Error Details
                </summary>
                <pre className="text-red-400 whitespace-pre-wrap overflow-auto max-h-64 text-xs leading-relaxed mt-2">
                  {this.state.error.message}
                  {"\n\n"}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Reload application"
            >
              🔄 Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
