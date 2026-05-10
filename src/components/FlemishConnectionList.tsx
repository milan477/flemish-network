import { Link as LinkIcon, ExternalLink } from 'lucide-react';
import type {
  PersonFlemishConnectionLink,
  OrganizationFlemishConnectionLink,
  FlemishConnection,
} from '../lib/flemishConnections';

type AnyFlemishLink = PersonFlemishConnectionLink | OrganizationFlemishConnectionLink;

function resolveConnection(link: AnyFlemishLink): FlemishConnection | null {
  const c = Array.isArray(link.flemish_connections)
    ? link.flemish_connections[0]
    : link.flemish_connections;
  return c && c.name ? c : null;
}

function formatConfidence(confidence: number | null | undefined): string | null {
  if (confidence === null || confidence === undefined) return null;
  return `${Math.round(confidence * 100)}% confidence`;
}

interface FlemishConnectionListProps {
  links: AnyFlemishLink[];
  onSelect: (connectionName: string) => void;
  /** Which lucide icon to use for the source link. Defaults to ExternalLink. */
  sourceIcon?: 'link' | 'external';
}

/**
 * Renders one row per Flemish-connection link. Each row has the clickable
 * connection chip together with its inline evidence (role, confidence,
 * excerpt, source). Replaces the older two-pass render that showed chips
 * above and a duplicated evidence list below.
 */
export default function FlemishConnectionList({
  links,
  onSelect,
  sourceIcon = 'external',
}: FlemishConnectionListProps) {
  const rows = links
    .map((link, idx) => {
      const connection = resolveConnection(link);
      if (!connection) return null;
      return { link, connection, idx };
    })
    .filter((row): row is { link: AnyFlemishLink; connection: FlemishConnection; idx: number } =>
      row !== null
    );

  if (rows.length === 0) return null;

  const SourceIcon = sourceIcon === 'link' ? LinkIcon : ExternalLink;

  return (
    <div className="space-y-2">
      {rows.map(({ link, connection, idx }) => {
        const confidence = formatConfidence(link.confidence);
        return (
          <div
            key={`${connection.id || connection.name}-${idx}`}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onSelect(connection.name)}
                className="px-3 py-1 rounded-md text-sm font-medium bg-blue-50 text-blue-700 hover:ring-2 hover:ring-blue-300 transition-all cursor-pointer"
              >
                {connection.name}
              </button>
              {link.role && (
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500 border border-gray-200">
                  {link.role.replace(/_/g, ' ')}
                </span>
              )}
              {confidence && (
                <span className="text-xs text-gray-500">{confidence}</span>
              )}
            </div>
            {link.evidence_excerpt && (
              <p className="mt-1 text-xs text-gray-500">{link.evidence_excerpt}</p>
            )}
            {link.source_url && (
              <a
                href={link.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <SourceIcon className="h-3 w-3" />
                Source
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
