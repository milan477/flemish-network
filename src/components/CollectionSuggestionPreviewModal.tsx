import { useCallback, useEffect, useState } from 'react';
import {
  Briefcase,
  Building2,
  ExternalLink,
  Globe,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Tag,
  User,
  X,
} from 'lucide-react';
import {
  displayName,
  supabase,
  type Organization,
  type Person,
} from '../lib/supabase';
import type { CollectionSuggestionEntityType } from '../lib/collectionSuggestionDraft';
import { getPersonFlemishConnectionText } from '../lib/flemishConnections';
import { ProfileAvatar } from './ProfileAvatar';
import { organizationUsLocationLabel } from '../lib/networkScope';

interface CollectionSuggestionPreviewModalProps {
  entityType: CollectionSuggestionEntityType;
  entityId: string;
  onClose: () => void;
  onOpenProfile?: (entityType: CollectionSuggestionEntityType, entityId: string) => void;
}

interface PersonSectorRow {
  sector_id: string;
  sectors: { name: string } | null;
}

interface OrganizationSectorRow {
  sector_id: string;
  sectors: { name: string } | null;
}

export default function CollectionSuggestionPreviewModal({
  entityType,
  entityId,
  onClose,
  onOpenProfile,
}: CollectionSuggestionPreviewModalProps) {
  const [person, setPerson] = useState<Person | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPerson(null);
    setOrganization(null);
    setSectors([]);

    try {
      if (entityType === 'person') {
        const [personRes, sectorsRes] = await Promise.all([
          supabase
            .from('people')
            .select('*, locations(*), person_us_connections(*, locations(*)), person_flemish_connections(flemish_connection_id, flemish_connections(id, name, type))')
            .eq('id', entityId)
            .maybeSingle(),
          supabase
            .from('person_sectors')
            .select('sector_id, sectors(name)')
            .eq('person_id', entityId),
        ]);

        if (personRes.error) throw personRes.error;
        if (sectorsRes.error) throw sectorsRes.error;

        setPerson(personRes.data as Person | null);
        setSectors(
          ((sectorsRes.data || []) as unknown as PersonSectorRow[])
            .map((row) => row.sectors?.name)
            .filter((name): name is string => Boolean(name))
        );
      } else {
        const [organizationRes, sectorsRes] = await Promise.all([
          supabase
            .from('organizations')
            .select('*, locations(*), organization_us_locations(*, locations(*))')
            .eq('id', entityId)
            .maybeSingle(),
          supabase
            .from('organization_sectors')
            .select('sector_id, sectors(name)')
            .eq('organization_id', entityId),
        ]);

        if (organizationRes.error) throw organizationRes.error;
        if (sectorsRes.error) throw sectorsRes.error;

        setOrganization(organizationRes.data as Organization | null);
        setSectors(
          ((sectorsRes.data || []) as unknown as OrganizationSectorRow[])
            .map((row) => row.sectors?.name)
            .filter((name): name is string => Boolean(name))
        );
      }
    } catch (err) {
      console.warn('[CollectionSuggestionPreviewModal] failed to load preview', err);
      setError('Could not load this profile preview.');
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const title = person ? displayName(person) : organization?.name || 'Profile preview';
  const role = person?.current_position || person?.occupation || organization?.type || '';
  const locationText = person
    ? [person.locations?.city, person.locations?.state].filter(Boolean).join(', ')
    : [organization?.locations?.city, organization?.locations?.state].filter(Boolean).join(', ');
  const flemishText = person ? getPersonFlemishConnectionText(person) : organization?.flemish_link || '';
  const websiteUrl = person?.website_url || organization?.website_url || '';
  const linkedinUrl = person?.linkedin_url || '';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {person ? (
              <ProfileAvatar person={person} size="md" />
            ) : (
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                {entityType === 'person' ? <User className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-gray-900">{title}</h2>
              {role && <p className="truncate text-sm text-gray-500">{role}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading profile preview...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 text-sm text-gray-600 sm:grid-cols-2">
                {locationText && (
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span>{locationText}</span>
                  </div>
                )}
                {role && (
                  <div className="flex items-start gap-2">
                    <Briefcase className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span>{role}</span>
                  </div>
                )}
                {person?.email && (
                  <a href={`mailto:${person.email}`} className="flex items-start gap-2 text-gray-600 hover:text-yellow-700">
                    <Mail className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span className="truncate">{person.email}</span>
                  </a>
                )}
                {websiteUrl && (
                  <a
                    href={websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-2 text-gray-600 hover:text-yellow-700"
                  >
                    <Globe className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span className="truncate">{websiteUrl.replace(/^https?:\/\//, '')}</span>
                  </a>
                )}
                {linkedinUrl && (
                  <a
                    href={linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-2 text-gray-600 hover:text-yellow-700"
                  >
                    <Linkedin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span className="truncate">LinkedIn</span>
                  </a>
                )}
              </div>

              {sectors.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    <Tag className="h-3.5 w-3.5" />
                    Sectors
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sectors.map((sector) => (
                      <span key={sector} className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
                        {sector}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {flemishText && (
                <section>
                  <h3 className="mb-1 text-sm font-semibold text-gray-900">Flemish or Belgian Connection</h3>
                  <p className="text-sm leading-6 text-gray-700">{flemishText}</p>
                </section>
              )}

              {person?.bio && (
                <section>
                  <h3 className="mb-1 text-sm font-semibold text-gray-900">Bio</h3>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">{person.bio}</p>
                </section>
              )}

              {organization?.description && (
                <section>
                  <h3 className="mb-1 text-sm font-semibold text-gray-900">Description</h3>
                  <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">{organization.description}</p>
                </section>
              )}

              {person?.person_us_connections && person.person_us_connections.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-gray-900">US Connections</h3>
                  <div className="space-y-2">
                    {person.person_us_connections.map((connection, index) => (
                      <div key={connection.id || index} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        {[
                          connection.connection_label || 'US connection',
                          [connection.locations?.city, connection.locations?.state].filter(Boolean).join(', '),
                        ].filter(Boolean).join(' in ')}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {organization?.organization_us_locations && organization.organization_us_locations.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-gray-900">US Locations</h3>
                  <div className="space-y-2">
                    {organization.organization_us_locations.map((location, index) => (
                      <div key={location.id || index} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        {organizationUsLocationLabel(location)}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {onOpenProfile && (
          <div className="flex justify-end border-t border-gray-100 bg-gray-50/50 px-6 py-4">
            <button
              type="button"
              onClick={() => onOpenProfile(entityType, entityId)}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
            >
              <ExternalLink className="h-4 w-4" />
              Open Full Profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
