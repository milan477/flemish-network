import { MapPin, Users, Building2, X, Search, Sparkles, Earth, Library, ShieldCheck, ShieldAlert, Lightbulb, ChevronUp, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { displayName } from '../lib/supabase';
import type { Person, Organization } from '../lib/supabase';
import AddToCollectionDropdown from './AddToCollectionDropdown';
import PeopleExportMenu from './PeopleExportMenu';
import OrganizationExportMenu from './OrganizationExportMenu';
import { ProfileAvatar } from './ProfileAvatar';
import { logSearchClick } from '../lib/aiService';
import { useAuth } from '../lib/auth';
import { personCardLocationLabel } from '../lib/networkScope';
import LoadingGlobe from './LoadingGlobe';
import {
  organizationExactSearchScore,
  personExactSearchScore,
  type SearchRefinementGroup,
} from '../lib/searchRefinements';

interface DirectoryGridProps {
  nameMatches: Person[];
  aiResults: Person[];
  organizations: Organization[];
  loading: boolean;
  aiLoading: boolean;
  onNavigate: (page: string, id?: string) => void;
  searchQuery?: string;
  focusedCity: { city: string; state: string } | null;
  onClearFocus: () => void;
  onClearSearch?: () => void;
  snippets?: Map<string, string>;
  allPeople?: Person[];
  searchError?: string | null;
  refinementGroups?: SearchRefinementGroup[];
  aiConcepts?: string[];
  hasMorePeople?: boolean;
  hasMoreOrgs?: boolean;
  loadingMore?: boolean;
  onLoadMorePeople?: () => void;
  onLoadMoreOrgs?: () => void;
}

function formatConcept(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[A-Z0-9&.-]{2,}$/.test(trimmed)) return trimmed;

  return trimmed
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && ['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'to'].includes(lower)) {
        return lower;
      }
      return `${word[0].toUpperCase()}${word.slice(1)}`;
    })
    .join(' ');
}

