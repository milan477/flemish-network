import { Suspense, lazy, useCallback, type ReactNode } from 'react';
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
import ErrorBoundary from './components/ErrorBoundary';
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

const Dashboard = lazy(() => import('./pages/Dashboard'));
const PersonProfile = lazy(() => import('./pages/PersonProfile'));
const OrganizationProfile = lazy(() => import('./pages/OrganizationProfile'));
const Collections = lazy(() => import('./pages/Collections'));
const Admin = lazy(() => import('./pages/Admin'));

function PageLoader() {
  return (
    <div className="flex h-96 items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-teal-600" />
    </div>
  );
}

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
        navigate('/admin/discovery');
        return;
      }

      if (normalizedPage === 'add-contact') {
        navigate('/admin/discovery?mode=manual', {
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

  const wrap = (scope: string, node: ReactNode) => (
    <ErrorBoundary scope={scope}>
      <Suspense fallback={<PageLoader />}>{node}</Suspense>
    </ErrorBoundary>
  );

  return (
    <Routes>
      <Route path="/login" element={wrap('login', <Login />)} />
      <Route path="/auth/callback" element={wrap('auth-callback', <AuthCallback />)} />
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
          <Route
            path="/"
            element={wrap('dashboard', <Dashboard onNavigate={handleNavigate} />)}
          />
          <Route
            path="/people/:personId"
            element={wrap('person', <PersonProfileRoute onNavigate={handleNavigate} />)}
          />
          <Route
            path="/organizations/:organizationId"
            element={wrap(
              'organization',
              <OrganizationProfileRoute onNavigate={handleNavigate} />
            )}
          />
          <Route
            path="/collections"
            element={wrap(
              'collections',
              <CollectionsIndexRoute onNavigate={handleNavigate} />
            )}
          />
          <Route
            path="/collections/:collectionId"
            element={wrap(
              'collection-detail',
              <CollectionDetailRoute onNavigate={handleNavigate} />
            )}
          />
          <Route path="/account" element={wrap('account', <Account />)} />
          <Route element={<RequireRole role="editor" />}>
            <Route
              path="/admin"
              element={<Navigate to="/admin/discovery" replace />}
            />
            <Route
              path="/admin/:tab"
              element={wrap('admin', <Admin onNavigate={handleNavigate} />)}
            />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
