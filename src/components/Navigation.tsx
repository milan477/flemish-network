import { useEffect, useMemo, useRef, useState } from 'react';
import {
  User,
  MapPin,
  Library,
  Shield,
  Plus,
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
  canAccessAdmin: boolean;
  onSignOut: () => Promise<void>;
}

export default function Navigation({
  currentPage,
  onNavigate,
  onOpenSearch,
  staffUser,
  canEdit,
  canAccessAdmin,
  onSignOut,
}: NavigationProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const navItems = [
    { id: 'dashboard', label: 'Network', icon: MapPin },
    { id: 'collections', label: 'Collections', icon: Library },
    ...(canAccessAdmin ? [{ id: 'admin', label: 'Dashboard', icon: Shield }] : []),
  ] as const;

  const initials = useMemo(() => {
    const source = (staffUser?.full_name || staffUser?.email || '').trim();
    if (!source) return 'U';
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  }, [staffUser]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16 justify-between">
          <div className="flex items-center gap-6 flex-shrink-0">
            <button
              onClick={() => onNavigate('dashboard')}
              className="flex items-center space-x-2 text-xl font-semibold"
            >
              <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-yellow-500 rounded-lg flex items-center justify-center">
                <MapPin className="w-5 h-5 text-gray-900" />
              </div>
              <span className="hidden lg:inline text-gray-900">
                Flemish Network
              </span>
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
            {canEdit && (
              <button
                onClick={() => onNavigate('add-contact')}
                className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors ${
                  currentPage === 'add-contact'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                }`}
                title="Add new contact"
              >
                <Plus className="w-5 h-5" />
              </button>
            )}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu((prev) => !prev)}
                className="flex h-10 items-center gap-2 rounded-full border border-gray-200 bg-white pl-1 pr-3 transition-colors hover:border-gray-300"
              >
                {staffUser?.avatar_url ? (
                  <img
                    src={staffUser.avatar_url}
                    alt={staffUser.full_name || staffUser.email}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
                    {initials}
                  </div>
                )}
                <span className="hidden sm:block text-sm font-medium text-gray-700 max-w-36 truncate">
                  {staffUser?.full_name || staffUser?.email || 'Account'}
                </span>
              </button>

              {showMenu && (
                <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
                  <div className="border-b border-gray-100 px-4 py-3">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {staffUser?.full_name || 'Staff User'}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {staffUser?.email}
                    </p>
                    <p className="mt-2 inline-flex rounded-full bg-yellow-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-700">
                      {staffUser?.role}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onNavigate('account');
                    }}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <User className="h-4 w-4 text-gray-400" />
                    <span>My Account</span>
                  </button>
                  {canAccessAdmin && (
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onNavigate('admin');
                      }}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Settings className="h-4 w-4 text-gray-400" />
                      <span>Admin Dashboard</span>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      void onSignOut();
                    }}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
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
