import { MapPin, Users, Building2, X, Search, Sparkles, Loader2, Library, ShieldCheck, ShieldAlert, Download } from 'lucide-react';
import { useState } from 'react';
import { supabase, displayName, personInitials } from '../lib/supabase';
import type { Person, Organization } from '../lib/supabase';
import AddToCollectionDropdown from './AddToCollectionDropdown';
import { exportToCsv } from '../lib/exportService';

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
}

function PersonCard({
  person,
  onNavigate,
  snippet,
}: {
  person: Person;
  onNavigate: (page: string, id?: string) => void;
  snippet?: string;
}) {
  const [showCollections, setShowCollections] = useState(false);

  return (
    <div className={`relative group/card bg-white rounded-xl shadow-sm hover:shadow-md border border-gray-100 transition-all duration-200 hover:-translate-y-0.5 ${showCollections ? 'z-30' : 'z-0'}`}>
      <button
        onClick={() => onNavigate('person', person.id)}
        className="w-full p-5 text-left h-full"
      >
        <div className="flex items-start space-x-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-semibold text-blue-700">
              {personInitials(person)}
            </span>
          </div>
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
            {person.location_city && (
              <div className="flex items-center space-x-1 text-xs text-gray-400 mt-2">
                <MapPin className="w-3 h-3" />
                <span>
                  {person.location_city}, {person.location_state}
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
    </div>
  );
}

function BulkAddButton({ people }: { people: Person[] }) {
  const [showDropdown, setShowDropdown] = useState(false);

  if (people.length <= 1) return null;

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
}: DirectoryGridProps) {
  const [exporting, setExporting] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-yellow-600" />
      </div>
    );
  }

  const isSearchMode = !!searchQuery;
  const displayPeople = allPeople || [];

  const handleExport = async (peopleToExport: Person[]) => {
    if (peopleToExport.length === 0) return;
    setExporting(true);
    try {
      // Fetch sectors for these people
      const { data: sectorRows } = await supabase
        .from('person_sectors')
        .select('person_id, sectors(name)')
        .in('person_id', peopleToExport.map(p => p.id));

      const sectorsMap: Record<string, string[]> = {};
      if (sectorRows) {
        sectorRows.forEach((row: any) => {
          if (!sectorsMap[row.person_id]) sectorsMap[row.person_id] = [];
          if (row.sectors?.name) sectorsMap[row.person_id].push(row.sectors.name);
        });
      }

      await exportToCsv(peopleToExport, sectorsMap);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

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
          {nameMatches.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Search className="w-4 h-4 text-sky-600" />
                  <h2 className="text-base font-semibold text-gray-900">
                    Matching Names
                  </h2>
                  <span className="text-sm text-gray-400">({nameMatches.length})</span>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => handleExport(nameMatches)}
                    disabled={exporting}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-white text-gray-600 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-50"
                  >
                    {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    <span>Export</span>
                  </button>
                  <BulkAddButton people={nameMatches} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {nameMatches.map((person) => (
                  <PersonCard key={person.id} person={person} onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          )}

          {nameMatches.length === 0 && !aiLoading && (
            <p className="text-sm text-gray-500">
              No people found matching the name &ldquo;{searchQuery}&rdquo;.
            </p>
          )}

          {aiLoading && (
            <div className="flex items-center space-x-3 py-6">
              <Loader2 className="w-5 h-5 text-yellow-600 animate-spin" />
              <span className="text-sm text-gray-600">
                Running AI-enhanced search...
              </span>
            </div>
          )}

          {!aiLoading && aiResults.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-yellow-600" />
                  <h2 className="text-base font-semibold text-gray-900">
                    AI-Enhanced Results
                  </h2>
                  <span className="text-sm text-gray-400">({aiResults.length})</span>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => handleExport(aiResults)}
                    disabled={exporting}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-white text-gray-600 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-50"
                  >
                    {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    <span>Export</span>
                  </button>
                  <BulkAddButton people={aiResults} />
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
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {aiResults.map((person) => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    onNavigate={onNavigate}
                    snippet={snippets?.get(person.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {!aiLoading && aiResults.length === 0 && nameMatches.length > 0 && onClearSearch && (
            <div className="flex justify-end">
              <button
                onClick={onClearSearch}
                className="flex items-center space-x-1 px-3 py-1.5 bg-white hover:bg-gray-100 rounded-lg text-sm text-gray-600 border border-gray-200 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Clear search</span>
              </button>
            </div>
          )}
        </>
      )}

      {!isSearchMode && displayPeople.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-900">People</h2>
              <span className="text-sm text-gray-400">({displayPeople.length})</span>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => handleExport(displayPeople)}
                disabled={exporting}
                className="flex items-center space-x-2 px-3 py-1.5 bg-white text-gray-600 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-50"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>Export</span>
              </button>
              <BulkAddButton people={displayPeople} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {displayPeople.map((person) => (
              <PersonCard key={person.id} person={person} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      )}

      {organizations.length > 0 && (
        <div>
          <div className="flex items-center space-x-2 mb-4">
            <Building2 className="w-5 h-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Organizations</h2>
            <span className="text-sm text-gray-400">({organizations.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => onNavigate('organization', org.id)}
                className="bg-white rounded-xl p-5 shadow-sm hover:shadow-md border border-gray-100 text-left transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-6 h-6 text-green-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 text-sm">{org.name}</h3>
                    <p className="text-xs text-gray-600 mt-0.5">{org.type}</p>
                    {org.location_city && (
                      <div className="flex items-center space-x-1 text-xs text-gray-400 mt-2">
                        <MapPin className="w-3 h-3" />
                        <span>
                          {org.location_city}, {org.location_state}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
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

      {isSearchMode && !aiLoading && nameMatches.length === 0 && aiResults.length === 0 && (
        <div className="text-center py-12">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Search className="w-7 h-7 text-gray-300" />
          </div>
          <h3 className="text-base font-medium text-gray-900 mb-1">No results</h3>
          <p className="text-gray-500 text-sm">
            No matches found for &ldquo;{searchQuery}&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}
