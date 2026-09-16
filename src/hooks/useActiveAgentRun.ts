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
const VERIFICATION_QUEUE_STATUSES = ['queued', 'verifying', 'verified', 'failed'] as const;

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

/**
 * Reports the total number of agent runs that are still pending or running.
 * Used by the Expand navigation badge and the Runs tab.
 */
export function useActiveAgentRunCount(): number {
  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const { count } = await supabase
        .from('agent_runs')
        .select('id', { count: 'exact', head: true })
        .in('status', ACTIVE_STATUSES as unknown as string[]);
      if (cancelled) return;
      setActiveCount(count ?? 0);
    };

    void refresh();

    const channel = supabase
      .channel('agent_runs:active-count')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_runs',
        },
        () => {
          void refresh();
        }
      )
      .subscribe();

    const poll = window.setInterval(() => {
      void refresh();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, []);

  return activeCount;
}

/**
 * Counts discovered people and organizations still present in Verification.
 * This includes records waiting for automated verification, failed records,
 * and verified records awaiting an Approve/Reject/Merge decision.
 */
export function useVerificationQueueCount(): number {
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const [peopleResult, organizationResult] = await Promise.all([
        supabase
          .from('discovered_contacts')
          .select('id', { count: 'exact', head: true })
          .in('verification_status', VERIFICATION_QUEUE_STATUSES as unknown as string[])
          .is('approved_person_id', null),
        supabase
          .from('discovered_organizations')
          .select('id', { count: 'exact', head: true })
          .in('verification_status', VERIFICATION_QUEUE_STATUSES as unknown as string[])
          .is('approved_organization_id', null),
      ]);
      if (cancelled) return;
      setQueueCount((peopleResult.count ?? 0) + (organizationResult.count ?? 0));
    };

    void refresh();

    const channel = supabase
      .channel('verification:queue-count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'discovered_contacts' },
        () => void refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'discovered_organizations' },
        () => void refresh()
      )
      .subscribe();

    const poll = window.setInterval(() => {
      void refresh();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, []);

  return queueCount;
}
