import { useEffect, useState, useCallback } from 'react';
import {
  ArrowLeft,
  Check,
  X,
  MapPin,
  Calendar,
  Users,
  CheckSquare,
  Square,
  Clock,
  ChevronDown,
  ChevronUp,
  Circle,
  Globe,
  Linkedin,
  Phone,
  Mail,
  Sparkles,
  UserCheck,
  Trash2,
} from 'lucide-react';
import { supabase, type Person, displayName, personInitials } from '../lib/supabase';
import {
  getEventTypeConfig,
  getDefaultRole,
  type Plan,
  type PlanSuggestedPerson,
  type PlanAction,
} from '../lib/plannerUtils';
import PlannerChatbot from './PlannerChatbot';

interface PlanDetailProps {
  planId: string;
  onBack: () => void;
  onNavigate: (page: string, id?: string) => void;
}

export default function PlanDetail({
  planId,
  onBack,
  onNavigate,
}: PlanDetailProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [suggestedPeople, setSuggestedPeople] = useState<PlanSuggestedPerson[]>([]);
  const [actions, setActions] = useState<PlanAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);

    const [planRes, peopleRes, actionsRes] = await Promise.all([
      supabase.from('plans').select('*').eq('id', planId).maybeSingle(),
      supabase
        .from('plan_suggested_people')
        .select('*, people(*)')
        .eq('plan_id', planId),
      supabase
        .from('plan_actions')
        .select('*')
        .eq('plan_id', planId)
        .order('sort_order'),
    ]);

    setPlan(planRes.data);
    setSuggestedPeople(
      (peopleRes.data as unknown as PlanSuggestedPerson[]) || []
    );
    setActions(actionsRes.data || []);
    setLoading(false);
  }, [planId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateAction = async (
    actionId: string,
    updates: Partial<PlanAction>
  ) => {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.description !== undefined)
      dbUpdates.description = updates.description;

    await supabase.from('plan_actions').update(dbUpdates).eq('id', actionId);
    setActions((prev) =>
      prev.map((a) => (a.id === actionId ? { ...a, ...updates } : a))
    );
  };

  const keepContact = async (spId: string) => {
    await supabase
      .from('plan_suggested_people')
      .update({ status: 'confirmed' })
      .eq('id', spId);
    setSuggestedPeople((prev) =>
      prev.map((sp) => (sp.id === spId ? { ...sp, status: 'confirmed' } : sp))
    );
  };

  const removeContact = async (spId: string) => {
    await supabase
      .from('plan_suggested_people')
      .update({ status: 'declined' })
      .eq('id', spId);
    setSuggestedPeople((prev) =>
      prev.map((sp) => (sp.id === spId ? { ...sp, status: 'declined' } : sp))
    );
  };

  const restoreContact = async (spId: string) => {
    await supabase
      .from('plan_suggested_people')
      .update({ status: 'suggested' })
      .eq('id', spId);
    setSuggestedPeople((prev) =>
      prev.map((sp) => (sp.id === spId ? { ...sp, status: 'suggested' } : sp))
    );
  };

  const addPersonFromChat = async (person: Person, reason?: string) => {
    if (!plan) return;
    const role = getDefaultRole(plan.event_type);
    const { data, error } = await supabase
      .from('plan_suggested_people')
      .insert({
        plan_id: planId,
        person_id: person.id,
        role,
        status: 'suggested',
        suggestion_reason: reason || '',
      })
      .select('*, people(*)')
      .maybeSingle();

    if (!error && data) {
      setSuggestedPeople((prev) => [
        ...prev,
        data as unknown as PlanSuggestedPerson,
      ]);
    }
  };

  if (loading || !plan) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-yellow-600" />
      </div>
    );
  }

  const config = getEventTypeConfig(plan.event_type);
  const completedActions = actions.filter(
    (a) => a.status === 'completed'
  ).length;
  const inProgressActions = actions.filter(
    (a) => a.status === 'in_progress'
  ).length;
  const progressPct =
    actions.length > 0 ? (completedActions / actions.length) * 100 : 0;

  const pending = suggestedPeople.filter((sp) => sp.status === 'suggested');
  const confirmed = suggestedPeople.filter((sp) => sp.status === 'confirmed');
  const declined = suggestedPeople.filter((sp) => sp.status === 'declined');
  const existingPersonIds = suggestedPeople.map((sp) => sp.person_id);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={onBack}
        className="flex items-center space-x-2 text-gray-500 hover:text-gray-900 mb-6 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm font-medium">Back to Plans</span>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <span
                className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}
              >
                {config.label}
              </span>
              <h1 className="text-2xl font-semibold text-gray-900 mt-3">
                {plan.title}
              </h1>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                plan.status === 'active'
                  ? 'bg-green-50 text-green-700'
                  : plan.status === 'completed'
                    ? 'bg-gray-100 text-gray-600'
                    : 'bg-yellow-50 text-yellow-700'
              }`}
            >
              {plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}
            </span>
          </div>

          <p className="text-gray-600 text-sm leading-relaxed mb-5">
            {plan.topic}
          </p>

          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-500">
            {(plan.dates_description || plan.start_date) && (
              <div className="flex items-center space-x-1.5">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span>
                  {plan.dates_description ||
                    `${plan.start_date}${plan.end_date ? ` - ${plan.end_date}` : ''}`}
                </span>
              </div>
            )}
            {plan.location && (
              <div className="flex items-center space-x-1.5">
                <MapPin className="w-4 h-4 text-gray-400" />
                <span>{plan.location}</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Quick Stats</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-blue-600" />
                <span className="text-sm text-gray-700">Contacts</span>
              </div>
              <span className="text-sm font-semibold text-gray-900">
                {confirmed.length}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-yellow-600" />
                <span className="text-sm text-gray-700">To review</span>
              </div>
              <span className="text-sm font-semibold text-gray-900">
                {pending.length}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div className="flex items-center space-x-2">
                <CheckSquare className="w-4 h-4 text-green-600" />
                <span className="text-sm text-gray-700">Tasks done</span>
              </div>
              <span className="text-sm font-semibold text-gray-900">
                {completedActions} / {actions.length}
              </span>
            </div>
            {inProgressActions > 0 && (
              <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <span className="text-sm text-gray-700">In Progress</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">
                  {inProgressActions}
                </span>
              </div>
            )}
            {actions.length > 0 && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                  <span>Progress</span>
                  <span>{Math.round(progressPct)}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-green-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmed.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <div className="flex items-center space-x-2 mb-5">
            <UserCheck className="w-5 h-5 text-green-600" />
            <h2 className="text-lg font-semibold text-gray-900">Contacts</h2>
            <span className="text-sm text-gray-400">({confirmed.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {confirmed.map((sp) => (
              <ConfirmedContactCard
                key={sp.id}
                sp={sp}
                onNavigate={onNavigate}
                onRemove={() => removeContact(sp.id)}
              />
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <div className="flex items-center space-x-2 mb-2">
            <Sparkles className="w-5 h-5 text-yellow-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              AI Suggestions
            </h2>
            <span className="text-sm text-gray-400">({pending.length})</span>
          </div>
          <p className="text-xs text-gray-500 mb-5">
            Review contacts suggested by AI. Keep the ones you want or remove them.
          </p>
          <div className="space-y-3">
            {pending.map((sp) => (
              <SuggestionCard
                key={sp.id}
                sp={sp}
                onNavigate={onNavigate}
                onKeep={() => keepContact(sp.id)}
                onRemove={() => removeContact(sp.id)}
              />
            ))}
          </div>
        </div>
      )}

      {declined.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <div className="flex items-center space-x-2 mb-4">
            <Trash2 className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-medium text-gray-500">
              Removed ({declined.length})
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {declined.map((sp) => {
              const person = sp.people;
              if (!person) return null;
              return (
                <button
                  key={sp.id}
                  onClick={() => restoreContact(sp.id)}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                  title="Click to restore"
                >
                  <span>{displayName(person)}</span>
                  <span className="text-gray-300">+</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {pending.length === 0 && confirmed.length === 0 && declined.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <div className="flex items-center space-x-2 mb-3">
            <Users className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Contacts</h2>
          </div>
          <p className="text-gray-500 text-sm py-4">
            No contacts yet. Use the Planning Assistant to find relevant people.
          </p>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-20">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center space-x-2">
            <Clock className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Action Items
            </h2>
            <span className="text-sm text-gray-400">
              ({completedActions}/{actions.length} done)
            </span>
          </div>
          <div className="flex items-center space-x-3 text-xs text-gray-400">
            <span className="flex items-center space-x-1">
              <Circle className="w-3 h-3" />
              <span>Pending</span>
            </span>
            <span className="flex items-center space-x-1 text-amber-500">
              <Clock className="w-3 h-3" />
              <span>In Progress</span>
            </span>
            <span className="flex items-center space-x-1 text-green-500">
              <CheckSquare className="w-3 h-3" />
              <span>Done</span>
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          {actions.map((action) => (
            <ActionItem
              key={action.id}
              action={action}
              onUpdate={(updates) => updateAction(action.id, updates)}
            />
          ))}
        </div>
      </div>

      <PlannerChatbot
        plan={plan}
        existingPersonIds={existingPersonIds}
        onAddPerson={addPersonFromChat}
        isOpen={chatOpen}
        onToggle={() => setChatOpen(!chatOpen)}
      />
    </div>
  );
}

function SuggestionCard({
  sp,
  onNavigate,
  onKeep,
  onRemove,
}: {
  sp: PlanSuggestedPerson;
  onNavigate: (page: string, id?: string) => void;
  onKeep: () => void;
  onRemove: () => void;
}) {
  const person = sp.people;
  if (!person) return null;

  const initials = personInitials(person);
  const name = displayName(person);

  return (
    <div className="flex items-center border border-gray-200 rounded-xl p-4 bg-white hover:border-yellow-200 transition-all group">
      <button
        onClick={() => onNavigate('person', sp.person_id)}
        className="flex items-center space-x-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
      >
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-100 to-yellow-200 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-semibold text-yellow-700">
            {initials}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900 text-sm truncate">{name}</p>
          {person.current_position && (
            <p className="text-xs text-gray-500 truncate">
              {person.current_position}
            </p>
          )}
          {sp.suggestion_reason && (
            <p className="text-xs text-yellow-700 mt-1 line-clamp-1 italic">
              {sp.suggestion_reason}
            </p>
          )}
        </div>
      </button>
      <div className="flex items-center space-x-1.5 ml-3 flex-shrink-0">
        <button
          onClick={onKeep}
          className="flex items-center space-x-1 px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg transition-colors text-xs font-medium"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Keep</span>
        </button>
        <button
          onClick={onRemove}
          className="p-1.5 bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
          title="Remove"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function ConfirmedContactCard({
  sp,
  onNavigate,
  onRemove,
}: {
  sp: PlanSuggestedPerson;
  onNavigate: (page: string, id?: string) => void;
  onRemove: () => void;
}) {
  const person = sp.people;
  if (!person) return null;

  const initials = personInitials(person);
  const name = displayName(person);
  const hasWebsite = !!person.website_url;
  const hasLinkedin = !!person.linkedin_url;
  const hasPhone = !!person.phone;
  const hasEmail = !!person.email;
  const hasAnyAction = hasWebsite || hasLinkedin || hasPhone || hasEmail;

  return (
    <div className="rounded-xl p-4 border border-green-200 bg-green-50/30 transition-all">
      <div className="flex items-start justify-between mb-3">
        <button
          onClick={() => onNavigate('person', sp.person_id)}
          className="flex items-start space-x-3 text-left hover:opacity-80 transition-opacity min-w-0 flex-1"
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-semibold text-green-700">
              {initials}
            </span>
          </div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900 text-sm">{name}</p>
            {person.current_position && (
              <p className="text-xs text-gray-500 line-clamp-1">
                {person.current_position}
              </p>
            )}
            {person.location_city && (
              <p className="text-xs text-gray-400 mt-0.5">
                {person.location_city}, {person.location_state}
              </p>
            )}
          </div>
        </button>
        <button
          onClick={onRemove}
          className="p-1 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
          title="Remove from contacts"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {hasAnyAction && (
        <div className="flex items-center space-x-1 pt-2.5 border-t border-green-100">
          {hasWebsite && (
            <a
              href={person.website_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg bg-white hover:bg-blue-50 text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-200 transition-all"
              title="Website"
            >
              <Globe className="w-3.5 h-3.5" />
            </a>
          )}
          {hasLinkedin && (
            <a
              href={person.linkedin_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg bg-white hover:bg-blue-50 text-gray-500 hover:text-blue-700 border border-gray-200 hover:border-blue-200 transition-all"
              title="LinkedIn"
            >
              <Linkedin className="w-3.5 h-3.5" />
            </a>
          )}
          {hasPhone && (
            <a
              href={`tel:${person.phone}`}
              className="p-2 rounded-lg bg-white hover:bg-green-50 text-gray-500 hover:text-green-600 border border-gray-200 hover:border-green-200 transition-all"
              title={`Call ${person.phone}`}
            >
              <Phone className="w-3.5 h-3.5" />
            </a>
          )}
          {hasEmail && (
            <a
              href={`mailto:${person.email}`}
              className="p-2 rounded-lg bg-white hover:bg-amber-50 text-gray-500 hover:text-amber-600 border border-gray-200 hover:border-amber-200 transition-all"
              title={`Email ${person.email}`}
            >
              <Mail className="w-3.5 h-3.5" />
            </a>
          )}
          <span className="text-xs text-gray-400 capitalize ml-auto">
            {sp.role}
          </span>
        </div>
      )}

      {!hasAnyAction && (
        <div className="flex items-center justify-between pt-2.5 border-t border-green-100">
          <span className="text-xs text-gray-400">No contact info available</span>
          <span className="text-xs text-gray-400 capitalize">{sp.role}</span>
        </div>
      )}
    </div>
  );
}

function ActionItem({
  action,
  onUpdate,
}: {
  action: PlanAction;
  onUpdate: (updates: Partial<PlanAction>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(action.title);
  const [descValue, setDescValue] = useState(action.description);

  useEffect(() => {
    setTitleValue(action.title);
    setDescValue(action.description);
  }, [action.title, action.description]);

  const cycleStatus = () => {
    const next =
      action.status === 'pending'
        ? 'in_progress'
        : action.status === 'in_progress'
          ? 'completed'
          : 'pending';
    onUpdate({ status: next });
  };

  const handleTitleBlur = () => {
    setEditingTitle(false);
    if (titleValue.trim() && titleValue !== action.title) {
      onUpdate({ title: titleValue.trim() });
    } else {
      setTitleValue(action.title);
    }
  };

  const handleDescBlur = () => {
    if (descValue !== action.description) {
      onUpdate({ description: descValue });
    }
  };

  const statusIcon = () => {
    if (action.status === 'completed')
      return <CheckSquare className="w-5 h-5 text-green-500" />;
    if (action.status === 'in_progress')
      return <Clock className="w-5 h-5 text-amber-500" />;
    return (
      <Square className="w-5 h-5 text-gray-300 hover:text-gray-500 transition-colors" />
    );
  };

  return (
    <div
      className={`rounded-lg border transition-all ${
        action.status === 'completed'
          ? 'border-green-100 bg-green-50/30'
          : action.status === 'in_progress'
            ? 'border-amber-100 bg-amber-50/20'
            : 'border-gray-100 bg-white hover:border-gray-200'
      }`}
    >
      <div className="flex items-center px-4 py-3">
        <button
          onClick={cycleStatus}
          className="flex-shrink-0 mr-3"
          title="Click to change status"
        >
          {statusIcon()}
        </button>

        {editingTitle ? (
          <input
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setTitleValue(action.title);
                setEditingTitle(false);
              }
            }}
            className="flex-1 text-sm bg-transparent border-b-2 border-yellow-400 focus:outline-none py-0.5 text-gray-900"
            autoFocus
          />
        ) : (
          <span
            onClick={() => setEditingTitle(true)}
            className={`flex-1 text-sm cursor-text ${
              action.status === 'completed'
                ? 'text-gray-400 line-through'
                : 'text-gray-700 hover:text-gray-900'
            }`}
            title="Click to edit"
          >
            {action.title}
          </span>
        )}

        {action.status === 'in_progress' && (
          <span className="text-[11px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full mr-2 font-medium whitespace-nowrap">
            In Progress
          </span>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-2 p-1 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
          title={expanded ? 'Collapse' : 'Expand to edit description'}
        >
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-3 pl-12">
          <textarea
            value={descValue}
            onChange={(e) => setDescValue(e.target.value)}
            onBlur={handleDescBlur}
            className="w-full text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-yellow-400 focus:border-yellow-400 resize-none transition-all"
            rows={2}
            placeholder="Add a description..."
          />
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center space-x-1">
              {(['pending', 'in_progress', 'completed'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => onUpdate({ status: s })}
                  className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                    action.status === s
                      ? s === 'completed'
                        ? 'bg-green-100 text-green-700'
                        : s === 'in_progress'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-gray-200 text-gray-600'
                      : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
                  }`}
                >
                  {s === 'in_progress'
                    ? 'In Progress'
                    : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
