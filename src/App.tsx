import { useState, useCallback } from 'react';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import PersonProfile from './pages/PersonProfile';
import OrganizationProfile from './pages/OrganizationProfile';
import Collections from './pages/Collections';
import Admin from './pages/Admin';
import AddContact from './pages/AddContact';
import type { FilterPreset, SearchCommand } from './lib/supabase';

type Page = 'dashboard' | 'person' | 'organization' | 'collections' | 'collection-detail' | 'admin' | 'add-contact';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [selectedId, setSelectedId] = useState<string>('');
  const [pendingPreset, setPendingPreset] = useState<FilterPreset | null>(null);
  const [searchInputValue, setSearchInputValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchCommand, setSearchCommand] = useState<SearchCommand | null>(null);

  const handleNavigate = useCallback((page: string, id?: string, preset?: FilterPreset) => {
    if (page === 'directory' || page === 'search') {
      setCurrentPage('dashboard');
    } else if (page === 'missions' || page === 'planner') {
      setCurrentPage('collections');
    } else {
      setCurrentPage(page as Page);
    }
    if (id) setSelectedId(id);
    if (preset) setPendingPreset(preset);
  }, []);

  const consumePreset = useCallback(() => {
    setPendingPreset(null);
  }, []);

  const handleSearchSubmit = useCallback((query: string) => {
    setSearchCommand({ query, timestamp: Date.now() });
    setCurrentPage('dashboard');
  }, []);

  const consumeSearchCommand = useCallback(() => {
    setSearchCommand(null);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchInputValue('');
    setSearchCommand(null);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation
        currentPage={currentPage}
        onNavigate={handleNavigate}
        searchInputValue={searchInputValue}
        onSearchInputChange={setSearchInputValue}
        onSearchSubmit={handleSearchSubmit}
        isSearching={isSearching}
      />

      {currentPage === 'dashboard' && (
        <Dashboard
          onNavigate={handleNavigate}
          filterPreset={pendingPreset}
          onConsumePreset={consumePreset}
          searchCommand={searchCommand}
          onConsumeSearchCommand={consumeSearchCommand}
          onSearchingChange={setIsSearching}
          onClearSearchInput={handleClearSearch}
        />
      )}

      {currentPage === 'person' && (
        <PersonProfile personId={selectedId} onNavigate={handleNavigate} />
      )}

      {currentPage === 'organization' && (
        <OrganizationProfile
          organizationId={selectedId}
          onNavigate={handleNavigate}
        />
      )}

      {(currentPage === 'collections' || currentPage === 'collection-detail') && (
        <Collections
          collectionId={selectedId}
          onNavigate={handleNavigate}
          showDetail={currentPage === 'collection-detail'}
        />
      )}

      {currentPage === 'admin' && <Admin />}

      {currentPage === 'add-contact' && <AddContact onNavigate={handleNavigate} />}
    </div>
  );
}

export default App;
