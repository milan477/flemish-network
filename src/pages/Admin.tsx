import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bot, LayoutDashboard, Users } from 'lucide-react';
import {
  supabase,
  type FilterPreset,
  type Person,
} from '../lib/supabase';
import InteractiveStatsOverview from '../components/admin/InteractiveStatsOverview';
import { type ProfileSuggestion } from '../components/admin/SuggestedChanges';
import AgentDashboard from '../components/admin/AgentDashboard';
import DiscoveredContactsPanel from '../components/admin/DiscoveredContactsPanel';
import AccessManagementPanel from '../components/admin/AccessManagementPanel';
import {
  type PersonSectorRow,
} from '../components/admin/interactiveStatsShared';
import { type DerivedLabelSuggestion, normalizeDerivedLabelSuggestions } from '../lib/derivedLabels';
import { normalizeVerificationSuggestions } from '../lib/verification';
import { useAuth } from '../lib/auth';

type AdminTab = 'overview' | 'agents' | 'discovered' | 'access';
const VERIFY_BATCH_SIZE = 5;

interface AdminProps {
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}

export default function Admin({ onNavigate }: AdminProps) {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const activeTab: AdminTab =
    tab === 'agents' || tab === 'discovered' || (tab === 'access' && isAdmin)
      ? (tab as AdminTab)
      : 'overview';
  const [people, setPeople] = useState<Person[]>([]);
  const [orgCount, setOrgCount] = useState(0);
  const [personSectors, setPersonSectors] = useState<PersonSectorRow[]>([]);
  const [suggestions, setSuggestions] = useState<ProfileSuggestion[]>([]);
  const [derivedLabels, setDerivedLabels] = useState<DerivedLabelSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiLoadingIds, setAiLoadingIds] = useState<Set<string>>(new Set());
  const [noUpdateIds, setNoUpdateIds] = useState<Set<string>>(new Set());

  // Embedding backfill state
  const [embeddingProgress, setEmbeddingProgress] = useState<{ processed: number; total: number } | null>(null);
  const [embeddingRunning, setEmbeddingRunning] = useState(false);

  const loadSuggestions = useCallback(async () => {
    const { data } = await supabase
      .from('profile_suggestions')
      .select('*')
      .eq('status', 'pending')
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

  const loadDerivedLabels = useCallback(async () => {
    const { data } = await supabase
      .from('derived_label_suggestions')
      .select('*')
      .eq('status', 'pending')
      .not('person_id', 'is', null)
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

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [
        peopleRes,
        orgsRes,
        personSectorsRes,
      ] = await Promise.all([
        supabase
          .from('people')
          .select('*, locations(*), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))'),
        supabase
          .from('organizations')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('person_sectors')
          .select('person_id, sector_id, sectors(name)'),
      ]);

      setPeople((peopleRes.data || []) as Person[]);
      setOrgCount(orgsRes.count || 0);
      setPersonSectors((personSectorsRes.data || []) as unknown as PersonSectorRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadSuggestions();
    loadDerivedLabels();
  }, [loadData, loadSuggestions, loadDerivedLabels]);

  useEffect(() => {
    if (tab === 'access' && !isAdmin) {
      navigate('/admin', { replace: true });
    }
  }, [isAdmin, navigate, tab]);

  const handleAskAI = useCallback(
    async (personIds: string[]) => {
      setAiLoading(true);
      setAiLoadingIds(new Set(personIds));

      try {
        const idsWithoutSuggestions = new Set<string>();

        for (let index = 0; index < personIds.length; index += VERIFY_BATCH_SIZE) {
          const batch = personIds.slice(index, index + VERIFY_BATCH_SIZE);
          const { data, error } = await supabase.functions.invoke('agent-verify', {
            body: { person_ids: batch, batch_size: batch.length },
          });

          if (error) {
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
      } catch {
        // AI check failed
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
    await Promise.all([loadData(), loadSuggestions(), loadDerivedLabels()]);
  }, [loadData, loadSuggestions, loadDerivedLabels]);

  const handleTabChange = useCallback(
    (nextTab: AdminTab) => {
      navigate(nextTab === 'overview' ? '/admin' : `/admin/${nextTab}`);
    },
    [navigate]
  );

  const handleBackfillEmbeddings = useCallback(async () => {
    setEmbeddingRunning(true);
    setEmbeddingProgress({ processed: 0, total: 0 });

    try {
      const { data: statusData, error: statusError } = await supabase.functions.invoke('generate-embeddings', {
        body: { backfill: true, status_only: true },
      });

      if (statusError) throw statusError;

      const total = statusData?.remaining || 0;
      if (total === 0) {
        setEmbeddingProgress(null);
        setEmbeddingRunning(false);
        return;
      }

      let totalProcessed = 0;
      let remaining = total;

      while (remaining > 0) {
        const { data, error } = await supabase.functions.invoke('generate-embeddings', {
          body: { backfill: true, batch_size: 20 },
        });

        if (error) throw error;

        totalProcessed += data.processed || 0;
        remaining = data.remaining ?? 0;
        setEmbeddingProgress({ processed: totalProcessed, total });

        if ((data.processed || 0) === 0 && remaining > 0) {
          // Safety: avoid infinite loop if nothing is being processed
          break;
        }
      }
    } catch {
      // backfill failed
    }

    setEmbeddingRunning(false);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-semibold text-gray-900">
            Admin Dashboard
          </h1>
        </div>
        <p className="text-gray-600 mb-4">
          Monitor network statistics, plan discovery coverage, and manage contacts
        </p>

        <div className="flex gap-1 border-b border-gray-200">
          <button
            onClick={() => handleTabChange('overview')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Overview
          </button>
          <button
            onClick={() => handleTabChange('agents')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'agents'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Bot className="w-4 h-4" />
            Agents
          </button>
          <button
            onClick={() => handleTabChange('discovered')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'discovered'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users className="w-4 h-4" />
            Discovered
          </button>
          {isAdmin && (
            <button
              onClick={() => handleTabChange('access')}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'access'
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Users className="w-4 h-4" />
              Access
            </button>
          )}
        </div>
      </div>

      {activeTab === 'agents' && <AgentDashboard />}

      {activeTab === 'discovered' && <DiscoveredContactsPanel />}

      {activeTab === 'access' && isAdmin && <AccessManagementPanel />}

      {activeTab === 'overview' && (
        <InteractiveStatsOverview
          people={people}
          orgCount={orgCount}
          suggestions={suggestions}
          derivedLabels={derivedLabels}
          personSectors={personSectors}
          onNavigate={onNavigate}
          onReloadData={loadData}
          onAskAI={handleAskAI}
          onMarkCurrent={handleMarkCurrent}
          aiLoading={aiLoading}
          aiLoadingIds={aiLoadingIds}
          noUpdateIds={noUpdateIds}
          onSuggestionsRefresh={handleSuggestionsRefresh}
          onBackfillEmbeddings={handleBackfillEmbeddings}
          embeddingProgress={embeddingProgress}
          embeddingRunning={embeddingRunning}
        />
      )}
    </div>
  );
}
