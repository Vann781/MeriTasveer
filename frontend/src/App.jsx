import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { EventsPage } from './pages/EventsPage.jsx';
import { EventPage } from './pages/EventPage.jsx';
import { ResultsPage } from './pages/ResultsPage.jsx';
import { AdminPage } from './pages/AdminPage.jsx';
import { HelpPage } from './pages/HelpPage.jsx';
import { Spinner } from './components/Screen.jsx';

/** Sends anyone who is not signed in to the login page. */
function RequireAuth({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return user ? children : <Navigate to="/login" replace />;
}

/** Signed-in participants have no reason to see the login page. */
function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/events" replace /> : <LoginPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          {/* Readable without signing in, so people can find the contact. */}
          <Route path="/help" element={<HelpPage />} />
          <Route
            path="/events"
            element={
              <RequireAuth>
                <EventsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/events/:eventId"
            element={
              <RequireAuth>
                <EventPage />
              </RequireAuth>
            }
          />
          <Route
            path="/results/:searchId"
            element={
              <RequireAuth>
                <ResultsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <AdminPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/events" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
