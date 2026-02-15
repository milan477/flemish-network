import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Calendar,
  MapPin,
  Users,
  CheckSquare,
  Clipboard,
} from 'lucide-react';
import { supabase, type Person } from '../lib/supabase';
import {
  matchTopicToSectors,
  generateActions,
  getDefaultRole,
  getEventTypeConfig,
  type PlanWithCounts,
} from '../lib/plannerUtils';
import PlanForm, { type PlanFormData } from '../components/PlanForm';
import PlanDetail from '../components/PlanDetail';

type Mode = 'overview' | 'create' | 'detail';

export default function Planner({
  onNavigate,
}: {
  onNavigate: (page: string, id?: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('overview');
  const [plans, setPlans] = useState<PlanWithCounts[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPlans = useCallback(async () => {
    setLoading(true);

    const [plansRes, spRes, actionsRes] = await Promise.all([
      supabase.from('plans').select('*').order('created_at', { ascending: false }),
      supabase.from('plan_suggested_people').select('plan_id'),
      supabase.from('plan_actions').select('plan_id, status'),
    ]);

    const plansData = plansRes.data || [];
    const spData = spRes.data || [];
    const actionsData = actionsRes.data || [];

    const enriched: PlanWithCounts[] = plansData.map((plan) => {
      const contactCount = spData.filter((s) => s.plan_id === plan.id).length;
      const planActions = actionsData.filter((a) => a.plan_id === plan.id);
      return {
        ...plan,
        contact_count: contactCount,
        action_count: planActions.length,
        completed_action_count: planActions.filter(
          (a) => a.status === 'completed'
        ).length,
      };
    });

    setPlans(enriched);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const handleCreatePlan = async (formData: PlanFormData) => {
    const { data: plan, error } = await supabase
      .from('plans')
      .insert({
        event_type: formData.event_type,
        title: formData.title,
        topic: formData.topic,
        dates_description: formData.dates_description,
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        location: formData.location,
        status: 'draft',
        notes: '',
      })
      .select()
      .maybeSingle();

    if (error || !plan) return;

    const sectors = matchTopicToSectors(formData.topic);
    let suggestedPeople: Person[] = [];

    if (sectors.length > 0) {
      const { data: sectorRows } = await supabase
        .from('sectors')
        .select('id')
        .in('name', sectors);

      const sectorIds = sectorRows?.map((s) => s.id) || [];

      if (sectorIds.length > 0) {
        const { data: personSectorRows } = await supabase
          .from('person_sectors')
          .select('person_id')
          .in('sector_id', sectorIds);

        const personIds = [
          ...new Set(personSectorRows?.map((ps) => ps.person_id) || []),
        ];

        if (personIds.length > 0) {
          let q = supabase.from('people').select('*').in('id', personIds);

          if (formData.event_type === 'talk') {
            q = q.eq('available_for_lectures', true);
          }

          const { data } = await q;
          suggestedPeople = data || [];
        }
      }
    }

    if (suggestedPeople.length === 0) {
      let fallbackQuery = supabase.from('people').select('*').limit(8);
      if (formData.event_type === 'talk') {
        fallbackQuery = fallbackQuery.eq('available_for_lectures', true);
      }
      const { data } = await fallbackQuery;
      suggestedPeople = data || [];
    }

    if (suggestedPeople.length > 0) {
      const role = getDefaultRole(formData.event_type);
      const suggestions = suggestedPeople.map((person) => ({
        plan_id: plan.id,
        person_id: person.id,
        role,
        status: 'suggested',
      }));
      await supabase.from('plan_suggested_people').insert(suggestions);
    }

    const actionTemplates = generateActions(formData.event_type);
    const actionRows = actionTemplates.map((action, i) => ({
      plan_id: plan.id,
      title: action.title,
      description: action.description,
      status: 'pending',
      sort_order: i,
    }));
    await supabase.from('plan_actions').insert(actionRows);

    setSelectedPlanId(plan.id);
    setMode('detail');
    loadPlans();
  };

  const handleBack = () => {
    setMode('overview');
    setSelectedPlanId(null);
    loadPlans();
  };

  if (mode === 'create') {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PlanForm
          onSubmit={handleCreatePlan}
          onCancel={() => setMode('overview')}
        />
      </div>
    );
  }

  if (mode === 'detail' && selectedPlanId) {
    return (
      <PlanDetail
        planId={selectedPlanId}
        onBack={handleBack}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Planner</h1>
          <p className="text-gray-500 mt-1">
            Design and organize events, missions, and campaigns
          </p>
        </div>
        <button
          onClick={() => setMode('create')}
          className="flex items-center space-x-2 px-5 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium rounded-xl transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>New Plan</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-yellow-600" />
        </div>
      ) : plans.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Clipboard className="w-10 h-10 text-gray-300" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No plans yet
          </h3>
          <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
            Create your first plan to get started. The system will suggest
            relevant contacts, dates, and action items based on your event type
            and topic.
          </p>
          <button
            onClick={() => setMode('create')}
            className="inline-flex items-center space-x-2 px-5 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-medium rounded-xl transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create Your First Plan</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onClick={() => {
                setSelectedPlanId(plan.id);
                setMode('detail');
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  onClick,
}: {
  plan: PlanWithCounts;
  onClick: () => void;
}) {
  const config = getEventTypeConfig(plan.event_type);
  const progressPct =
    plan.action_count > 0
      ? Math.round((plan.completed_action_count / plan.action_count) * 100)
      : 0;

  return (
    <button
      onClick={onClick}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-left hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 group"
    >
      <div className="flex items-start justify-between mb-3">
        <span
          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}
        >
          {config.label}
        </span>
        <span
          className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
            plan.status === 'active'
              ? 'bg-green-50 text-green-700'
              : plan.status === 'completed'
                ? 'bg-gray-100 text-gray-600'
                : 'bg-yellow-50 text-yellow-700'
          }`}
        >
          {plan.status}
        </span>
      </div>

      <h3 className="font-semibold text-gray-900 text-sm mb-1 line-clamp-2 group-hover:text-gray-700 transition-colors">
        {plan.title}
      </h3>
      <p className="text-xs text-gray-500 line-clamp-2 mb-4">{plan.topic}</p>

      <div className="space-y-1.5 text-xs text-gray-400 mb-4">
        {plan.dates_description && (
          <div className="flex items-center space-x-1.5">
            <Calendar className="w-3.5 h-3.5" />
            <span className="truncate">{plan.dates_description}</span>
          </div>
        )}
        {plan.location && (
          <div className="flex items-center space-x-1.5">
            <MapPin className="w-3.5 h-3.5" />
            <span className="truncate">{plan.location}</span>
          </div>
        )}
      </div>

      {plan.action_count > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Progress</span>
            <span>{progressPct}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className="bg-green-500 h-1.5 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <div className="flex items-center space-x-1 text-xs text-gray-400">
          <Users className="w-3.5 h-3.5" />
          <span>{plan.contact_count} contacts</span>
        </div>
        <div className="flex items-center space-x-1 text-xs text-gray-400">
          <CheckSquare className="w-3.5 h-3.5" />
          <span>
            {plan.completed_action_count}/{plan.action_count}
          </span>
        </div>
      </div>
    </button>
  );
}
