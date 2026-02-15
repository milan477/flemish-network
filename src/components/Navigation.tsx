import { useState, useRef, useEffect } from 'react';
import { User, MapPin, Calendar, Shield, Plus, Search, X, Loader2 } from 'lucide-react';
import { supabase, displayName, type Person } from '../lib/supabase';

interface NavigationProps {
  currentPage: string;
  onNavigate: (page: string, id?: string) => void;
  searchInputValue: string;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: (query: string) => void;
  isSearching: boolean;
}

interface AutocompleteResult {
  id: string;
  name: string;
  position?: string;
  city?: string;
}

export default function Navigation({
  currentPage,
  onNavigate,
  searchInputValue,
  onSearchInputChange,
  onSearchSubmit,
  isSearching,
}: NavigationProps) {
  const [suggestions, setSuggestions] = useState<AutocompleteResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const navItems = [
    { id: 'dashboard', label: 'Network', icon: MapPin },
    { id: 'planner', label: 'Missions', icon: Calendar },
    { id: 'admin', label: 'Stats', icon: Shield },
  ];

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = searchInputValue.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('people')
        .select('id, name, first_name, last_name, title, current_position, location_city')
        .or(`name.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
        .limit(6);

      if (data && data.length > 0) {
        setSuggestions(
          data.map((p: Pick<Person, 'id' | 'name' | 'first_name' | 'last_name' | 'title' | 'current_position' | 'location_city'>) => ({
            id: p.id,
            name: displayName(p),
            position: p.current_position || undefined,
            city: p.location_city || undefined,
          }))
        );
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInputValue]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchInputValue.trim();
    if (!q) return;
    setShowSuggestions(false);
    onSearchSubmit(q);
  };

  const handleSuggestionClick = (result: AutocompleteResult) => {
    setShowSuggestions(false);
    onSearchInputChange('');
    onNavigate('person', result.id);
  };

  const handleClear = () => {
    onSearchInputChange('');
    setSuggestions([]);
    setShowSuggestions(false);
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16 gap-4">
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

          <div className="flex-1 max-w-xl mx-auto relative">
            <form onSubmit={handleSubmit} className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={searchInputValue}
                onChange={(e) => onSearchInputChange(e.target.value)}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                placeholder="Search people, topics, connections..."
                className="w-full pl-9 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
                disabled={isSearching}
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {isSearching && (
                  <Loader2 className="w-4 h-4 text-yellow-600 animate-spin" />
                )}
                {!isSearching && searchInputValue && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </form>

            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={dropdownRef}
                className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-[60] overflow-hidden"
              >
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleSuggestionClick(s)}
                    className="w-full text-left px-4 py-2.5 hover:bg-yellow-50 transition-colors flex items-center justify-between group"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-gray-900 group-hover:text-yellow-800 transition-colors">
                        {s.name}
                      </span>
                      {s.position && (
                        <span className="text-xs text-gray-500 ml-2 truncate">{s.position}</span>
                      )}
                    </div>
                    {s.city && (
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{s.city}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2 flex-shrink-0">
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
            <button className="flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors">
              <User className="w-5 h-5 text-gray-600" />
            </button>
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
          <button
            onClick={() => onNavigate('add-contact')}
            className={`flex flex-col items-center space-y-1 px-3 py-2 rounded-lg ${
              currentPage === 'add-contact' ? 'text-yellow-600' : 'text-gray-600'
            }`}
          >
            <Plus className="w-5 h-5" />
            <span className="text-xs">Add</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
