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
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-center p-8">
          <div className="max-w-lg bg-slate-800 rounded-lg p-8 border-2 border-red-600">
            <h1 className="text-2xl font-bold mb-4 text-red-400">Something went wrong</h1>
            <p className="text-slate-300 mb-4">
              The application encountered an unexpected error. Please try restarting the app.
            </p>
            {this.state.error && (
              <details className="bg-slate-900 rounded p-4 text-sm">
                <summary className="cursor-pointer font-semibold mb-2">Error Details</summary>
                <pre className="text-red-400 whitespace-pre-wrap overflow-auto max-h-64">
                  {this.state.error.message}
                  {"\n\n"}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <button
              onClick={() => window.location.reload()}
              className="mt-6 w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium transition"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
