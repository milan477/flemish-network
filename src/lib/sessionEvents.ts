/**
 * Edge functions validate the caller with Supabase Auth (`auth.getUser`),
 * which rejects a JWT whose server-side session was revoked (for example by a
 * sign-out on another device). PostgREST only checks the JWT signature and
 * expiry, so the rest of the app keeps working with such a token until it
 * expires. A 401 from an edge function is therefore the first reliable signal
 * that the session is gone; the AuthProvider subscribes here and re-checks the
 * session with Supabase Auth.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function onEdgeAuthFailure(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyEdgeAuthFailure(): void {
  listeners.forEach((listener) => listener());
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Wraps fetch so any 401 from `<supabaseUrl>/functions/v1/*` notifies the
 * auth-failure listeners. The response is returned untouched.
 */
export function createSessionAwareFetch(
  supabaseUrl: string,
  baseFetch: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  const edgeFunctionsPrefix = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/`;
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status === 401 && requestUrl(input).startsWith(edgeFunctionsPrefix)) {
      notifyEdgeAuthFailure();
    }
    return response;
  };
}
