/**
 * Phase 6.3 — thin wrapper around sonner so the rest of the app does not
 * import the dependency directly. Centralizes how we surface errors from
 * structured edge function responses (`EdgeFunctionError`) and adds the
 * `hint` line as a sub-description so users see the actionable context.
 */
import { toast as sonnerToast } from 'sonner';
import { describeError, extractEdgeError, hasEdgeResponse } from './edgeError';

export interface NoticeOptions {
  hint?: string;
  duration?: number;
}

const SESSION_ENDED_TOAST = 'Your session has ended. Please sign in again.';

function showErrorObject(error: unknown, options?: NoticeOptions) {
  const desc = describeError(error);
  sonnerToast.error(desc.code === 'auth_failed' ? SESSION_ENDED_TOAST : desc.message, {
    description: options?.hint || desc.hint,
    duration: options?.duration,
  });
}

export function notifyError(messageOrError: unknown, options?: NoticeOptions) {
  // Raw supabase-js FunctionsHttpError: its message is the generic "Edge
  // Function returned a non-2xx status code". Read the structured body first.
  if (hasEdgeResponse(messageOrError)) {
    void extractEdgeError(messageOrError).then((edgeError) => showErrorObject(edgeError, options));
    return;
  }
  if (
    messageOrError &&
    typeof messageOrError === 'object' &&
    'message' in (messageOrError as object)
  ) {
    showErrorObject(messageOrError, options);
    return;
  }
  sonnerToast.error(String(messageOrError ?? 'Something went wrong'), {
    description: options?.hint,
    duration: options?.duration,
  });
}

export function notifySuccess(message: string, options?: NoticeOptions) {
  sonnerToast.success(message, {
    description: options?.hint,
    duration: options?.duration,
  });
}

export function notifyInfo(message: string, options?: NoticeOptions) {
  sonnerToast(message, {
    description: options?.hint,
    duration: options?.duration,
  });
}

export const toast = sonnerToast;
