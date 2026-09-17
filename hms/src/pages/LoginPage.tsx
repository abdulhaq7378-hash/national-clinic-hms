import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { errorMessage } from '../services/api';
import { Button, TextInput } from '../components/ui';
import { Loading } from '../components/data';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <Loading />;
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true">
            <Plus size={24} strokeWidth={3} />
          </div>
          <div>
            <div className="brand-name" style={{ fontSize: 18 }}>
              National Clinic
            </div>
            <div className="muted">Aurangabad · Hospital Management System</div>
          </div>
        </div>
        <form className="panel" onSubmit={submit} noValidate>
          <div className="panel-body stack">
            <div>
              <h1 style={{ fontSize: 17 }}>Staff sign in</h1>
              <p className="muted small">Use the account issued by the hospital administrator.</p>
            </div>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <TextInput
              label="Email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextInput
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" variant="primary" loading={submitting} disabled={!email || !password}>
              Sign in
            </Button>
          </div>
        </form>
        <p className="small subtle" style={{ marginTop: 12, textAlign: 'center' }}>
          Authorised hospital staff only. Access to patient records is logged.
        </p>
      </div>
    </div>
  );
}
