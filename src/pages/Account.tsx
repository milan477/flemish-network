import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Save, ShieldCheck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { PASSWORD_MIN_LENGTH, validateStaffPassword } from '../lib/passwordPolicy';

export default function Account() {
  const { staffUser, refreshStaffUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [fullName, setFullName] = useState(staffUser?.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState(staffUser?.avatar_url || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const shouldSetPassword =
    searchParams.get('setPassword') === '1' ||
    Boolean(staffUser?.password_reset_required);
  const redirect = searchParams.get('redirect');

  useEffect(() => {
    setFullName(staffUser?.full_name || '');
    setAvatarUrl(staffUser?.avatar_url || '');
  }, [staffUser?.avatar_url, staffUser?.full_name]);

  if (!staffUser) {
    return null;
  }

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    const { error: updateError } = await supabase
      .from('staff_users')
      .update({
        full_name: fullName.trim() || null,
        avatar_url: avatarUrl.trim() || null,
      })
      .eq('id', staffUser.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    await refreshStaffUser();
    setMessage('Profile updated.');
    setSaving(false);
  };

  const handlePasswordSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingPassword(true);
    setPasswordMessage(null);
    setPasswordError(null);

    const validationError = validateStaffPassword(password);
    if (validationError) {
      setPasswordError(validationError);
      setSavingPassword(false);
      return;
    }

    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      setSavingPassword(false);
      return;
    }

    const { error: authUpdateError } = await supabase.auth.updateUser({
      password,
    });

    if (authUpdateError) {
      setPasswordError(authUpdateError.message);
      setSavingPassword(false);
      return;
    }

    const { error: staffUpdateError } = await supabase
      .from('staff_users')
      .update({
        password_reset_required: false,
      })
      .eq('id', staffUser.id);

    if (staffUpdateError) {
      setPasswordError(staffUpdateError.message);
      setSavingPassword(false);
      return;
    }

    setPassword('');
    setConfirmPassword('');
    await refreshStaffUser();
    setPasswordMessage('Password updated.');
    setSavingPassword(false);
    if (shouldSetPassword && redirect) {
      navigate(redirect, { replace: true });
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900">My Account</h1>
            <p className="mt-2 text-sm text-gray-500">
              Manage your staff profile for this workspace.
            </p>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-medium text-green-700">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{staffUser.role}</span>
            </div>
          </div>
        </div>

        {shouldSetPassword && (
          <div className="mb-6 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            Set a strong password before continuing to the workspace.
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                Email
              </span>
              <input
                value={staffUser.email}
                disabled
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                Role
              </span>
              <input
                value={staffUser.role}
                disabled
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              Full name
            </span>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200"
              placeholder="Your name"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              Avatar URL
            </span>
            <input
              type="url"
              value={avatarUrl}
              onChange={(event) => setAvatarUrl(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200"
              placeholder="https://..."
            />
          </label>

          {message && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {message}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-yellow-400 px-4 py-3 text-sm font-medium text-gray-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Password</h2>
          <p className="mt-2 text-sm text-gray-500">
            Use at least {PASSWORD_MIN_LENGTH} characters with uppercase,
            lowercase, number, and symbol characters.
          </p>
        </div>

        <form onSubmit={handlePasswordSave} className="space-y-6">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              New password
            </span>
            <div className="flex items-center rounded-xl border border-gray-200 bg-white px-3">
              <KeyRound className="h-4 w-4 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl px-3 py-3 text-sm text-gray-900 outline-none"
                autoComplete="new-password"
                required={shouldSetPassword}
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              Confirm password
            </span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-200"
              autoComplete="new-password"
              required={shouldSetPassword}
            />
          </label>

          {passwordMessage && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {passwordMessage}
            </div>
          )}

          {passwordError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {passwordError}
            </div>
          )}

          <button
            type="submit"
            disabled={savingPassword || !password || !confirmPassword}
            className="inline-flex items-center gap-2 rounded-xl bg-yellow-400 px-4 py-3 text-sm font-medium text-gray-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingPassword ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            <span>{savingPassword ? 'Saving...' : 'Update Password'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
