import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Plus,
  RefreshCw,
  Target,
  Trash2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { notifyError, notifySuccess } from '../../lib/toast';

interface HoldoutRow {
  id: string;
  full_name: string;
  known_aliases: string[] | null;
  known_employer: string | null;
  known_city: string | null;
  known_state: string | null;
  flemish_signal: string;
  source_note: string | null;
  added_at: string;
  last_seen_as_candidate_at: string | null;
  last_seen_candidate_id: string | null;
  last_seen_run_id: string | null;
}

interface AddFormState {
  full_name: string;
  known_aliases: string;
  known_employer: string;
  known_city: string;
  known_state: string;
  flemish_signal: string;
  source_note: string;
}

const RECENT_WINDOW_DAYS = 30;

const initialForm: AddFormState = {
  full_name: '',
  known_aliases: '',
  known_employer: '',
  known_city: '',
  known_state: '',
  flemish_signal: '',
  source_note: '',
};

export default function DiscoveryEvalPanel() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<HoldoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<AddFormState>(initialForm);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('discovery_eval_holdout')
      .select(
        'id, full_name, known_aliases, known_employer, known_city, known_state, flemish_signal, source_note, added_at, last_seen_as_candidate_at, last_seen_candidate_id, last_seen_run_id',
      )
      .order('added_at', { ascending: false });
    if (error) {
      notifyError(`Failed to load holdout: ${error.message}`);
      setRows([]);
    } else {
      setRows((data || []) as HoldoutRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const total = rows.length;
    const recentlyMatched = rows.filter((row) => {
      if (!row.last_seen_as_candidate_at) return false;
      const seen = new Date(row.last_seen_as_candidate_at).getTime();
      return Number.isFinite(seen) && seen >= cutoff;
    }).length;
    const everMatched = rows.filter((row) => row.last_seen_as_candidate_at).length;
    return {
      total,
      recentlyMatched,
      everMatched,
      recall: total === 0 ? 0 : Math.round((recentlyMatched / total) * 1000) / 10,
    };
  }, [rows]);

  const runCheck = useCallback(async () => {
    setRunning(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        notifyError('No active session');
        return;
      }
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/eval-holdout-check`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lookback_days: RECENT_WINDOW_DAYS }),
      });
      const json = await response.json();
      if (!response.ok) {
        notifyError(`Holdout check failed: ${json?.error || response.statusText}`);
        return;
      }
      notifySuccess(
        `Checked ${json.holdout_count} holdout · matched ${json.matched_count}`,
      );
      await load();
    } catch (error) {
      notifyError(`Holdout check error: ${(error as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [load]);

  const submitAdd = useCallback(async () => {
    if (!addForm.full_name.trim() || !addForm.flemish_signal.trim()) {
      notifyError('Full name and Flemish signal are required');
      return;
    }
    setAdding(true);
    const aliases = addForm.known_aliases
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const { error } = await supabase.from('discovery_eval_holdout').insert({
      full_name: addForm.full_name.trim(),
      known_aliases: aliases,
      known_employer: addForm.known_employer.trim() || null,
      known_city: addForm.known_city.trim() || null,
      known_state: addForm.known_state.trim() || null,
      flemish_signal: addForm.flemish_signal.trim(),
      source_note: addForm.source_note.trim() || null,
    });
    setAdding(false);
    if (error) {
      notifyError(`Failed to add holdout: ${error.message}`);
      return;
    }
    setAddForm(initialForm);
    setShowForm(false);
    await load();
  }, [addForm, load]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm('Remove this holdout person?')) return;
      const { error } = await supabase.from('discovery_eval_holdout').delete().eq('id', id);
      if (error) {
        notifyError(`Failed to remove: ${error.message}`);
        return;
      }
      await load();
    },
    [load],
  );

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-teal-600" />
            <h2 className="text-lg font-semibold text-gray-900">Discovery held-out evaluation</h2>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            Known Flemish-Americans excluded from the network. Recall = % surfaced as candidates in
            the last {RECENT_WINDOW_DAYS} days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runCheck}
            disabled={running || loading}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded-lg disabled:opacity-50"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Run check
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" />
            Add person
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Holdout total" value={stats.total} />
        <Stat
          label={`Recall (${RECENT_WINDOW_DAYS}d)`}
          value={`${stats.recall}%`}
          hint={`${stats.recentlyMatched}/${stats.total}`}
        />
        <Stat label="Ever matched" value={`${stats.everMatched}`} />
      </div>

      {showForm && (
        <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Full name *" value={addForm.full_name} onChange={(v) => setAddForm({ ...addForm, full_name: v })} />
            <FormField label="Aliases (comma-sep)" value={addForm.known_aliases} onChange={(v) => setAddForm({ ...addForm, known_aliases: v })} />
            <FormField label="Employer" value={addForm.known_employer} onChange={(v) => setAddForm({ ...addForm, known_employer: v })} />
            <FormField label="City" value={addForm.known_city} onChange={(v) => setAddForm({ ...addForm, known_city: v })} />
            <FormField label="State" value={addForm.known_state} onChange={(v) => setAddForm({ ...addForm, known_state: v })} />
            <FormField label="Flemish signal *" value={addForm.flemish_signal} onChange={(v) => setAddForm({ ...addForm, flemish_signal: v })} />
          </div>
          <FormField label="Source note" value={addForm.source_note} onChange={(v) => setAddForm({ ...addForm, source_note: v })} />
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setAddForm(initialForm);
                setShowForm(false);
              }}
              className="text-xs px-3 py-1.5 text-gray-600 hover:bg-gray-200 rounded"
            >
              Cancel
            </button>
            <button
              onClick={submitAdd}
              disabled={adding}
              className="text-xs px-3 py-1.5 bg-teal-600 text-white hover:bg-teal-700 rounded disabled:opacity-50"
            >
              {adding ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
              Add
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No holdout people yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200">
                <th className="text-left py-2 pr-3">Name</th>
                <th className="text-left py-2 pr-3">Employer / Location</th>
                <th className="text-left py-2 pr-3">Flemish signal</th>
                <th className="text-left py-2 pr-3">Last seen</th>
                {isAdmin && <th className="py-2 w-8"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-3 align-top">
                    <div className="font-medium text-gray-900">{row.full_name}</div>
                    {row.known_aliases && row.known_aliases.length > 0 && (
                      <div className="text-[11px] text-gray-500">aka {row.known_aliases.join(', ')}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 align-top text-gray-700">
                    {row.known_employer || <span className="text-gray-400">—</span>}
                    {(row.known_city || row.known_state) && (
                      <div className="text-[11px] text-gray-500">
                        {[row.known_city, row.known_state].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 align-top text-gray-700">{row.flemish_signal}</td>
                  <td className="py-2 pr-3 align-top">
                    {row.last_seen_as_candidate_at ? (
                      <span className="text-emerald-700">
                        {new Date(row.last_seen_as_candidate_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="text-gray-400">never</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="py-2 align-top text-right">
                      <button
                        onClick={() => remove(row.id)}
                        className="text-gray-400 hover:text-red-600 p-1"
                        aria-label="Remove holdout"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-xl font-semibold text-gray-900 mt-0.5">{value}</div>
      {hint && <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function FormField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-gray-700">
      <span className="block mb-0.5">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300"
      />
    </label>
  );
}
