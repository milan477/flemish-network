import type { AuthError } from '@supabase/supabase-js';

export const USED_SIGN_IN_LINK_MESSAGE =
  'This email link has already been used or has expired. Enter your email and choose Reset Password to receive a new link.';

export const EMAIL_RATE_LIMIT_MESSAGE =
  'Too many sign-in emails were sent in the last hour. Please wait an hour, then choose Reset Password again.';

// Supabase Auth reports a failed invite or recovery link in the redirect URL
// (hash for the implicit flow, query for PKCE) and clears the local session.
export function describeSignInLinkError(hash: string, search: string): string | null {
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(search);
  const code = hashParams.get('error_code') ?? queryParams.get('error_code');
  const description =
    hashParams.get('error_description') ?? queryParams.get('error_description');

  if (!code && !description) return null;
  if (code === 'otp_expired') return USED_SIGN_IN_LINK_MESSAGE;
  return description || 'This email link could not be used. Choose Reset Password to receive a new link.';
}

export function describeAuthEmailError(error: AuthError): string {
  if (error.code === 'over_email_send_rate_limit') return EMAIL_RATE_LIMIT_MESSAGE;
  return error.message;
}
