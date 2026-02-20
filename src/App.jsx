import { useEffect, useState } from 'react';
import LandingPage from './components/LandingPage';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';

const SESSION_KEY = 'travel_memory_user';

export default function App() {
  const [view, setView] = useState('landing');
  const [user, setUser] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored);
      setUser(parsed);
      setView('dashboard');
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);

  const handleAuthSuccess = (nextUser) => {
    setUser(nextUser);
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextUser));
    setView('dashboard');
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
    setView('landing');
  };

  return (
    <div className="app-shell">
      {view === 'landing' && <LandingPage onGetStarted={() => setView('auth')} />}
      {view === 'auth' && (
        <AuthPage onBack={() => setView('landing')} onAuthSuccess={handleAuthSuccess} />
      )}
      {view === 'dashboard' && <Dashboard user={user} onLogout={handleLogout} />}
    </div>
  );
}
