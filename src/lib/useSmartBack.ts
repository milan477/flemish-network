import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface RouteState {
  from?: string;
}

export function useSmartBack(fallback: string | (() => string)) {
  const location = useLocation();
  const navigate = useNavigate();

  return useCallback(() => {
    const state = location.state as RouteState | null;
    const from = state?.from;

    if (typeof from === 'string' && from.startsWith('/')) {
      navigate(from);
      return;
    }

    const target = typeof fallback === 'function' ? fallback() : fallback;
    navigate(target);
  }, [fallback, location.state, navigate]);
}
