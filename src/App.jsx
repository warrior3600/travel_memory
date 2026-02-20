import { useEffect, useState } from 'react';
import LandingPage from './components/LandingPage';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';
import { api } from './utils/api';

const SESSION_KEY = 'travel_memory_user';

export default function App() {
  const [view, setView] = useState('landing');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
      const stored = localStorage.getItem(SESSION_KEY);
      if (!stored) {
        setInitializing(false);
        return;
      }

      try {
        const parsed = JSON.parse(stored);
        if (!parsed.token) {
          localStorage.removeItem(SESSION_KEY);
          setInitializing(false);
          return;
        }

        const me = await api.me(parsed.token);
        setToken(parsed.token);
        setUser(me.user);
        setView('dashboard');
      } catch {
        localStorage.removeItem(SESSION_KEY);
      } finally {
        setInitializing(false);
      }
    };

    restoreSession();
  }, []);

  const handleAuthSubmit = async ({ mode, name, email, password }) => {
    setAuthLoading(true);
    setAuthError('');

    try {
      const response =
        mode === 'signup'
          ? await api.signup({ name, email, password })
          : await api.login({ email, password });

      setToken(response.token);
      setUser(response.user);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token: response.token }));
      setView('dashboard');
    } catch (error) {
      setAuthError(error.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken('');
    localStorage.removeItem(SESSION_KEY);
    setView('landing');
  };

  if (initializing) {
    return <div className="app-shell">Loading...</div>;
  }

  return (
    <div className="app-shell">
      {view === 'landing' && <LandingPage onGetStarted={() => setView('auth')} />}
      {view === 'auth' && (
        <AuthPage
          onBack={() => setView('landing')}
          onSubmit={handleAuthSubmit}
          loading={authLoading}
          error={authError}
        />
      )}
      {view === 'dashboard' && <Dashboard user={user} token={token} onLogout={handleLogout} />}
    </div>
  );
}
