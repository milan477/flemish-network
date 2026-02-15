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

const CATEGORIES = [
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

function classifyPerson(person: Person): string {
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

export default function OccupationOverview({ people }: { people: Person[] }) {
  const counts: Record<string, number> = {};
  people.forEach((p) => {
    const cat = classifyPerson(p);
    counts[cat] = (counts[cat] || 0) + 1;
  });

  const sorted = [
    ...CATEGORIES.map((c) => ({
      ...c,
      count: counts[c.label] || 0,
    })).filter((c) => c.count > 0),
    ...(counts['Other']
      ? [
          {
            label: 'Other',
            icon: HelpCircle,
            color: 'bg-gray-400',
            light: 'bg-gray-50 text-gray-600',
            keywords: [] as string[],
            count: counts['Other'],
          },
        ]
      : []),
  ].sort((a, b) => b.count - a.count);

  const maxCount = sorted[0]?.count || 1;

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <h2 className="text-lg font-semibold text-gray-900 mb-5">
        Occupations Overview
      </h2>
      <div className="space-y-3">
        {sorted.map((cat) => {
          const Icon = cat.icon;
          return (
            <div key={cat.label} className="flex items-center space-x-2.5">
              <div
                className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${cat.light}`}
              >
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-700 font-medium truncate">
                    {cat.label}
                  </span>
                  <span className="text-sm font-semibold text-gray-900 ml-2 flex-shrink-0">
                    {cat.count}
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={`${cat.color} h-2 rounded-full transition-all duration-700`}
                    style={{ width: `${(cat.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {sorted.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-6">
          No contacts in the database yet.
        </p>
      )}
    </div>
  );
}
