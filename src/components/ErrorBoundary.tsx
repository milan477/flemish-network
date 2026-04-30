import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Copy, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Optional label so multi-mount boundaries identify themselves in the copy block. */
  scope?: string;
}

interface State {
  error: Error | null;
  componentStack: string;
  copied: boolean;
}

/**
 * Phase 6.3 — last-resort fallback so a render crash never produces a blank
 * white screen. Includes a one-click copy block (message + stack + scope +
 * UA + URL) so the user can paste the failure into a bug report when handing
 * off operations to the Delegation IT team.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '', copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack || '' });
    console.error('[ErrorBoundary]', this.props.scope || 'app', error, info);
  }

  private buildReport(): string {
    const { error, componentStack } = this.state;
    const url = typeof window !== 'undefined' ? window.location.href : '(no window)';
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '(no navigator)';
    const at = new Date().toISOString();
    return [
      `Scope: ${this.props.scope || 'app'}`,
      `When: ${at}`,
      `URL: ${url}`,
      `UA: ${ua}`,
      `Error: ${error?.name}: ${error?.message}`,
      '',
      'Stack:',
      error?.stack || '(no stack)',
      '',
      'Component stack:',
      componentStack || '(none)',
    ].join('\n');
  }

  private handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(this.buildReport());
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (err) {
      console.error('[ErrorBoundary] failed to copy report', err);
    }
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-2xl w-full bg-white rounded-lg shadow-md border border-red-200 p-6">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="text-red-500 flex-shrink-0 mt-1" size={24} />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
              <p className="text-sm text-gray-600 mt-1">
                The page encountered an unexpected error. You can copy the details below
                and share them with IT, or reload the app to try again.
              </p>
            </div>
          </div>

          <pre className="bg-gray-900 text-gray-100 text-xs rounded p-3 overflow-auto max-h-64 mb-4 whitespace-pre-wrap break-words">
            {this.buildReport()}
          </pre>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleCopy}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium"
            >
              <Copy size={16} />
              {this.state.copied ? 'Copied!' : 'Copy error report'}
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-medium"
            >
              <RefreshCw size={16} />
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
