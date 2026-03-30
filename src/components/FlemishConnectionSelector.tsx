import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type {
  FlemishConnection,
  FlemishConnectionType,
} from '../lib/flemishConnections';
import { inferFlemishConnectionType } from '../lib/flemishConnections';

interface FlemishConnectionSelectorProps {
  options: FlemishConnection[];
  value: FlemishConnection[];
  onChange: (next: FlemishConnection[]) => void;
  onCreateOption: (
    name: string,
    type: FlemishConnectionType
  ) => Promise<FlemishConnection | null>;
  placeholder?: string;
  disabled?: boolean;
}

const TYPE_LABELS: Record<FlemishConnectionType, string> = {
  university: 'University',
  government: 'Government',
  company: 'Company',
  other: 'Other',
};

const TYPE_STYLES: Record<FlemishConnectionType, string> = {
  university: 'bg-blue-50 text-blue-700 border-blue-200',
  government: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  company: 'bg-amber-50 text-amber-700 border-amber-200',
  other: 'bg-slate-100 text-slate-700 border-slate-200',
};

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

export default function FlemishConnectionSelector({
  options,
  value,
  onChange,
  onCreateOption,
  placeholder = 'Search Flemish connections...',
  disabled = false,
}: FlemishConnectionSelectorProps) {
  const [query, setQuery] = useState('');
  const [createType, setCreateType] = useState<FlemishConnectionType>('other');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!query.trim()) return;
    setCreateType(inferFlemishConnectionType(query));
  }, [query]);

  const selectedKeys = useMemo(
    () => new Set(value.map((connection) => normalizeName(connection.name))),
    [value]
  );

  const filteredOptions = useMemo(() => {
    const q = normalizeName(query);

    return options
      .filter((option) => !selectedKeys.has(normalizeName(option.name)))
      .filter((option) => {
        if (!q) return true;
        return normalizeName(option.name).includes(q);
      })
      .slice(0, 8);
  }, [options, query, selectedKeys]);

  const canCreate = useMemo(() => {
    const q = normalizeName(query);
    return Boolean(q) && !options.some((option) => normalizeName(option.name) === q);
  }, [options, query]);

  const addExisting = (connection: FlemishConnection) => {
    if (selectedKeys.has(normalizeName(connection.name))) return;
    onChange([...value, connection].sort((a, b) => a.name.localeCompare(b.name)));
    setQuery('');
  };

  const removeSelected = (name: string) => {
    const target = normalizeName(name);
    onChange(value.filter((connection) => normalizeName(connection.name) !== target));
  };

  const handleCreate = async () => {
    const name = query.trim();
    if (!name || creating) return;

    setCreating(true);
    try {
      const created = await onCreateOption(name, createType);
      if (created) {
        addExisting(created);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {value.map((connection) => (
          <span
            key={`${connection.id}-${connection.name}`}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${TYPE_STYLES[connection.type]}`}
          >
            <span>{connection.name}</span>
            <button
              type="button"
              onClick={() => removeSelected(connection.name)}
              className="rounded-full p-0.5 hover:bg-white/70"
              disabled={disabled}
              aria-label={`Remove ${connection.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {value.length === 0 && (
          <span className="text-xs text-gray-500">
            No Flemish connections selected.
          </span>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className="flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-gray-400"
          />
        </div>

        <div className="space-y-2 p-3">
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => addExisting(option)}
                disabled={disabled}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:border-yellow-300 hover:bg-yellow-50"
              >
                <span>{option.name}</span>
                <span className="text-xs text-gray-500">
                  {TYPE_LABELS[option.type]}
                </span>
              </button>
            ))}
            {filteredOptions.length === 0 && !canCreate && (
              <p className="text-xs text-gray-500">
                No matching connections found.
              </p>
            )}
          </div>

          {canCreate && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-800">
                  Add "{query.trim()}"
                </p>
                <p className="text-xs text-gray-500">
                  Create a new reusable Flemish connection.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={createType}
                  onChange={(event) => setCreateType(event.target.value as FlemishConnectionType)}
                  disabled={disabled || creating}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={disabled || creating}
                  className="inline-flex items-center gap-1 rounded-lg bg-yellow-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-yellow-600 disabled:opacity-60"
                >
                  <Plus className="h-3 w-3" />
                  <span>{creating ? 'Adding...' : 'Add'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
