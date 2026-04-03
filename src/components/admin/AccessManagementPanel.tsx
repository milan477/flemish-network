import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, MailPlus, Save, ShieldCheck } from 'lucide-react';
import { supabase, type AppRole, type StaffUser } from '../../lib/supabase';

type DraftUser = {
  full_name: string;
  role: AppRole;
  status: StaffUser['status'];
};

const ROLE_OPTIONS: AppRole[] = ['viewer', 'editor', 'admin'];
const STATUS_OPTIONS: StaffUser['status'][] = ['invited', 'active', 'disabled'];

function formatDate(value?: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export default function AccessManagementPanel() {
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftUser>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('viewer');

  const loadStaffUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from('staff_users')
      .select('id, user_id, email, full_name, avatar_url, role, status, last_sign_in_at, created_at, updated_at')
      .order('email');

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const rows = (data || []) as StaffUser[];
    setStaffUsers(rows);
    setDrafts(
      Object.fromEntries(
        rows.map((row) => [
          row.id,
          {
            full_name: row.full_name || '',
            role: row.role,
            status: row.status,
          },
        ])
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStaffUsers();
  }, [loadStaffUsers]);

  const activeCount = useMemo(
    () => staffUsers.filter((user) => user.status === 'active').length,
    [staffUsers]
  );

  const updateDraft = (id: string, patch: Partial<DraftUser>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        ...patch,
      },
    }));
  };

  const handleInvite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail) return;

    setCreating(true);
    setError(null);
    setMessage(null);

    const { error: insertError } = await supabase.from('staff_users').insert({
      email: normalizedEmail,
      full_name: inviteName.trim() || null,
      role: inviteRole,
      status: 'invited',
    });

    if (insertError) {
      setError(insertError.message);
      setCreating(false);
      return;
    }

    setInviteEmail('');
    setInviteName('');
    setInviteRole('viewer');
    setMessage(`Added ${normalizedEmail} to the approved staff list.`);
    setCreating(false);
    await loadStaffUsers();
  };

  const handleSaveRow = async (userId: string) => {
    const draft = drafts[userId];
    if (!draft) return;

    setSavingId(userId);
    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase
      .from('staff_users')
      .update({
        full_name: draft.full_name.trim() || null,
        role: draft.role,
        status: draft.status,
      })
      .eq('id', userId);

    if (updateError) {
      setError(updateError.message);
      setSavingId(null);
      return;
    }

    setMessage('Access settings updated.');
    setSavingId(null);
    await loadStaffUsers();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Staff Access
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Manage approved staff emails and workspace roles.
            </p>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              <span>{activeCount} active staff accounts</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleInvite} className="grid gap-4 md:grid-cols-[2fr,2fr,1fr,auto]">
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="staff@example.org"
            className="rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200"
            required
          />
          <input
            value={inviteName}
            onChange={(event) => setInviteName(event.target.value)}
            placeholder="Full name"
            className="rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200"
          />
          <select
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as AppRole)}
            className="rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-yellow-400 px-4 py-3 text-sm font-medium text-gray-900 hover:bg-yellow-500 disabled:opacity-50"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MailPlus className="h-4 w-4" />
            )}
            <span>Add Access</span>
          </button>
        </form>

        {message && (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            {message}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="grid grid-cols-[2fr,2fr,1fr,1fr,1.2fr,auto] gap-4 border-b border-gray-100 px-6 py-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <span>Email</span>
          <span>Name</span>
          <span>Role</span>
          <span>Status</span>
          <span>Last Sign-In</span>
          <span className="text-right">Action</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center px-6 py-12">
            <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />
          </div>
        ) : staffUsers.length === 0 ? (
          <div className="px-6 py-10 text-sm text-gray-500">
            No staff users configured yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {staffUsers.map((user) => {
              const draft = drafts[user.id];
              return (
                <div
                  key={user.id}
                  className="grid grid-cols-[2fr,2fr,1fr,1fr,1.2fr,auto] gap-4 px-6 py-4 items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {user.email}
                    </p>
                    <p className="text-xs text-gray-400">
                      {user.user_id ? 'Linked account' : 'Awaiting first sign-in'}
                    </p>
                  </div>
                  <input
                    value={draft?.full_name || ''}
                    onChange={(event) =>
                      updateDraft(user.id, { full_name: event.target.value })
                    }
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200"
                    placeholder="No name"
                  />
                  <select
                    value={draft?.role || 'viewer'}
                    onChange={(event) =>
                      updateDraft(user.id, {
                        role: event.target.value as AppRole,
                      })
                    }
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200"
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <select
                    value={draft?.status || 'invited'}
                    onChange={(event) =>
                      updateDraft(user.id, {
                        status: event.target.value as StaffUser['status'],
                      })
                    }
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-gray-500">
                    {formatDate(user.last_sign_in_at)}
                  </span>
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSaveRow(user.id)}
                      disabled={savingId === user.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {savingId === user.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      <span>Save</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
