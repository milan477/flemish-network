import { HelpCircle } from 'lucide-react';
import type { Person } from '../../lib/supabase';
import InteractiveBarChart from './InteractiveBarChart';
import { CATEGORIES, classifyPerson } from './occupationCategories';

interface OccupationOverviewProps {
  people: Person[];
  totalPeople?: Person[];
  activeCategory?: string | null;
  onBarClick?: (category: string) => void;
  onViewInNetwork?: (category: string) => void;
}

function buildCategoryCounts(people: Person[]) {
  const counts = new Map<string, number>();

  people.forEach((person) => {
    const category = classifyPerson(person);
    counts.set(category, (counts.get(category) || 0) + 1);
  });

  return counts;
}

export default function OccupationOverview({
  people,
  totalPeople,
  activeCategory = null,
  onBarClick,
  onViewInNetwork,
}: OccupationOverviewProps) {
  const filteredCounts = buildCategoryCounts(people);
  const baselineCounts = buildCategoryCounts(totalPeople || people);

  const items = [
    ...CATEGORIES.map((category) => ({
      key: category.label,
      label: category.label,
      icon: category.icon,
      iconClassName: category.light.split(' ')[1] || 'text-gray-600',
      color: category.color,
      count: filteredCounts.get(category.label) || 0,
      totalCount: baselineCounts.get(category.label) || 0,
    })).filter((item) => item.totalCount > 0),
    ...(baselineCounts.get('Other')
      ? [
          {
            key: 'Other',
            label: 'Other',
            icon: HelpCircle,
            iconClassName: 'text-gray-600',
            color: 'bg-gray-400',
            count: filteredCounts.get('Other') || 0,
            totalCount: baselineCounts.get('Other') || 0,
          },
        ]
      : []),
  ].sort((a, b) => b.count - a.count || (b.totalCount || 0) - (a.totalCount || 0));

  return (
    <InteractiveBarChart
      title="Occupations Overview"
      items={items}
      activeKey={activeCategory}
      onBarClick={(category) => onBarClick?.(category)}
      onViewInNetwork={onViewInNetwork}
      emptyMessage="No contacts in the database yet."
      listClassName="max-h-[23rem] overflow-y-auto pr-1"
    />
  );
}
