import { useCallback } from 'react';
import {
  Navigate,
  Outlet,
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
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Account from './pages/Account';
import type { FilterPreset } from './lib/supabase';
import {
  buildDashboardLocation,
  buildDashboardStateFromPreset,
  getCurrentPageFromPathname,
  normalizePage,
} from './lib/appRouting';
import { getLastDashboardLocation } from './lib/dashboardSession';
import { RequireAuth, RequireRole, useAuth } from './lib/auth';

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

function ProtectedLayout({
  currentPage,
  onNavigate,
  onOpenSearch,
}: {
  currentPage: string;
  onNavigate: (page: string, id?: string, preset?: FilterPreset) => void;
  onOpenSearch: () => void;
}) {
  const { staffUser, signOut, canEdit } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation
        currentPage={currentPage}
        onNavigate={onNavigate}
        onOpenSearch={onOpenSearch}
        staffUser={staffUser}
        canEdit={canEdit}
        canAccessAdmin={canEdit}
        onSignOut={signOut}
      />
      <Outlet />
    </div>
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

      if (normalizedPage === 'account') {
        navigate('/account');
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
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<RequireAuth />}>
        <Route
          element={
            <ProtectedLayout
              currentPage={currentPage}
              onNavigate={handleNavigate}
              onOpenSearch={handleOpenSearch}
            />
          }
        >
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
          <Route path="/account" element={<Account />} />
          <Route element={<RequireRole role="editor" />}>
            <Route path="/admin" element={<Admin onNavigate={handleNavigate} />} />
            <Route
              path="/admin/:tab"
              element={<Admin onNavigate={handleNavigate} />}
            />
            <Route
              path="/contacts/new"
              element={<AddContact onNavigate={handleNavigate} />}
            />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
