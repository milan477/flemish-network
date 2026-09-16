import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import InteractiveStatsOverview from './admin/InteractiveStatsOverview';
import LoadingGlobe from './LoadingGlobe';
import type { PersonSectorRow } from './admin/interactiveStatsShared';
import { supabase, type FilterPreset, type Person } from '../lib/supabase';

interface NetworkStatsProps {
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}

interface OrganizationLocation {
  locations: { city: string | null; state: string | null } | null;
}

export default function NetworkStats({ onNavigate }: NetworkStatsProps) {
  const [people, setPeople] = useState<Person[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationLocation[]>([]);
  const [organizationCount, setOrganizationCount] = useState(0);
  const [personSectors, setPersonSectors] = useState<PersonSectorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadStats = async () => {
      setLoading(true);
      setError(null);
      const [peopleResult, organizationsResult, sectorsResult] = await Promise.all([
        supabase
          .from('people')
          .select('*, locations(*), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))'),
        supabase
          .from('organizations')
          .select('id, locations(city, state)', { count: 'exact' }),
        supabase
          .from('person_sectors')
          .select('person_id, sector_id, sectors(name)'),
      ]);

      if (!active) return;
      const loadError = peopleResult.error || organizationsResult.error || sectorsResult.error;
      if (loadError) {
        setError(loadError.message);
      } else {
        setPeople((peopleResult.data || []) as Person[]);
        setOrganizations((organizationsResult.data || []) as unknown as OrganizationLocation[]);
        setOrganizationCount(organizationsResult.count || 0);
        setPersonSectors((sectorsResult.data || []) as unknown as PersonSectorRow[]);
      }
      setLoading(false);
    };

    void loadStats();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingGlobe className="h-8 w-8" label="Loading statistics" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <AlertCircle className="h-5 w-5" />
        Network statistics could not be loaded: {error}
      </div>
    );
  }

  return (
    <InteractiveStatsOverview
      people={people}
      orgCount={organizationCount}
      organizations={organizations}
      personSectors={personSectors}
      onNavigate={onNavigate}
    />
  );
}
