import type { Person } from '../../lib/supabase';
import { FLEMISH_OPTIONS } from '../../lib/supabase';
import { getPersonFlemishConnectionNames } from '../../lib/flemishConnections';
import InteractiveBarChart, {
  type InteractiveBarChartItem,
} from './InteractiveBarChart';

interface FlemishConnectionChartProps {
  people: Person[];
  allPeople: Person[];
  activeConnection: string | null;
  onBarClick: (key: string) => void;
  onViewInNetwork: (key: string) => void;
}

const COLORS = [
  'bg-violet-500',
  'bg-indigo-500',
  'bg-sky-500',
  'bg-cyan-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-slate-500',
];

function buildCounts(people: Person[]): Map<string, number> {
  const counts = new Map<string, number>();

  people.forEach((person) => {
    getPersonFlemishConnectionNames(person).forEach((name) => {
      counts.set(name, (counts.get(name) || 0) + 1);
    });
  });

  return counts;
}

export default function FlemishConnectionChart({
  people,
  allPeople,
  activeConnection,
  onBarClick,
  onViewInNetwork,
}: FlemishConnectionChartProps) {
  const filteredCounts = buildCounts(people);
  const totalCounts = buildCounts(allPeople);

  const orderedKeys = [
    ...FLEMISH_OPTIONS,
    ...Array.from(totalCounts.keys())
      .filter((key) => !FLEMISH_OPTIONS.includes(key))
      .sort((a, b) => (totalCounts.get(b) || 0) - (totalCounts.get(a) || 0)),
  ].filter((key, index, array) => array.indexOf(key) === index);

  const items: InteractiveBarChartItem[] = orderedKeys
    .filter((key) => (totalCounts.get(key) || 0) > 0)
    .map((key, index) => ({
      key,
      label: key,
      count: filteredCounts.get(key) || 0,
      totalCount: totalCounts.get(key) || 0,
      color: COLORS[index % COLORS.length],
    }));

  return (
    <InteractiveBarChart
      title="Flemish Connections"
      items={items}
      activeKey={activeConnection}
      onBarClick={onBarClick}
      onViewInNetwork={onViewInNetwork}
      emptyMessage="No flemish connection data available."
      listClassName="max-h-[23rem] overflow-y-auto pr-1"
    />
  );
}
