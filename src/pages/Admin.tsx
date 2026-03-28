import { useEffect, useState, useCallback } from 'react';
import {
  Users,
  Building2,
  MapPin,
  Clock,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { supabase, type Person } from '../lib/supabase';
import OccupationOverview from '../components/admin/OccupationOverview';
import StaleContactsBar from '../components/admin/StaleContactsBar';
import SuggestedChanges, {
  type ProfileSuggestion,
} from '../components/admin/SuggestedChanges';

interface SectorCount {
  name: string;
  count: number;
  color: string;
}

interface LocationCount {
  city: string;
  state: string;
  count: number;
}

const SECTOR_COLORS: Record<string, string> = {
  'Artificial Intelligence': 'bg-blue-500',
  Biotechnology: 'bg-green-500',
  Finance: 'bg-amber-500',
  Education: 'bg-yellow-500',
  'Culture & Arts': 'bg-pink-500',
  Research: 'bg-cyan-500',
};

export default function Admin() {
  const [people, setPeople] = useState<Person[]>([]);
  const [orgCount, setOrgCount] = useState(0);
  const [sectorCounts, setSectorCounts] = useState<SectorCount[]>([]);
  const [topLocations, setTopLocations] = useState<LocationCount[]>([]);
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
    const [peopleRes, orgsRes, , psRes] = await Promise.all([
      supabase.from('people').select('*, locations(*)'),
      supabase.from('organizations').select('id, location_id, locations(*)'),
      supabase.from('sectors').select('*'),
      supabase.from('person_sectors').select('sector_id, sectors(name)'),
    ]);

    const allPeople = (peopleRes.data || []) as Person[];
    setPeople(allPeople);
    setOrgCount(orgsRes.data?.length || 0);

    const scMap: Record<string, number> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (psRes.data || []).forEach((row: any) => {
      const name = row.sectors?.name;
      if (name) scMap[name] = (scMap[name] || 0) + 1;
    });
    setSectorCounts(
      Object.entries(scMap)
        .map(([name, count]) => ({
          name,
          count,
          color: SECTOR_COLORS[name] || 'bg-gray-400',
        }))
        .sort((a, b) => b.count - a.count)
    );

    const locMap: Record<string, number> = {};
    allPeople.forEach((p) => {
      if (p.locations?.city) {
        const key = `${p.locations?.city}|${p.locations?.state || ''}`;
        locMap[key] = (locMap[key] || 0) + 1;
      }
    });
    setTopLocations(
      Object.entries(locMap)
        .map(([key, count]) => {
          const [city, state] = key.split('|');
          return { city, state, count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    );

    setLoading(false);
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
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-profile`;
        const resp = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            personIds.length === 1
              ? { personId: personIds[0] }
              : { personIds }
          ),
        });

        if (resp.ok) {
          const data = await resp.json();
          const zeroIds: string[] = [];
          if (data.results && Array.isArray(data.results)) {
            data.results.forEach(
              (r: { suggestionsCount: number }, i: number) => {
                if (r.suggestionsCount === 0 && personIds[i]) {
                  zeroIds.push(personIds[i]);
                }
              }
            );
          }
          if (zeroIds.length > 0) {
            setNoUpdateIds((prev) => {
              const next = new Set(prev);
              zeroIds.forEach((id) => next.add(id));
              return next;
            });
          }
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

  const cityCount = new Set(
    people.filter((p) => p.locations?.city).map((p) => p.locations?.city)
  ).size;
  const stateCount = new Set(
    people.filter((p) => p.locations?.state).map((p) => p.locations?.state)
  ).size;
  const maxSectorCount = sectorCounts[0]?.count || 1;
  const pendingSuggestionCount = suggestions.filter(
    (s) => s.status === 'pending'
  ).length;

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
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Admin Dashboard
        </h1>
        <p className="text-gray-600">
          Monitor network statistics and manage contacts
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={Users}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
          value={people.length}
          label="Total People"
        />
        <StatCard
          icon={Building2}
          iconBg="bg-green-100"
          iconColor="text-green-600"
          value={orgCount}
          label="Organizations"
        />
        <StatCard
          icon={MapPin}
          iconBg="bg-cyan-100"
          iconColor="text-cyan-600"
          value={cityCount}
          label="Cities"
          subtext={`${stateCount} states`}
        />
        <StatCard
          icon={Clock}
          iconBg="bg-yellow-100"
          iconColor="text-yellow-600"
          value={pendingSuggestionCount}
          label="Pending Updates"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <OccupationOverview people={people} />

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Profiles by Sector
          </h2>
          <div className="space-y-3">
            {sectorCounts.map((sector) => (
              <div key={sector.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-700">{sector.name}</span>
                  <span className="text-sm font-medium text-gray-900">
                    {sector.count}
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={`${sector.color} h-2 rounded-full transition-all duration-700`}
                    style={{
                      width: `${(sector.count / maxSectorCount) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            {sectorCounts.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">
                No sector data available
              </p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Top Locations
          </h2>
          <div className="space-y-2.5">
            {topLocations.map((loc) => (
              <div
                key={`${loc.city}-${loc.state}`}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-900">
                    {loc.city}
                    {loc.state && `, ${loc.state}`}
                  </span>
                </div>
                <span className="text-sm font-semibold text-gray-900">
                  {loc.count}
                </span>
              </div>
            ))}
            {topLocations.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">
                No location data
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Pending Updates
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            Contact freshness and AI-suggested changes
          </p>

          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Contact Freshness
            </h3>
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

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Suggested Profile Changes
            </h3>
            <SuggestedChanges
              suggestions={suggestions}
              onRefresh={handleSuggestionsRefresh}
            />
          </div>

          <div className="mt-6 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Embedding Search Index
            </h3>
            <div className="flex items-center gap-4">
              <button
                onClick={handleBackfillEmbeddings}
                disabled={embeddingRunning}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
              >
                {embeddingRunning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {embeddingRunning ? 'Generating...' : 'Generate Embeddings'}
              </button>
              {embeddingProgress && (
                <div className="flex-1 max-w-xs">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Progress</span>
                    <span>
                      {embeddingProgress.processed} / {embeddingProgress.total}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-teal-500 h-2 rounded-full transition-all duration-500"
                      style={{
                        width: `${embeddingProgress.total > 0 ? (embeddingProgress.processed / embeddingProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              {embeddingProgress && !embeddingRunning && embeddingProgress.processed > 0 && (
                <span className="text-xs text-green-600 font-medium">
                  Done — {embeddingProgress.processed} profiles indexed
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  iconBg,
  iconColor,
  value,
  label,
  subtext,
}: {
  icon: typeof Users;
  iconBg: string;
  iconColor: string;
  value: number;
  label: string;
  subtext?: string;
}) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center space-x-3">
        <div
          className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}
        >
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <div>
          <p className="text-xl font-semibold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500">
            {label}
            {subtext && <span className="text-gray-400"> · {subtext}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}
