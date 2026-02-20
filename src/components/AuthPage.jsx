import { useState } from 'react';

export default function AuthPage({ onBack, onAuthSuccess }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const email = form.email.trim();
    if (!email || !form.password.trim()) {
      return;
    }

    const displayName = form.name.trim() || email.split('@')[0];
    onAuthSuccess({ name: displayName, email });
  };

  return (
    <main className="auth-page">
      <button className="text-link" type="button" onClick={onBack}>
        &larr; Back to landing
      </button>

      <section className="auth-card card-shell">
        <div className="auth-toggle">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => setMode('signup')}
          >
            Sign Up
          </button>
        </div>

        <h2>{mode === 'login' ? 'Welcome back' : 'Create your memory vault'}</h2>
        <p>Use your account to access the travel dashboard and trip creation tools.</p>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <label>
              Name
              <input
                type="text"
                placeholder="Aarav"
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
              />
            </label>
          )}

          <label>
            Email
            <input
              type="email"
              placeholder="name@email.com"
              value={form.email}
              onChange={(event) => updateField('email', event.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              placeholder="********"
              value={form.password}
              onChange={(event) => updateField('password', event.target.value)}
              required
            />
          </label>

          <button type="submit" className="primary-pill auth-submit">
            {mode === 'login' ? 'Enter Dashboard' : 'Create Account'}
          </button>
        </form>
      </section>
    </main>
  );
}
