import { useEffect, useRef, useState } from 'react';
import { X, ChevronDown } from 'lucide-react';

export type ContactRejectReason =
  | 'not_flemish'
  | 'walloon_or_francophone'
  | 'not_us_based'
  | 'duplicate'
  | 'insufficient_evidence'
  | 'low_signal'
  | 'other';

export type OrganizationRejectReason =
  | 'not_flemish_relevant'
  | 'not_us_present'
  | 'duplicate'
  | 'insufficient_evidence'
  | 'low_signal'
  | 'other';

const CONTACT_REASONS: Array<{ key: ContactRejectReason; label: string }> = [
  { key: 'not_flemish', label: 'Not Flemish' },
  { key: 'walloon_or_francophone', label: 'Walloon / Francophone' },
  { key: 'not_us_based', label: 'Not US based' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'insufficient_evidence', label: 'Insufficient evidence' },
  { key: 'low_signal', label: 'Low signal' },
  { key: 'other', label: 'Other' },
];

const ORGANIZATION_REASONS: Array<{ key: OrganizationRejectReason; label: string }> = [
  { key: 'not_flemish_relevant', label: 'Not Flemish-relevant' },
  { key: 'not_us_present', label: 'No US presence' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'insufficient_evidence', label: 'Insufficient evidence' },
  { key: 'low_signal', label: 'Low signal' },
  { key: 'other', label: 'Other' },
];

interface Props<R extends string> {
  kind: 'contact' | 'organization';
  disabled?: boolean;
  label?: string;
  onSelect: (reason: R, note: string | null) => void | Promise<void>;
}

export default function RejectReasonMenu<R extends string>({
  kind,
  disabled,
  label,
  onSelect,
}: Props<R>) {
  const [open, setOpen] = useState(false);
  const [pendingReason, setPendingReason] = useState<R | null>(null);
  const [note, setNote] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setPendingReason(null);
        setNote('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const reasons = kind === 'contact' ? CONTACT_REASONS : ORGANIZATION_REASONS;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
      >
        <X className="w-3 h-3" />
        {label || 'Reject'}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-60 rounded-lg border border-gray-200 bg-white shadow-lg p-2">
          {!pendingReason ? (
            <div className="flex flex-col gap-1">
              <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-gray-500">
                Reject with reason
              </div>
              {reasons.map((r) => (
                <button
                  key={r.key}
                  onClick={() => {
                    if (r.key === 'other') {
                      setPendingReason(r.key as unknown as R);
                    } else {
                      void onSelect(r.key as unknown as R, null);
                      setOpen(false);
                    }
                  }}
                  className="text-left text-xs px-2 py-1.5 rounded hover:bg-gray-100"
                >
                  {r.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-1">
              <div className="text-[11px] text-gray-700">Add a brief note (optional)</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-red-300"
                placeholder="Why are you rejecting this?"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setPendingReason(null);
                    setNote('');
                  }}
                  className="text-[11px] px-2 py-1 text-gray-600 hover:bg-gray-100 rounded"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    void onSelect(pendingReason, note.trim() || null);
                    setOpen(false);
                    setPendingReason(null);
                    setNote('');
                  }}
                  className="text-[11px] px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
