import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// React error boundaries must be class components — there's no hook
// equivalent. Without this, any uncaught exception anywhere in the render
// tree unmounts the whole app with zero on-screen feedback: a blank white
// window and no way to tell what happened. This turns that into a visible,
// readable error instead, and is the only way to actually see what crashed
// rather than guessing from a description of "it went white."
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Only surface to the dev console — this app has no telemetry (see
    // CLAUDE.md's offline constraint), so this is purely for whoever's
    // looking at the terminal/devtools when it happens.
    console.error("Unhandled error in render tree:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-8">
        <div className="max-w-lg w-full space-y-4">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle size={20} />
            <h1 className="text-lg font-semibold">Something went wrong</h1>
          </div>
          <p className="text-sm text-neutral-400">
            DiscoSync hit an unexpected error and can't continue safely. Reloading will bring you back
            to the last saved state — nothing you saved is affected.
          </p>
          <pre className="text-xs text-neutral-500 bg-neutral-900 border border-neutral-800 rounded-md p-3 overflow-auto max-h-48 whitespace-pre-wrap">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-neutral-800 hover:bg-neutral-700 px-4 py-2 text-sm transition-colors"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
