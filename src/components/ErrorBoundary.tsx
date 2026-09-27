import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Keeps a route or lazy-chunk failure from leaving customers on a blank page. */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SmartLine could not render the page.', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-6">
        <div role="alert" className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold">This page could not load</h1>
          <p className="text-muted-foreground">Reload the page to try again. If you were placing an order, check your recent orders before submitting it again.</p>
          <button
            type="button"
            className="rounded-xl bg-primary px-5 py-3 text-primary-foreground font-medium"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
        </div>
      </main>
    );
  }
}
