import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileArchive,
  Loader2,
} from 'lucide-react';
import type { CollectionMember } from '../lib/supabase';
import { exportCollectionToExcel, exportCollectionToCsv } from '../lib/exportService';
import { notifyError } from '../lib/toast';

interface CollectionExportMenuProps {
  members: CollectionMember[];
  filename?: string;
  buttonClassName?: string;
}

type ExportFormat = 'xlsx' | 'csv';

const DEFAULT_BUTTON_CLASS =
  'flex items-center space-x-2 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors border border-gray-200 hover:border-gray-300 disabled:opacity-50';

export default function CollectionExportMenu({
  members,
  filename,
  buttonClassName = DEFAULT_BUTTON_CLASS,
}: CollectionExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (members.length === 0) return null;

  const handleExport = async (format: ExportFormat) => {
    setExporting(format);
    try {
      if (format === 'xlsx') {
        await exportCollectionToExcel(members, filename);
      } else {
        await exportCollectionToCsv(members, filename);
      }
      setOpen(false);
    } catch (err) {
      notifyError(err, { hint: 'Could not export this collection.' });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={exporting !== null}
        className={buttonClassName}
      >
        {exporting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        <span>Export</span>
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[70] mt-2 w-52 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-xl">
          <button
            type="button"
            onClick={() => handleExport('xlsx')}
            disabled={exporting !== null}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === 'xlsx' ? (
              <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 text-green-600" />
            )}
            <span>Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={() => handleExport('csv')}
            disabled={exporting !== null}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === 'csv' ? (
              <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
            ) : (
              <FileArchive className="h-4 w-4 text-gray-500" />
            )}
            <span>CSV (.zip)</span>
          </button>
        </div>
      )}
    </div>
  );
}