function conceptsTried(
  concepts: string[] | undefined,
  refinements: SearchRefinementGroup[],
  query: string
): string[] {
  const candidates = refinements.length > 0
    ? refinements.map((refinement) => refinement.value)
    : concepts?.length
      ? concepts
      : [query];
  const seen = new Set<string>();

  return candidates
    .map(formatConcept)
    .filter((concept) => {
      const key = concept.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function SearchResultGroup({
  title,
  people,
  organizations,
  onNavigate,
  snippets,
  searchQuery,
  suggested = false,
  loading = false,
}: {
  title: string;
  people: Person[];
  organizations: Organization[];
  onNavigate: (page: string, id?: string) => void;
  snippets?: Map<string, string>;
  searchQuery?: string;
  suggested?: boolean;
  loading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = [
    ...people.map((person) => ({ kind: 'person' as const, value: person })),
    ...organizations.map((organization) => ({ kind: 'organization' as const, value: organization })),
  ];
  const visibleItems = expanded ? items : items.slice(0, 3);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {suggested ? (
            <Sparkles className="h-4 w-4 flex-shrink-0 text-yellow-600" />
          ) : (
            <Search className="h-4 w-4 flex-shrink-0 text-gray-500" />
          )}
          <h2 className="truncate text-base font-semibold text-gray-900">{title}</h2>
          <span className="text-sm text-gray-400">({items.length})</span>
          {suggested && (
            <span className="hidden rounded-full bg-yellow-50 px-2 py-0.5 text-[11px] font-medium text-yellow-700 sm:inline">
              AI enhancement
            </span>
          )}
        </div>
        {people.length > 0 && (
          <div className="flex items-center gap-2">
            <PeopleExportMenu people={people} />
            <BulkAddButton people={people} />
          </div>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex items-center gap-2 py-5 text-sm text-gray-500">
          <Earth className="h-4 w-4 animate-spin text-yellow-600" />
          Finding exact matches for this refinement...
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-4 py-5 text-sm text-gray-500">
          No exact matches in this category yet.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((item) => item.kind === 'person' ? (
              <PersonCard
                key={`person:${item.value.id}`}
                person={item.value}
                onNavigate={onNavigate}
                snippet={snippets?.get(item.value.id)}
                searchQuery={searchQuery}
              />
            ) : (
              <OrganizationCard
                key={`organization:${item.value.id}`}
                organization={item.value}
                onNavigate={onNavigate}
                snippet={snippets?.get(item.value.id)}
              />
            ))}
          </div>
          {items.length > 3 && (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-yellow-400 hover:text-gray-900"
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {expanded ? 'Show fewer' : `Show ${hiddenCount} more`}
            </button>
          )}
          {loading && (
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <Earth className="h-3.5 w-3.5 animate-spin text-yellow-600" />
              Looking for more exact matches...
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PersonCard({
  person,
  onNavigate,
  snippet,
  searchQuery,
}: {
  person: Person;
  onNavigate: (page: string, id?: string) => void;
  snippet?: string;
  searchQuery?: string;
}) {
  const [showCollections, setShowCollections] = useState(false);
  const { canEdit } = useAuth();

  return (
    <div className={`relative group/card bg-white rounded-xl shadow-sm hover:shadow-md border border-gray-100 transition-all duration-200 hover:-translate-y-0.5 ${showCollections ? 'z-30' : 'z-0'}`}>
      <button
        onClick={() => {
          if (searchQuery) logSearchClick(searchQuery, person.id);
          onNavigate('person', person.id);
        }}
        className="w-full p-5 text-left h-full"
      >
        <div className="flex items-start space-x-4">
          <ProfileAvatar person={person} size="md" />
          <div className="flex-1 min-w-0 pr-6">
            <div className="flex items-center gap-1.5 mb-0.5">
              <h3 className="font-semibold text-gray-900 text-sm truncate">
                {displayName(person)}
              </h3>
              {person.last_verified_at ? (
                <span title="Verified contact">
                  <ShieldCheck className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                </span>
              ) : (
                <span title="Unverified contact">
                  <ShieldAlert className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                </span>
              )}
            </div>
            {person.current_position && (
              <p className="text-xs text-gray-600 mt-0.5 line-clamp-1">
                {person.current_position}
              </p>
            )}
            {personCardLocationLabel(person) && (
              <div className="flex items-center space-x-1 text-xs text-gray-400 mt-2">
                <MapPin className="w-3 h-3" />
                <span>{personCardLocationLabel(person)}</span>
              </div>
            )}
            {snippet && (
              <p className="text-xs text-gray-500 italic mt-2 line-clamp-2 leading-relaxed">
                {snippet}
              </p>
            )}
          </div>
        </div>
      </button>

      {canEdit && (
        <div className="absolute top-4 right-4 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowCollections(!showCollections);
            }}
            className={`p-1.5 rounded-lg transition-all ${
              showCollections
                ? 'bg-yellow-100 text-yellow-600'
                : 'text-gray-300 hover:text-yellow-600 hover:bg-yellow-50 group-hover/card:text-gray-400'
            }`}
            title="Add to collection"
          >
            <Library className="w-4 h-4" />
          </button>

          {showCollections && (
            <AddToCollectionDropdown
              personIds={[person.id]}
              onClose={() => setShowCollections(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function BulkAddButton({ people }: { people: Person[] }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const { canEdit } = useAuth();

  if (people.length <= 1 || !canEdit) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          showDropdown 
            ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' 
            : 'bg-white text-gray-600 border border-gray-200 hover:border-yellow-400 hover:text-yellow-600'
        }`}
      >
        <Library className="w-4 h-4" />
        <span>Add all {people.length} to collection</span>
      </button>

      {showDropdown && (
        <AddToCollectionDropdown 
          personIds={people.map(p => p.id)} 
          onClose={() => setShowDropdown(false)} 
        />
      )}
    </div>
  );
}

function OrganizationCard({
  organization,
  onNavigate,
  snippet,
}: {
  organization: Organization;
  onNavigate: (page: string, id?: string) => void;
  snippet?: string;
}) {
  const [showCollections, setShowCollections] = useState(false);
  const { canEdit } = useAuth();

  const primaryLocation = organization.organization_us_locations?.[0]?.locations || organization.locations;

  return (
    <div className={`relative group/card bg-white rounded-xl shadow-sm hover:shadow-md border border-gray-100 transition-all duration-200 hover:-translate-y-0.5 ${showCollections ? 'z-30' : 'z-0'}`}>
      <button
        onClick={() => onNavigate('organization', organization.id)}
        className="w-full p-5 text-left h-full"
      >
        <div className="flex items-start space-x-4">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-6 h-6 text-green-700" />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <h3 className="font-semibold text-gray-900 text-sm line-clamp-2">{organization.name}</h3>
            <p className="text-xs text-gray-600 mt-0.5">{organization.type}</p>
            {primaryLocation?.city && (
              <div className="flex items-center space-x-1 text-xs text-gray-400 mt-2">
                <MapPin className="w-3 h-3" />
                <span>
                  {primaryLocation.city}, {primaryLocation.state}
                </span>
              </div>
            )}
            {snippet && (
              <p className="text-xs text-gray-500 italic mt-2 line-clamp-2 leading-relaxed">
                {snippet}
              </p>
            )}
          </div>
        </div>
      </button>

      {canEdit && (
        <div className="absolute top-4 right-4 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowCollections(!showCollections);
            }}
            className={`p-1.5 rounded-lg transition-all ${
              showCollections
                ? 'bg-yellow-100 text-yellow-600'
                : 'text-gray-300 hover:text-yellow-600 hover:bg-yellow-50 group-hover/card:text-gray-400'
            }`}
            title="Add to collection"
          >
            <Library className="w-4 h-4" />
          </button>

          {showCollections && (
            <AddToCollectionDropdown
              organizationIds={[organization.id]}
              onClose={() => setShowCollections(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function DirectoryGrid({
  nameMatches,
  aiResults,
  organizations,
  loading,
  aiLoading,
  onNavigate,
  searchQuery,
  focusedCity,
  onClearFocus,
  onClearSearch,
  snippets,
  allPeople,
  searchError,
  refinementGroups = [],
  aiConcepts,
  hasMorePeople,
  hasMoreOrgs,
  loadingMore,
  onLoadMorePeople,
  onLoadMoreOrgs,
}: DirectoryGridProps) {
  const [peopleCollapsed, setPeopleCollapsed] = useState(false);
  const [orgsCollapsed, setOrgsCollapsed] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingGlobe label="Loading directory" />
      </div>
    );
  }

  const isSearchMode = !!searchQuery;
  const displayPeople = allPeople || [];
  const generalPeople = [...nameMatches, ...aiResults]
    .filter(
      (person, index, rows) => rows.findIndex((candidate) => candidate.id === person.id) === index
    )
    .map((person, index) => ({
      person,
      index,
      score: personExactSearchScore(person, searchQuery || '', snippets?.get(person.id)),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ person }) => person);
  const generalOrganizations = organizations
    .map((organization, index) => ({
      organization,
      index,
      score: organizationExactSearchScore(
        organization,
        searchQuery || '',
        snippets?.get(organization.id)
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ organization }) => organization);
  const attemptedConcepts = conceptsTried(aiConcepts, refinementGroups, searchQuery || '');
  const hasSearchResults = generalPeople.length > 0 ||
    generalOrganizations.length > 0 ||
    refinementGroups.length > 0 ||
    attemptedConcepts.length > 0;

  return (
    <div className="space-y-8">
      {focusedCity && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <MapPin className="w-4 h-4 text-yellow-700" />
            <span className="text-sm font-medium text-yellow-800">
              Showing contacts in {focusedCity.city}, {focusedCity.state}
            </span>
          </div>
          <button
            onClick={onClearFocus}
            className="flex items-center space-x-1 px-3 py-1.5 bg-white hover:bg-yellow-100 rounded-lg text-sm text-yellow-700 border border-yellow-200 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>Show All</span>
          </button>
        </div>
      )}

      {isSearchMode && (
        <>
          {searchError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {searchError}
            </div>
          )}

          {aiLoading && !hasSearchResults && (
            <div className="flex items-center space-x-3 py-6">
              <Earth className="w-5 h-5 text-yellow-600 animate-spin" />
              <span className="text-sm text-gray-600">
                Running AI-enhanced search...
              </span>
            </div>
          )}

          {hasSearchResults && (
            <>
              <div className="flex justify-end">
                {onClearSearch && (
                  <button
                    onClick={onClearSearch}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-white hover:bg-gray-100 rounded-lg text-sm text-gray-600 border border-gray-200 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Clear search</span>
                  </button>
                )}
              </div>
              <SearchResultGroup
                key={`general:${searchQuery}`}
                title="General matches"
                people={generalPeople}
                organizations={generalOrganizations}
                onNavigate={onNavigate}
                snippets={snippets}
                searchQuery={searchQuery}
              />
              {aiLoading && refinementGroups.length === 0 && (
                <section className="rounded-2xl border border-yellow-200 bg-yellow-50/60 p-5">
                  <div className="flex items-center gap-3">
                    <Earth className="h-5 w-5 animate-spin text-yellow-600" />
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">AI enhancement</h2>
                      <p className="text-xs text-gray-500">Finding useful interpretations...</p>
                    </div>
                  </div>
                </section>
              )}
              {!aiLoading && (refinementGroups.length > 0 || attemptedConcepts.length > 0) && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <Sparkles className="h-5 w-5 text-yellow-600" />
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">AI enhancement</h2>
                      <p className="text-xs text-gray-500">Suggested interpretations of your search</p>
                    </div>
                  </div>
                  {attemptedConcepts.length > 0 && (
                    <div className="rounded-xl border border-yellow-200 bg-yellow-50/60 px-4 py-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-yellow-800">
                        {attemptedConcepts.length === 1 ? 'Concept tried' : 'Concepts tried'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {attemptedConcepts.map((concept) => (
                          <span
                            key={concept}
                            className="rounded-full border border-yellow-200 bg-white px-2.5 py-1 text-xs text-gray-700"
                          >
                            {concept}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {refinementGroups.map((group) => (
                    <SearchResultGroup
                      key={group.id}
                      title={group.label}
                      people={group.people}
                      organizations={group.organizations}
                      onNavigate={onNavigate}
                      snippets={new Map(group.snippets)}
                      searchQuery={searchQuery}
                      suggested
                      loading={group.loading}
                    />
                  ))}
                  {refinementGroups.length === 0 && (
                    <p className="rounded-xl border border-gray-200 bg-white px-4 py-5 text-sm text-gray-500">
                      No AI-enhanced matches found for this concept.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {!isSearchMode && displayPeople.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setPeopleCollapsed(!peopleCollapsed)}
              className="flex items-center space-x-2 group"
            >
              {peopleCollapsed
                ? <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                : <ChevronUp className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />}
              <Users className="w-5 h-5 text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-900">People</h2>
              <span className="text-sm text-gray-400">({displayPeople.length})</span>
            </button>
            <div className="flex items-center space-x-3">
              <PeopleExportMenu people={displayPeople} />
              <BulkAddButton people={displayPeople} />
            </div>
          </div>
          {!peopleCollapsed && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {displayPeople.map((person) => (
                  <PersonCard key={person.id} person={person} onNavigate={onNavigate} />
                ))}
              </div>
              {hasMorePeople && onLoadMorePeople && (
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={onLoadMorePeople}
                    disabled={loadingMore}
                    className="flex items-center space-x-2 px-6 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:border-yellow-400 hover:text-yellow-600 transition-colors disabled:opacity-50"
                  >
                    {loadingMore && <Earth className="w-4 h-4 animate-spin" />}
                    <span>{loadingMore ? 'Loading...' : 'Show more people'}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!isSearchMode && organizations.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setOrgsCollapsed(!orgsCollapsed)}
              className="flex items-center space-x-2 group"
            >
              {orgsCollapsed
                ? <ChevronDown className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />
                : <ChevronUp className="w-5 h-5 text-gray-400 group-hover:text-gray-600 transition-colors" />}
              <Building2 className="w-5 h-5 text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-900">Organizations</h2>
              <span className="text-sm text-gray-400">({organizations.length})</span>
            </button>
            <OrganizationExportMenu organizations={organizations} />
          </div>
          {!orgsCollapsed && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {organizations.map((org) => (
                  <OrganizationCard
                    key={org.id}
                    organization={org}
                    onNavigate={onNavigate}
                    snippet={snippets?.get(org.id)}
                  />
                ))}
              </div>
              {hasMoreOrgs && onLoadMoreOrgs && (
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={onLoadMoreOrgs}
                    disabled={loadingMore}
                    className="flex items-center space-x-2 px-6 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:border-yellow-400 hover:text-yellow-600 transition-colors disabled:opacity-50"
                  >
                    {loadingMore && <Earth className="w-4 h-4 animate-spin" />}
                    <span>{loadingMore ? 'Loading...' : 'Show more organizations'}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!isSearchMode && displayPeople.length === 0 && organizations.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-gray-300" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No results found</h3>
          <p className="text-gray-500 text-sm">Try adjusting your filters</p>
        </div>
      )}

      {isSearchMode && !aiLoading && !hasSearchResults && (
        <div className="text-center py-12">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Search className="w-7 h-7 text-gray-300" />
          </div>
          <h3 className="text-base font-medium text-gray-900 mb-1">No results</h3>
          <p className="text-gray-500 text-sm mb-4">
            No matches found for &ldquo;{searchQuery}&rdquo;
          </p>
          <div className="inline-flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-left max-w-md">
            <Lightbulb className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">Try adjusting your search:</p>
              <ul className="list-disc list-inside text-xs text-yellow-700 space-y-0.5">
                <li>Use broader terms (e.g. &ldquo;researcher&rdquo; instead of a specific name)</li>
                <li>Search by field: location, institution, or sector</li>
                <li>Try a descriptive query like &ldquo;biotech researchers in Boston&rdquo;</li>
              </ul>
            </div>
          </div>
          {onClearSearch && (
            <div className="mt-4">
              <button
                onClick={onClearSearch}
                className="inline-flex items-center space-x-1 px-3 py-1.5 bg-white hover:bg-gray-100 rounded-lg text-sm text-gray-600 border border-gray-200 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Clear search</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
