/**
 * Subscribes to `agent_runs` for the given agent_type and reports whether any
 * row is currently `pending` or `running`. Used by staff UIs to disable run
 * buttons while a job is in flight (UX_REMEDIATION Phase 1B).
 *
 * Uses both an initial fetch and a Supabase realtime channel so the value
 * updates immediately when a run starts or completes.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const ACTIVE_STATUSES = ['pending', 'running'] as const;

export function useActiveAgentRun(agentType: string): boolean {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const { data } = await supabase
        .from('agent_runs')
        .select('id')
        .eq('agent_type', agentType)
        .in('status', ACTIVE_STATUSES as unknown as string[])
        .limit(1);
      if (cancelled) return;
      setIsActive((data ?? []).length > 0);
    };

    void refresh();

    const channel = supabase
      .channel(`agent_runs:${agentType}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_runs',
          filter: `agent_type=eq.${agentType}`,
        },
        () => {
          void refresh();
        }
      )
      .subscribe();

    // Belt-and-suspenders: poll every 10s in case the realtime channel drops.
    const poll = window.setInterval(() => {
      void refresh();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [agentType]);

  return isActive;
}
