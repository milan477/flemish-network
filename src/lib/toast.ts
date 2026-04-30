/**
 * Phase 6.3 — thin wrapper around sonner so the rest of the app does not
 * import the dependency directly. Centralizes how we surface errors from
 * structured edge function responses (`EdgeFunctionError`) and adds the
 * `hint` line as a sub-description so users see the actionable context.
 */
import { toast as sonnerToast } from 'sonner';
import { describeError } from './edgeError';

export interface NoticeOptions {
  hint?: string;
  duration?: number;
}

export function notifyError(messageOrError: unknown, options?: NoticeOptions) {
  if (
    messageOrError &&
    typeof messageOrError === 'object' &&
    'message' in (messageOrError as object)
  ) {
    const desc = describeError(messageOrError);
    sonnerToast.error(desc.message, {
      description: options?.hint || desc.hint,
      duration: options?.duration,
    });
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
