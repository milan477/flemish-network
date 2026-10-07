import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useActiveAgentRun,
  useActiveAgentRunCount,
  useVerificationQueueCount,
} from '../hooks/useActiveAgentRun';
import { Activity, ChevronDown, ChevronRight, FileUp, Earth, Search, ShieldCheck } from 'lucide-react';
import {
  supabase,
  type Person,
  type Sector,
} from '../lib/supabase';
import PersonChangesGroup, { type ProfileSuggestion } from '../components/admin/PersonChangesGroup';
import OrganizationSuggestedChanges, {
  type OrganizationProfileSuggestion,
} from '../components/admin/OrganizationSuggestedChanges';
import AgentDashboard from '../components/admin/AgentDashboard';
import DiscoveredContactsPanel from '../components/admin/DiscoveredContactsPanel';
import SystemHealthPanel from '../components/admin/SystemHealthPanel';
import AddContactPanel from '../components/admin/AddContactPanel';
import StaleContactsBar from '../components/admin/StaleContactsBar';
import DiscoveryPlanningPanel, { type RecommendedAction } from '../components/admin/DiscoveryPlanningPanel';
import { type DerivedLabelSuggestion, normalizeDerivedLabelSuggestions } from '../lib/derivedLabels';
import { discoveryCooldownHint } from '../lib/schedulerMessages';
import { normalizeVerificationSuggestions } from '../lib/verification';
import { notifyError, notifySuccess, notifyInfo } from '../lib/toast';
import LoadingGlobe from '../components/LoadingGlobe';
import {
  isCanonicalExpandTab,
  normalizeExpandTab,
  parseAdminDiscoveryPrompt,
  parseAddContactMode,
  type ExpandTab,
  type AddContactMode,
} from '../lib/appRouting';
const VERIFY_BATCH_SIZE = 5;

