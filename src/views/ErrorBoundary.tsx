/**
 * Error boundaries.
 *
 * Defense in depth for third-party data. The coercion layer in lib/members.ts
 * handles every hostile shape I could think of — but "every shape I could think
 * of" is exactly the wrong thing to bet a public directory on. Members self-host
 * their own JSON, so the first stranger to publish something unusual is the real
 * test.
 *
 * Without a boundary, one thrown render takes down the entire page for every
 * visitor. With one, a single bad member degrades to a small inline notice and
 * everyone else's profile still renders.
 *
 * React requires a class component for this; there is no hook equivalent.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown in place of the failed subtree. */
  fallback?: ReactNode;
  /** Helps a reader tell which member/section failed. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No telemetry is sent anywhere — the privacy page promises no analytics, and
    // that has to stay true. The console is the local-only record.
    console.error(`[Ledger] render failed${this.props.label ? ` in ${this.props.label}` : ''}:`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="render-error" role="alert">
        <strong>This section could not be displayed.</strong>
        <p>
          {this.props.label ? `${this.props.label} ` : ''}contains data this page could not render. Other
          profiles are unaffected. If this is your profile, re-run <code>npm run collect</code> and check the
          payload with <code>npm run consent:preview</code>.
        </p>
      </div>
    );
  }
}
