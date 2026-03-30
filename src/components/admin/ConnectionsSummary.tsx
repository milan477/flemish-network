import { FolderOpen, Link2, Network } from 'lucide-react';
import type { Person } from '../../lib/supabase';
import type { ConnectionStatsRow } from './interactiveStatsShared';

interface ConnectionsSummaryProps {
  connections: ConnectionStatsRow[];
  people: Person[];
  allPeople: Person[];
  inCollectionSet: Set<string>;
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  colleague: 'Colleagues',
  alumni: 'Alumni',
  local_peer: 'Local Peers',
};

function summarizeConnections(
  connections: ConnectionStatsRow[],
  validIds: Set<string>
): Map<string, number> {
  const counts = new Map<string, number>();

  connections.forEach((connection) => {
    if (!connection.from_person_id || !connection.to_person_id) return;
    if (
      !validIds.has(connection.from_person_id) ||
      !validIds.has(connection.to_person_id)
    ) {
      return;
    }

    const key = connection.relationship_type || 'other';
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return counts;
}

function countCollectionCoverage(people: Person[], inCollectionSet: Set<string>) {
  return people.filter((person) => inCollectionSet.has(person.id)).length;
}

export default function ConnectionsSummary({
  connections,
  people,
  allPeople,
  inCollectionSet,
}: ConnectionsSummaryProps) {
  const filteredIds = new Set(people.map((person) => person.id));
  const allIds = new Set(allPeople.map((person) => person.id));

  const filteredCounts = summarizeConnections(connections, filteredIds);
  const totalCounts = summarizeConnections(connections, allIds);

  const relationKeys = [
    'colleague',
    'alumni',
    'local_peer',
    ...Array.from(totalCounts.keys()).filter(
      (key) => !['colleague', 'alumni', 'local_peer'].includes(key)
    ),
  ].filter((key, index, array) => array.indexOf(key) === index);

  const filteredCoverage = countCollectionCoverage(people, inCollectionSet);
  const totalCoverage = countCollectionCoverage(allPeople, inCollectionSet);

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">
          Connections Summary
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Internal links among the people currently in scope.
        </p>
      </div>

      <div className="space-y-3 mb-5">
        {relationKeys.map((key) => {
          const count = filteredCounts.get(key) || 0;
          const totalCount = totalCounts.get(key) || 0;
          const label = RELATIONSHIP_LABELS[key] || key.replace(/_/g, ' ');

          if (totalCount === 0) return null;

          return (
            <div
              key={key}
              className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-600">
                  <Link2 className="w-4 h-4" />
                </div>
                <span className="text-sm font-medium text-gray-800 capitalize">
                  {label}
                </span>
              </div>
              <span className="text-sm font-semibold text-gray-900">
                {count === totalCount ? count : `${count} / ${totalCount}`}
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <div className="flex items-center gap-2 text-blue-700 mb-2">
            <Network className="w-4 h-4" />
            <span className="text-sm font-medium">Connected People</span>
          </div>
          <p className="text-2xl font-semibold text-blue-950">
            {filteredIds.size}
          </p>
        </div>

        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-emerald-700 mb-2">
            <FolderOpen className="w-4 h-4" />
            <span className="text-sm font-medium">Collection Coverage</span>
          </div>
          <p className="text-2xl font-semibold text-emerald-950">
            {people.length === 0
              ? '0%'
              : `${Math.round((filteredCoverage / people.length) * 100)}%`}
          </p>
          <p className="text-xs text-emerald-800 mt-1">
            {filteredCoverage === totalCoverage && people.length === allPeople.length
              ? `${filteredCoverage} people in at least one collection`
              : `${filteredCoverage} / ${people.length} in scope`}
          </p>
        </div>
      </div>
    </div>
  );
}
