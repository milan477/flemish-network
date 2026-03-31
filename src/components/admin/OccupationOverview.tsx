import {
  GraduationCap,
  Microscope,
  Wrench,
  Briefcase,
  Landmark,
  Palette,
  TrendingUp,
  Rocket,
  Heart,
  HelpCircle,
} from 'lucide-react';
import type { Person } from '../../lib/supabase';
import InteractiveBarChart from './InteractiveBarChart';

export const CATEGORIES = [
  { label: 'Professors', icon: GraduationCap, color: 'bg-blue-500', light: 'bg-blue-50 text-blue-700', keywords: ['professor', 'prof.', 'faculty', 'lecturer'] },
  { label: 'Researchers', icon: Microscope, color: 'bg-emerald-500', light: 'bg-emerald-50 text-emerald-700', keywords: ['researcher', 'scientist', 'postdoc', 'neuroscientist'] },
  { label: 'Engineers', icon: Wrench, color: 'bg-cyan-500', light: 'bg-cyan-50 text-cyan-700', keywords: ['engineer', 'developer', 'architect'] },
  { label: 'Executives', icon: Briefcase, color: 'bg-orange-500', light: 'bg-orange-50 text-orange-700', keywords: ['director', 'vp', 'president', 'head of', 'partner', 'manager'] },
  { label: 'Government', icon: Landmark, color: 'bg-red-500', light: 'bg-red-50 text-red-700', keywords: ['diplomat', 'advisor', 'policy'] },
  { label: 'Creatives', icon: Palette, color: 'bg-pink-500', light: 'bg-pink-50 text-pink-700', keywords: ['artist', 'filmmaker', 'film director', 'gallery', 'curator', 'designer'] },
  { label: 'Finance', icon: TrendingUp, color: 'bg-amber-500', light: 'bg-amber-50 text-amber-700', keywords: ['analyst', 'trader', 'banker', 'venture capital', 'fintech'] },
  { label: 'Entrepreneurs', icon: Rocket, color: 'bg-yellow-500', light: 'bg-yellow-50 text-yellow-700', keywords: ['founder', 'co-founder', 'startup', 'ceo'] },
  { label: 'Healthcare', icon: Heart, color: 'bg-rose-500', light: 'bg-rose-50 text-rose-700', keywords: ['doctor', 'physician', 'health', 'clinical', 'nurse'] },
];

const OCCUPATION_MAP: Record<string, string> = {
  professor: 'Professors',
  researcher: 'Researchers',
  engineer: 'Engineers',
  executive: 'Executives',
  government: 'Government',
  creative: 'Creatives',
  finance: 'Finance',
  entrepreneur: 'Entrepreneurs',
  healthcare: 'Healthcare',
  manager: 'Executives',
  consultant: 'Executives',
};

export function classifyPerson(person: Person): string {
  if (person.occupation) {
    const mapped = OCCUPATION_MAP[person.occupation.toLowerCase()];
    if (mapped) return mapped;
    for (const cat of CATEGORIES) {
      if (cat.keywords.some((kw) => person.occupation!.toLowerCase().includes(kw))) return cat.label;
    }
  }
  const pos = (person.current_position || '').toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some((kw) => pos.includes(kw))) return cat.label;
  }
  return 'Other';
}

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