export default function Admin() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeExpandTab(tab);
  const discoveryPrompt = parseAdminDiscoveryPrompt(searchParams);
  const addContactMode = parseAddContactMode(searchParams);
  const importMode: AddContactMode = addContactMode === 'import' ? 'import' : 'manual';
  const discoveryRunActive = useActiveAgentRun('discovery');
  const activeRunCount = useActiveAgentRunCount();
  const verificationQueueCount = useVerificationQueueCount();

  const setAddContactMode = useCallback(
    (next: AddContactMode) => {
      const nextParams = new URLSearchParams(searchParams);
      if (next === 'discovery') {
        nextParams.delete('mode');
      } else {
        nextParams.set('mode', next);
      }
      // Clear prompt when switching off the discovery sub-tab so a stale
      // prefill does not reappear next time the user comes back.
      if (next !== 'discovery') {
        nextParams.delete('prompt');
      }
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );
  const [people, setPeople] = useState<Person[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [suggestions, setSuggestions] = useState<ProfileSuggestion[]>([]);
  const [orgSuggestions, setOrgSuggestions] = useState<OrganizationProfileSuggestion[]>([]);
  const [derivedLabels, setDerivedLabels] = useState<DerivedLabelSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [discoveryRefreshKey, setDiscoveryRefreshKey] = useState(0);
  const [profileSectionOpen, setProfileSectionOpen] = useState(true);
  const [orgSectionOpen, setOrgSectionOpen] = useState(true);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
  const [noUpdateIds, setNoUpdateIds] = useState<Set<string>>(new Set());

  const loadSuggestions = useCallback(async () => {
    const { data } = await supabase
      .from('profile_suggestions')
      .select('*')
      .eq('status', 'pending')
      .eq('record_type', 'person')
      .order('created_at', { ascending: false });

    if (!data || data.length === 0) {
      setSuggestions([]);
      return;
    }

    const personIds = [...new Set(data.map((s) => s.person_id))];
    const { data: peopleData } = await supabase
      .from('people').select('id, name, location_id, locations(*)')
      .in('id', personIds);

    const nameMap: Record<string, string> = {};
    (peopleData || []).forEach((p: { id: string; name: string }) => {
      nameMap[p.id] = p.name;
    });

    setSuggestions(
      normalizeVerificationSuggestions(data).map((suggestion) => ({
        ...suggestion,
        id: suggestion.id || '',
        person_id: suggestion.person_id || '',
        status: suggestion.status || 'pending',
        created_at: suggestion.created_at || new Date().toISOString(),
        person_name: nameMap[suggestion.person_id || ''] || 'Unknown',
      }))
    );
  }, []);

  const loadOrgSuggestions = useCallback(async () => {
    const { data } = await supabase
      .from('profile_suggestions')
      .select('*')
      .eq('status', 'pending')
      .eq('record_type', 'organization')
      .order('created_at', { ascending: false });

    if (!data || data.length === 0) {
      setOrgSuggestions([]);
      return;
    }

    const orgIds = [
      ...new Set(
        data
          .map((row) => row.organization_id)
          .filter((id): id is string => typeof id === 'string')
      ),
    ];

    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, name')
      .in('id', orgIds);

    const nameMap: Record<string, string> = {};
    (orgs || []).forEach((org: { id: string; name: string }) => {
      nameMap[org.id] = org.name;
    });

    setOrgSuggestions(
      data.map((row) => ({
        id: typeof row.id === 'string' ? row.id : '',
        organization_id: typeof row.organization_id === 'string' ? row.organization_id : '',
        field_name: typeof row.field_name === 'string' ? row.field_name : '',
        current_value: typeof row.current_value === 'string' ? row.current_value : null,
        suggested_value: typeof row.suggested_value === 'string' ? row.suggested_value : '',
        source: typeof row.source === 'string' ? row.source : null,
        status: typeof row.status === 'string' ? row.status : 'pending',
        created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
        evidence_url: typeof row.evidence_url === 'string' ? row.evidence_url : null,
        evidence_excerpt: typeof row.evidence_excerpt === 'string' ? row.evidence_excerpt : null,
        confidence: typeof row.confidence === 'number' ? row.confidence : null,
        method: typeof row.method === 'string' ? row.method : null,
        agent_run_id: typeof row.agent_run_id === 'string' ? row.agent_run_id : null,
        dedupe_key: typeof row.dedupe_key === 'string' ? row.dedupe_key : null,
        organization_name:
          typeof row.organization_id === 'string'
            ? nameMap[row.organization_id] || 'Unknown organization'
            : 'Unknown organization',
      }))
    );
  }, []);

  const loadDerivedLabels = useCallback(async () => {
    const { data } = await supabase
      .from('derived_label_suggestions')
      .select('*')
      .eq('status', 'pending')
      .not('person_id', 'is', null)
      .not('label_type', 'in', '("source_quality","profile_confidence")')
      .order('created_at', { ascending: false });

    if (!data || data.length === 0) {
      setDerivedLabels([]);
      return;
    }

    const personIds = [
      ...new Set(
        data
          .map((label) => label.person_id)
          .filter((personId): personId is string => typeof personId === 'string')
      ),
    ];
    const { data: peopleData } = await supabase
      .from('people')
      .select('id, name')
      .in('id', personIds);

    const nameMap: Record<string, string> = {};
    (peopleData || []).forEach((person: { id: string; name: string }) => {
      nameMap[person.id] = person.name;
    });

    setDerivedLabels(
      normalizeDerivedLabelSuggestions(data).map((label) => ({
        ...label,
        person_name: label.person_id ? nameMap[label.person_id] || 'Unknown' : undefined,
      }))
    );
  }, []);

  const loadData = useCallback(async (options?: { showSpinner?: boolean }) => {
    const showSpinner = options?.showSpinner ?? true;
    if (showSpinner) {
      setLoading(true);
    }

    try {
      const [peopleRes, sectorsRes] = await Promise.all([
        supabase
          .from('people')
          .select('*, locations(*), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))'),
        supabase.from('sectors').select('*').order('name'),
      ]);

      setPeople((peopleRes.data || []) as Person[]);
      setSectors((sectorsRes.data || []) as Sector[]);
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
    loadSuggestions();
    loadOrgSuggestions();
    loadDerivedLabels();
  }, [loadData, loadSuggestions, loadOrgSuggestions, loadDerivedLabels]);

  useEffect(() => {
    if (tab === 'running') {
      navigate('/expand/runs', { replace: true });
    } else if (tab && !isCanonicalExpandTab(tab)) {
      navigate('/expand/discovery', { replace: true });
    }
  }, [navigate, tab]);

  const handleAskAI = useCallback(
    async (personIds: string[]) => {
      setAiLoading(true);
      setAiLoadingIds(new Set(personIds));

      try {
        const idsWithoutSuggestions = new Set<string>();
        let failedBatches = 0;

        for (let index = 0; index < personIds.length; index += VERIFY_BATCH_SIZE) {
          const batch = personIds.slice(index, index + VERIFY_BATCH_SIZE);
          const { data, error } = await supabase.functions.invoke('agent-verify', {
            body: { person_ids: batch, batch_size: batch.length },
          });

          if (error) {
            failedBatches += 1;
            continue;
          }

          if (!Array.isArray(data?.steps)) {
            continue;
          }

          data.steps.forEach((step: { person_id?: string; status?: string }) => {
            if (
              step.person_id &&
              (step.status === 'verified' || step.status === 'no_results')
            ) {
              idsWithoutSuggestions.add(step.person_id);
            }
          });
        }

        if (idsWithoutSuggestions.size > 0) {
          setNoUpdateIds((prev) => {
            const next = new Set(prev);
            idsWithoutSuggestions.forEach((id) => next.add(id));
            return next;
          });
        }
        if (failedBatches > 0) {
          notifyError('Some verification batches failed.', {
            hint: `${failedBatches} batch${failedBatches === 1 ? '' : 'es'} could not be checked.`,
          });
        }
      } catch (err) {
        console.warn('[Admin] verification suggestion check failed (non-fatal)', err);
        notifyError(err, { hint: 'Could not complete the verification suggestion check.' });
      }

      setAiLoading(false);
      setAiLoadingIds(new Set());
      await loadSuggestions();
    },
    [loadSuggestions]
  );

  const handleMarkCurrent = useCallback(
    async (personId: string) => {
      await supabase
        .from('people')
        .update({ 
          last_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString() 
        })
        .eq('id', personId);
      setNoUpdateIds((prev) => {
        const next = new Set(prev);
        next.delete(personId);
        return next;
      });
      await loadData();
    },
    [loadData]
  );

  const handleSuggestionsRefresh = useCallback(async () => {
    await Promise.all([
      loadData(),
      loadSuggestions(),
      loadOrgSuggestions(),
      loadDerivedLabels(),
    ]);
  }, [loadData, loadSuggestions, loadOrgSuggestions, loadDerivedLabels]);

  const handleTabChange = useCallback(
    (nextTab: ExpandTab) => {
      navigate(`/expand/${nextTab}`);
    },
    [navigate]
  );

  const handleSchedulerResponse = useCallback(
    (
      data: { status?: string; reason?: string; message?: string; wait_minutes?: number } | null,
      successMessage: string,
    ): boolean => {
      const status = data?.status;
      if (status === 'running') {
        notifySuccess(successMessage);
        return true;
      }
      if (status === 'rejected') {
        const reason = data?.reason;
        if (reason === 'quota_exhausted') {
          notifyInfo('Discovery already ran recently.', {
            hint: discoveryCooldownHint(data?.wait_minutes),
          });
          return false;
        }
        notifyError(data?.message || 'Discovery run was rejected.', {
          hint: reason ? `Reason: ${reason}` : undefined,
        });
        return false;
      }
      // Unknown / undefined status — treat as soft failure so the user always
      // gets feedback (Phase 1B contract: every action button needs a toast).
      notifyError('Discovery run did not start.', {
        hint: 'The scheduler returned an unexpected response. Check the Discovery History panel.',
      });
      return false;
    },
    []
  );

  const triggerDiscovery = useCallback(async (action: RecommendedAction) => {
    try {
      const { data, error } = await supabase.functions.invoke('agent-scheduler', {
        body: {
          action: 'trigger',
          agent_type: 'discovery',
          params: {
            query: action.query,
            ...(action.basis !== undefined ? { basis: action.basis } : {}),
            ...(action.target !== undefined ? { target: action.target } : {}),
            ...(action.rationale !== undefined ? { rationale: action.rationale } : {}),
          },
        },
      });
      if (error) throw error;
      if (handleSchedulerResponse(data, 'Discovery run started.')) {
        navigate('/expand/runs');
      }
    } catch (err) {
      notifyError(err, { hint: 'Could not start discovery from this recommendation.' });
    }
  }, [handleSchedulerResponse, navigate]);

  const startDiscoveryRun = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('agent-scheduler', {
        body: {
          action: 'trigger',
          agent_type: 'discovery',
          params: {},
        },
      });
      if (error) throw error;
      if (handleSchedulerResponse(data, 'Discovery run started.')) {
        navigate('/expand/runs');
      }
    } catch (err) {
      notifyError(err, { hint: 'Could not start a discovery run.' });
    }
  }, [handleSchedulerResponse, navigate]);

  const exploreSuggestion = useCallback(
    async (suggestionId: string, surface: string | null, lens: string | null) => {
      try {
        const { data, error } = await supabase.functions.invoke('agent-scheduler', {
          body: {
            action: 'trigger',
            agent_type: 'discovery',
            params: {
              suggestion_id: suggestionId,
              ...(surface ? { surface } : {}),
              ...(lens ? { lens } : {}),
            },
          },
        });
        if (error) throw error;
        if (handleSchedulerResponse(data, 'Exploring this suggestion now.')) {
          navigate('/expand/runs');
        }
      } catch (err) {
        notifyError(err, { hint: 'Could not start discovery on this suggestion.' });
      }
    },
    [handleSchedulerResponse, navigate]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingGlobe label="Loading workspace" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-semibold text-gray-900">
            Grow
          </h1>
        </div>

        <div className="flex gap-1 border-b border-gray-200">
          <button
            onClick={() => handleTabChange('import')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'import'
                ? 'border-yellow-500 text-yellow-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileUp className="w-4 h-4" />
            Import
          </button>
          <button
            onClick={() => handleTabChange('discovery')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'discovery'
                ? 'border-yellow-500 text-yellow-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Search className="w-4 h-4" />
            Discovery
          </button>
          <button
            onClick={() => handleTabChange('verification')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'verification'
                ? 'border-yellow-500 text-yellow-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Verification
            {verificationQueueCount > 0 && (
              <span
                className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  activeTab === 'verification'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-gray-100 text-gray-700'
                }`}
                aria-label={`${verificationQueueCount} records need verification`}
                title={`${verificationQueueCount} records need verification`}
              >
                {verificationQueueCount > 99 ? '99+' : verificationQueueCount}
              </span>
            )}
          </button>
          <button
            onClick={() => handleTabChange('maintenance')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'maintenance'
                ? 'border-yellow-500 text-yellow-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Activity className="w-4 h-4" />
            Maintenance
          </button>
          <button
            onClick={() => handleTabChange('runs')}
            className={`ml-auto flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'runs'
                ? 'border-yellow-500 text-yellow-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Earth className={`w-4 h-4 ${activeRunCount > 0 ? 'animate-spin' : ''}`} />
            Runs
            {activeRunCount > 0 && (
              <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                activeTab === 'runs'
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-gray-100 text-gray-700'
              }`}>
                {activeRunCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'import' && (
        <AddContactPanel
          sectors={sectors}
          onContactAdded={() => void loadData({ showSpinner: false })}
          mode={importMode}
          onModeChange={setAddContactMode}
          availableModes={['manual', 'import']}
        />
      )}

      {activeTab === 'discovery' && (
        <div className="space-y-6">
          <AddContactPanel
            sectors={sectors}
            onContactAdded={() => {
              loadData({ showSpinner: false });
              setDiscoveryRefreshKey((current) => current + 1);
            }}
            onDiscoveryStarted={() => navigate('/expand/verification')}
            mode="discovery"
            availableModes={['discovery']}
            initialDiscoveryPrompt={discoveryPrompt}
            discoveryRunActive={discoveryRunActive}
          />
          <DiscoveryPlanningPanel
            onRunDiscovery={(action) => void triggerDiscovery(action)}
            onStartDiscovery={() => void startDiscoveryRun()}
            onExploreSuggestion={(id, surface, lens) => void exploreSuggestion(id, surface, lens)}
            isRunning={discoveryRunActive}
          />
        </div>
      )}

      {activeTab === 'runs' && (
        <AgentDashboard historyScope="all" refreshKey={activeRunCount} />
      )}

      {activeTab === 'verification' && (
        <DiscoveredContactsPanel refreshKey={discoveryRefreshKey} />
      )}

      {activeTab === 'maintenance' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Records Freshness</h2>
            <StaleContactsBar
              people={people}
              onRefresh={loadData}
              onAskAI={handleAskAI}
              onMarkCurrent={handleMarkCurrent}
              aiLoading={aiLoading}
              aiLoadingIds={aiLoadingIds}
              noUpdateIds={noUpdateIds}
            />
          </div>
          <SystemHealthPanel mode="maintenance" />
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <button
              onClick={() => setProfileSectionOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-6 py-4 text-left hover:bg-gray-50"
            >
              {profileSectionOpen
                ? <ChevronDown className="h-4 w-4 text-gray-400" />
                : <ChevronRight className="h-4 w-4 text-gray-400" />
              }
              <h2 className="text-lg font-semibold text-gray-900">Profile Update Suggestions</h2>
            </button>
            {profileSectionOpen && (
              <div className="px-6 pb-6">
                <PersonChangesGroup
                  profileSuggestions={suggestions}
                  derivedLabels={derivedLabels}
                  onRefresh={handleSuggestionsRefresh}
                />
              </div>
            )}
          </div>
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <button
              onClick={() => setOrgSectionOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-6 py-4 text-left hover:bg-gray-50"
            >
              {orgSectionOpen
                ? <ChevronDown className="h-4 w-4 text-gray-400" />
                : <ChevronRight className="h-4 w-4 text-gray-400" />
              }
              <h2 className="text-lg font-semibold text-gray-900">Organization Update Suggestions</h2>
            </button>
            {orgSectionOpen && (
              <div className="px-6 pb-6">
                <OrganizationSuggestedChanges
                  suggestions={orgSuggestions}
                  onRefresh={handleSuggestionsRefresh}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
