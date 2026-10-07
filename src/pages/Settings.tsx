import { useEffect, useMemo } from 'react';
import { Activity, Shield, User } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import AccessManagementPanel from '../components/admin/AccessManagementPanel';
import SystemHealthPanel from '../components/admin/SystemHealthPanel';
import { useAuth } from '../lib/auth';
import {
  isCanonicalSettingsTab,
  normalizeSettingsTab,
  type SettingsTab,
} from '../lib/appRouting';
import Account from './Account';

export default function Settings() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const { canEdit, isAdmin } = useAuth();
  const activeTab = normalizeSettingsTab(tab, canEdit, isAdmin);

  const tabs = useMemo(
    () => [
      ...(canEdit
        ? [{ key: 'system' as const, label: 'System', icon: Activity }]
        : []),
      ...(isAdmin
        ? [{ key: 'access' as const, label: 'Access', icon: Shield }]
        : []),
      { key: 'account' as const, label: 'My Account', icon: User },
    ],
    [canEdit, isAdmin]
  );

  useEffect(() => {
    if (!tab || !isCanonicalSettingsTab(tab) || tab !== activeTab) {
      navigate(`/settings/${activeTab}`, { replace: true });
    }
  }, [activeTab, navigate, tab]);

  const handleTabChange = (nextTab: SettingsTab) => {
    navigate(`/settings/${nextTab}`);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900">Settings</h1>
        <div className="mt-4 flex gap-1 border-b border-gray-200">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleTabChange(item.key)}
                className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === item.key
                    ? 'border-yellow-500 text-yellow-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'system' && canEdit && <SystemHealthPanel mode="settings" />}
      {activeTab === 'access' && isAdmin && <AccessManagementPanel />}
      {activeTab === 'account' && <Account embedded />}
    </div>
  );
}
