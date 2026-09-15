import { useMemo } from 'react';
import {
  MapPin,
  Earth,
  Library,
  Plus,
  PlusCircle,
  Search,
  LogOut,
  Settings,
} from 'lucide-react';
import type { StaffUser } from '../lib/supabase';

interface NavigationProps {
  currentPage: string;
  onNavigate: (page: string, id?: string) => void;
  onOpenSearch: () => void;
  staffUser: StaffUser | null;
  canEdit: boolean;
  onSignOut: () => Promise<void>;
}

export default function Navigation({
  currentPage,
  onNavigate,
  onOpenSearch,
  staffUser,
  canEdit,
  onSignOut,
}: NavigationProps) {
  const navItems = [
    { id: 'dashboard', label: 'Network', icon: MapPin },
    { id: 'collections', label: 'Collections', icon: Library },
    ...(canEdit ? [{ id: 'expand', label: 'Grow', icon: PlusCircle }] : []),
    { id: 'settings', label: 'Settings', icon: Settings },
  ] as const;

  const initials = useMemo(() => {
    const source = (staffUser?.full_name || staffUser?.email || '').trim();
    if (!source) return 'U';
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  }, [staffUser]);

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16 justify-between">
          <div className="flex items-center gap-6 flex-shrink-0">
            <button
              onClick={() => onNavigate('dashboard')}
              className="flex items-center space-x-2 text-xl font-semibold"
              aria-label="Go to network dashboard"
              title="Network dashboard"
            >
              <div className="flex h-8 w-8 items-center justify-center">
                <Earth className="h-7 w-7 text-yellow-300" aria-hidden="true" />
              </div>
            </button>

            <div className="hidden md:flex space-x-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === item.id
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {currentPage !== 'dashboard' && (
              <button
                onClick={onOpenSearch}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors"
                title="Search the network"
              >
                <Search className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-1">
              <button
                onClick={() => onNavigate('account')}
                className="flex h-10 items-center gap-2 rounded-full border border-gray-200 bg-white pl-1 pr-3 transition-colors hover:border-gray-300"
                title="Open My Account"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
                  {initials}
                </div>
                <span className="hidden sm:block text-sm font-medium text-gray-700 max-w-36 truncate">
                  {staffUser?.full_name || staffUser?.email || 'Account'}
                </span>
              </button>
              <button
                onClick={() => void onSignOut()}
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="md:hidden border-t border-gray-200">
        <div className="flex justify-around py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-lg ${
                  currentPage === item.id
                    ? 'text-yellow-600'
                    : 'text-gray-600'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs">{item.label}</span>
              </button>
            );
          })}
          {canEdit && (
            <button
              onClick={() => onNavigate('add-contact')}
              className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-lg ${
                currentPage === 'add-contact' ? 'text-yellow-600' : 'text-gray-600'
              }`}
              aria-label="Add person or organization"
              title="Add person or organization"
            >
              <Plus className="w-5 h-5" />
              <span className="text-xs">Add</span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
