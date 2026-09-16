import { useState, useRef, useEffect } from 'react';
import { Search, X, Earth, Sparkles } from 'lucide-react';

interface UnifiedSearchBarProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
  initialValue?: string;
  focusTrigger?: number;
  className?: string;
}

export default function UnifiedSearchBar({
  onSearch,
  isSearching,
  initialValue = '',
  focusTrigger = 0,
  className = '',
}: UnifiedSearchBarProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = value.trim();
    if (!q) return;
    onSearch(q);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    setValue('');
    onSearch('');
  };

  return (
    <div className={`relative ${className}`}>
      <form onSubmit={handleSubmit} className="relative">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
          {isSearching ? (
            <Earth className="w-4 h-4 text-yellow-600 animate-spin" />
          ) : (
            <Search className="w-4 h-4 text-gray-400" />
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
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

    </div>
  );
}
