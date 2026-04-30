import { AlertTriangle, X } from 'lucide-react';
import { describeError } from '../../lib/edgeError';

interface Props {
  error: unknown;
  title?: string;
  onDismiss?: () => void;
  className?: string;
}

const CODE_LABEL: Record<string, string> = {
  auth_failed: 'Authentication failed',
  forbidden: 'Permission denied',
  invalid_input: 'Invalid input',
  not_found: 'Not found',
  quota_exhausted: 'Quota exhausted',
  network: 'Network error',
  db_timeout: 'Database timeout',
  agent_failure: 'Agent failure',
  unknown: 'Error',
};

/**
 * Phase 6.3 shared error display. Surfaces `{ code, message, hint }` from
 * `EdgeFunctionError` so admin panels (SystemHealthPanel, AgentDashboard,
 * ProfileUpdateModal) all render the same shape and the hint line points
 * the user at the matching docs/RUNBOOK.md entry.
 */
export default function StructuredErrorBanner({
  error,
  title,
  onDismiss,
  className,
}: Props) {
  if (!error) return null;
  const desc = describeError(error);
  const heading = title || (desc.code ? CODE_LABEL[desc.code] || 'Error' : 'Error');

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900 ${className || ''}`}
    >
      <AlertTriangle className="mt-0.5 flex-shrink-0 text-red-500" size={18} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{heading}</span>
          {desc.code && (
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-800">
              {desc.code}
            </span>
          )}
        </div>
        <div className="mt-0.5 break-words">{desc.message}</div>
        {desc.hint && (
          <div className="mt-1 text-xs text-red-800/80 break-words">{desc.hint}</div>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-red-500 hover:text-red-700"
          aria-label="Dismiss error"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
