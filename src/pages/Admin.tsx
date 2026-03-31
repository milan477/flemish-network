import { useEffect, useState, useCallback } from 'react';
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
import {
  type PersonSectorRow,
} from '../components/admin/interactiveStatsShared';

type AdminTab = 'overview' | 'agents' | 'discovered';
const VERIFY_BATCH_SIZE = 5;

interface AdminProps {
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}

export default function Admin({ onNavigate }: AdminProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [people, setPeople] = useState<Person[]>([]);
  const [orgCount, setOrgCount] = useState(0);
  const [personSectors, setPersonSectors] = useState<PersonSectorRow[]>([]);
  const [suggestions, setSuggestions] = useState<ProfileSuggestion[]>([]);
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
      data.map((s) => ({
        ...s,
        person_name: nameMap[s.person_id] || 'Unknown',
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
  }, [loadData, loadSuggestions]);

  const handleAskAI = useCallback(
    async (personIds: string[]) => {
      setAiLoading(true);
      setAiLoadingIds(new Set(personIds));

      try {
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-verify`;
        const idsWithoutSuggestions = new Set<string>();

        for (let index = 0; index < personIds.length; index += VERIFY_BATCH_SIZE) {
          const batch = personIds.slice(index, index + VERIFY_BATCH_SIZE);
          const resp = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ person_ids: batch, batch_size: batch.length }),
          });

          if (!resp.ok) {
            continue;
          }

          const data = await resp.json();
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
    await Promise.all([loadData(), loadSuggestions()]);
  }, [loadData, loadSuggestions]);

  const handleBackfillEmbeddings = useCallback(async () => {
    setEmbeddingRunning(true);
    setEmbeddingProgress({ processed: 0, total: 0 });

    try {
      // First call to get total count
      const { count } = await supabase
        .from('people')
        .select('id', { count: 'exact', head: true })
        .or('embedding.is.null,embedding_dirty_at.gt.embedding_generated_at');

      const total = count || 0;
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
          Monitor network statistics and manage contacts
        </p>

        <div className="flex gap-1 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('overview')}
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
            onClick={() => setActiveTab('agents')}
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
            onClick={() => setActiveTab('discovered')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'discovered'
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users className="w-4 h-4" />
            Discovered
          </button>
        </div>
      </div>

      {activeTab === 'agents' && <AgentDashboard />}

      {activeTab === 'discovered' && <DiscoveredContactsPanel />}

      {activeTab === 'overview' && (
        <InteractiveStatsOverview
          people={people}
          orgCount={orgCount}
          suggestions={suggestions}
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
