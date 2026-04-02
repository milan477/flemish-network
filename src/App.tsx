import { useCallback } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import Navigation from './components/Navigation';
import Dashboard from './pages/Dashboard';
import PersonProfile from './pages/PersonProfile';
import OrganizationProfile from './pages/OrganizationProfile';
import Collections from './pages/Collections';
import Admin from './pages/Admin';
import AddContact from './pages/AddContact';
import type { FilterPreset } from './lib/supabase';
import {
  buildDashboardLocation,
  buildDashboardStateFromPreset,
  getCurrentPageFromPathname,
  normalizePage,
} from './lib/appRouting';
import { getLastDashboardLocation } from './lib/dashboardSession';

function PersonProfileRoute({
  onNavigate,
}: {
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}) {
  const { personId = '' } = useParams();
  return <PersonProfile personId={personId} onNavigate={onNavigate} />;
}

function OrganizationProfileRoute({
  onNavigate,
}: {
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}) {
  const { organizationId = '' } = useParams();
  return (
    <OrganizationProfile
      organizationId={organizationId}
      onNavigate={onNavigate}
    />
  );
}

function CollectionsIndexRoute({
  onNavigate,
}: {
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}) {
  return <Collections onNavigate={onNavigate} />;
}

function CollectionDetailRoute({
  onNavigate,
}: {
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
}) {
  const { collectionId = '' } = useParams();
  return (
    <Collections
      collectionId={collectionId}
      onNavigate={onNavigate}
      showDetail
    />
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPage = getCurrentPageFromPathname(location.pathname);

  const handleNavigate = useCallback(
    (page: string, id?: string, preset?: FilterPreset) => {
      const normalizedPage = normalizePage(page);
      const currentLocation = `${location.pathname}${location.search}`;

      if (normalizedPage === 'dashboard') {
        if (preset) {
          navigate(buildDashboardLocation(buildDashboardStateFromPreset(preset)));
          return;
        }

        navigate(getLastDashboardLocation() || '/');
        return;
      }

      if (normalizedPage === 'collections') {
        navigate('/collections');
        return;
      }

      if (normalizedPage === 'collection-detail' && id) {
        navigate(`/collections/${id}`, {
          state: { from: currentLocation },
        });
        return;
      }

      if (normalizedPage === 'admin') {
        navigate('/admin');
        return;
      }

      if (normalizedPage === 'add-contact') {
        navigate('/contacts/new', {
          state: { from: currentLocation },
        });
        return;
      }

      if (normalizedPage === 'person' && id) {
        navigate(`/people/${id}`, {
          state: { from: currentLocation },
        });
        return;
      }

      if (normalizedPage === 'organization' && id) {
        navigate(`/organizations/${id}`, {
          state: { from: currentLocation },
        });
      }
    },
    [location.pathname, location.search, navigate]
  );

  const handleOpenSearch = useCallback(() => {
    navigate(getLastDashboardLocation() || '/', {
      state: { focusSearch: true },
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation
        currentPage={currentPage}
        onNavigate={handleNavigate}
        onOpenSearch={handleOpenSearch}
      />

      <Routes>
        <Route path="/" element={<Dashboard onNavigate={handleNavigate} />} />
        <Route
          path="/people/:personId"
          element={<PersonProfileRoute onNavigate={handleNavigate} />}
        />
        <Route
          path="/organizations/:organizationId"
          element={<OrganizationProfileRoute onNavigate={handleNavigate} />}
        />
        <Route
          path="/collections"
          element={<CollectionsIndexRoute onNavigate={handleNavigate} />}
        />
        <Route
          path="/collections/:collectionId"
          element={<CollectionDetailRoute onNavigate={handleNavigate} />}
        />
        <Route path="/admin" element={<Admin onNavigate={handleNavigate} />} />
        <Route path="/admin/:tab" element={<Admin onNavigate={handleNavigate} />} />
        <Route
          path="/contacts/new"
          element={<AddContact onNavigate={handleNavigate} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
