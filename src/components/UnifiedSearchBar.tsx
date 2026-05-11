import { useState, useRef, useEffect } from 'react';
import { Search, X, Loader2, Sparkles, User, Building2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface UnifiedSearchBarProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
  initialValue?: string;
  focusTrigger?: number;
  className?: string;
}

interface Suggestion {
  id: string;
  type: 'person' | 'organization';
  name: string;
  subtitle?: string;
}

interface AutofillRow {
  entity_type: 'person' | 'organization';
  id: string;
  name: string;
  subtitle: string | null;
}

const AUTOFILL_CACHE = new Map<string, Suggestion[]>();
const AUTOFILL_CACHE_MAX = 20;

function readAutofillCache(key: string): Suggestion[] | undefined {
  return AUTOFILL_CACHE.get(key);
}

function writeAutofillCache(key: string, value: Suggestion[]) {
  if (AUTOFILL_CACHE.size >= AUTOFILL_CACHE_MAX) {
    const first = AUTOFILL_CACHE.keys().next().value;
    if (first !== undefined) AUTOFILL_CACHE.delete(first);
  }
  AUTOFILL_CACHE.set(key, value);
}

export default function UnifiedSearchBar({
  onSearch,
  isSearching,
  initialValue = '',
  focusTrigger = 0,
  className = '',
}: UnifiedSearchBarProps) {
  const [value, setValue] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setValue(initialValue);
    if (initialValue && inputRef.current) {
      // Focus the input when a value is provided from navigation
      inputRef.current.focus();
    }
  }, [initialValue]);

  useEffect(() => {
    if (focusTrigger > 0 && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select(); // Select text for easy replacement
    }
  }, [focusTrigger]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const cached = readAutofillCache(q.toLowerCase());
    if (cached) {
      setSuggestions(cached);
      setShowSuggestions(cached.length > 0);
      return;
    }

    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const rpc = supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
          options?: { signal?: AbortSignal }
        ) => Promise<{ data: AutofillRow[] | null; error: unknown }>;

        const { data, error } = await rpc(
          'search_people_autofill',
          { q, lim: 8 },
          { signal: controller.signal }
        );

        if (controller.signal.aborted) return;
        if (error || !data) {
          setSuggestions([]);
          setShowSuggestions(false);
          return;
        }

        const allSuggestions: Suggestion[] = data.map(row => ({
          id: row.id,
          type: row.entity_type,
          name: row.name,
          subtitle: row.subtitle ?? undefined,
        }));

        writeAutofillCache(q.toLowerCase(), allSuggestions);
        setSuggestions(allSuggestions);
        setShowSuggestions(allSuggestions.length > 0);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.warn('[autofill] failed', err);
      }
    }, 250);

    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

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
    const q = value.trim();
    if (!q) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setShowSuggestions(false);
    onSearch(q);
    inputRef.current?.blur();
  };

  const handleSuggestionClick = (s: Suggestion) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setShowSuggestions(false);
    setValue(s.name);
    // Directly navigate if it's a specific person/org. Sentinel format consumed
    // by Dashboard.handleSearch; name may contain ':' but Dashboard only reads
    // [1]/[2], so trailing tokens are ignored safely.
    onSearch(`id:${s.id}:${s.type}`);
  };

  const handleClear = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setValue('');
    setSuggestions([]);
    setShowSuggestions(false);
    onSearch('');
  };

  return (
    <div className={`relative ${className}`}>
      <form onSubmit={handleSubmit} className="relative">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
          {isSearching ? (
            <Loader2 className="w-4 h-4 text-yellow-600 animate-spin" />
          ) : (
            <Search className="w-4 h-4 text-gray-400" />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true);
          }}
          placeholder="Search by name or describe what you're looking for..."
          className="w-full pl-10 pr-12 py-2.5 bg-white border border-gray-200 rounded-xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition-all"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="submit"
            className="p-1.5 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50 rounded-lg transition-colors"
            title="Submit search"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        </div>
      </form>

      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-xl z-[60] overflow-hidden"
        >
          <div className="py-1">
            {suggestions.map((s) => (
              <button
                key={`${s.type}-${s.id}`}
                onClick={() => handleSuggestionClick(s)}
                className="w-full text-left px-4 py-2.5 hover:bg-yellow-50 transition-colors flex items-center gap-3 group"
              >
                <div className={`p-1.5 rounded-lg ${s.type === 'person' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                  {s.type === 'person' ? <User className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 group-hover:text-yellow-900 truncate">
                    {s.name}
                  </div>
                  {s.subtitle && (
                    <div className="text-xs text-gray-500 truncate">{s.subtitle}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Suggestions</span>
            <span className="text-[10px] text-gray-400">Press Enter for deep search</span>
          </div>
        </div>
      )}
    </div>
  );
}
