import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { MapPin, Loader2, ChevronDown } from 'lucide-react';

interface CitySearchProps {
  value: string;
  state: string;
  onChange: (city: string, state: string, lat?: number, lng?: number) => void;
  placeholder?: string;
  className?: string;
}

interface LocationSuggestion {
  city: string;
  state: string;
  latitude: number;
  longitude: number;
}

export default function CitySearch({
  value,
  state: _state,
  onChange,
  placeholder = "Search city...",
  className = ""
}: CitySearchProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.length < 2 || !isOpen) {
        setSuggestions([]);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from('locations')
        .select('city, state, latitude, longitude')
        .ilike('city', `${query}%`)
        .order('city')
        .limit(10);

      if (!error && data) {
        // Dedup if multiple cities have same name
        const unique = data.reduce((acc: LocationSuggestion[], curr) => {
          if (!acc.find(i => i.city === curr.city && i.state === curr.state)) {
            acc.push(curr as LocationSuggestion);
          }
          return acc;
        }, []);
        setSuggestions(unique);
      }
      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, isOpen]);

  const handleSelect = (s: LocationSuggestion) => {
    setQuery(s.city);
    setIsOpen(false);
    onChange(s.city, s.state, s.latitude, s.longitude);
  };

  return (
    <div ref={wrapperRef} className={`relative flex-1 ${className}`}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            if (e.target.value === '') onChange('', '');
          }}
          onFocus={() => setIsOpen(true)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent"
          placeholder={placeholder}
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center space-x-1 pointer-events-none">
          {loading && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </div>
      </div>

      {isOpen && (suggestions.length > 0 || loading) && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-100 rounded-lg shadow-lg max-h-60 overflow-auto py-1">
          {loading && suggestions.length === 0 && (
            <div className="px-4 py-3 text-xs text-gray-400">Searching...</div>
          )}
          {suggestions.map((s, idx) => (
            <button
              key={`${s.city}-${s.state}-${idx}`}
              onClick={() => handleSelect(s)}
              className="w-full text-left px-4 py-2 text-sm hover:bg-yellow-50 flex items-center justify-between group"
            >
              <div className="flex items-center space-x-2">
                <MapPin className="w-3.5 h-3.5 text-gray-400 group-hover:text-yellow-600" />
                <span className="font-medium text-gray-700">{s.city}</span>
              </div>
              <span className="text-xs font-semibold text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded uppercase">
                {s.state}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
