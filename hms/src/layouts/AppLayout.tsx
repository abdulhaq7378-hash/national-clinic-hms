import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, KeyRound, LogOut, Menu, Plus, Search, WifiOff } from 'lucide-react';
import { ROLE_LABELS } from '@hms/shared';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../hooks/queries';
import { useRealtime } from '../hooks/useRealtime';
import { usePatientSearch, PatientSummary } from '../components/pickers';
import { Button } from '../components/ui';
import { Loading } from '../components/data';
import { api } from '../services/api';
import { fmtDateTime } from '../utils/format';
import type { NotificationItem } from '../types';
import { NAVIGATION } from './navigation';

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { canAny } = useAuth();
  const settings = useSettings();
  const modules = settings.data?.modules;
  const hospital = settings.data?.hospital;

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
      <div className="sidebar-brand">
        <div className="brand-mark" aria-hidden="true">
          <Plus size={18} strokeWidth={3} />
        </div>
        <div>
          <div className="brand-name">{hospital?.name ?? 'National Clinic'}</div>
          <div className="brand-sub">{hospital?.city ?? 'Aurangabad'}</div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {NAVIGATION.map((group) => {
          const items = group.items.filter(
            (item) =>
              (item.anyOf.length === 0 || canAny(...item.anyOf)) && (!item.module || !modules || modules[item.module]),
          );
          if (!items.length) return null;
          return (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={onNavigate}
                >
                  <item.icon size={16} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-footer">Hospital Management System</div>
    </aside>
  );
}

function GlobalPatientSearch() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const results = usePatientSearch(term, 6);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="topbar-search input-group" ref={ref}>
      <Search size={15} />
      <input
        className="input"
        type="search"
        aria-label="Find patient"
        placeholder="Find patient by name, phone or UHID"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && term.trim().length >= 2 && (
        <div className="search-results">
          {results.data?.length === 0 && <div className="list-item muted">No matching patients</div>}
          {results.data?.map((p) => (
            <div
              key={p.id}
              className="list-item clickable"
              onMouseDown={(e) => {
                e.preventDefault();
                setTerm('');
                setOpen(false);
                navigate(`/patients/${p.id}`);
              }}
            >
              <PatientSummary patient={p} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function useOutsideClose(open: boolean, setOpen: (v: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, setOpen]);
  return ref;
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, setOpen);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>('/notifications'),
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post('/notifications/read', { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = query.data?.unread ?? 0;

  return (
    <div className="dropdown" ref={ref}>
      <Button
        variant="ghost"
        iconOnly
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
        icon={
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Bell size={17} />
            {unread > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -8,
                  background: 'var(--brand)',
                  color: '#fff',
                  borderRadius: 8,
                  fontSize: 10,
                  padding: '0 4px',
                  lineHeight: '14px',
                  fontWeight: 700,
                }}
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </span>
        }
      />
      {open && (
        <div className="dropdown-menu" style={{ width: 340, padding: 0 }}>
          <div className="row-between" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <strong>Notifications</strong>
            {unread > 0 && (
              <Button size="sm" variant="ghost" onClick={() => markRead.mutate(undefined)}>
                Mark all read
              </Button>
            )}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {query.data?.items.length === 0 && <div className="empty small">No notifications</div>}
            {query.data?.items.map((n) => (
              <div
                key={n.id}
                className="list-item clickable"
                style={{ background: n.read ? undefined : 'var(--brand-soft)' }}
                onClick={() => {
                  if (!n.read) markRead.mutate([n.id]);
                  setOpen(false);
                  if (n.link) navigate(n.link);
                }}
              >
                <div className={`strong ${n.severity === 'critical' ? 'danger-text' : ''}`}>{n.title}</div>
                <div className="small">{n.message}</div>
                <div className="small subtle">{fmtDateTime(n.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, setOpen);
  const navigate = useNavigate();
  if (!user) return null;
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className="btn btn-ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          aria-hidden="true"
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: 'var(--brand-soft)',
            color: 'var(--brand)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {initials}
        </span>
        <span className="topbar-user-name" style={{ textAlign: 'left', lineHeight: 1.2 }}>
          <span style={{ display: 'block', fontSize: 13 }}>{user.name}</span>
          <span className="subtle" style={{ display: 'block', fontSize: 11 }}>
            {ROLE_LABELS[user.role]}
          </span>
        </span>
      </button>
      {open && (
        <div className="dropdown-menu" role="menu">
          <div style={{ padding: '6px 10px 8px' }}>
            <div className="strong">{user.name}</div>
            <div className="small muted">{user.email}</div>
          </div>
          <hr className="divider" style={{ margin: '4px 0' }} />
          <button
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/account');
            }}
          >
            <KeyRound size={15} /> Change password
          </button>
          <button className="dropdown-item" role="menuitem" onClick={() => void logout()}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const { can } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const connected = useRealtime();
  const [showOffline, setShowOffline] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Only show the offline notice if the stream stays down for a few seconds.
  useEffect(() => {
    if (connected) {
      setShowOffline(false);
      return;
    }
    const id = setTimeout(() => setShowOffline(true), 8000);
    return () => clearTimeout(id);
  }, [connected]);

  return (
    <div className="app-shell">
      <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <Button
            variant="ghost"
            iconOnly
            className="menu-toggle"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
            icon={<Menu size={18} />}
          />
          {can('patient:read') && <GlobalPatientSearch />}
          <div className="topbar-actions">
            {showOffline && (
              <span className="badge warning" title="Live updates paused. Data refreshes when you reload or act.">
                <WifiOff size={12} /> Reconnecting
              </span>
            )}
            <Notifications />
            <UserMenu />
          </div>
        </header>
        <main className="content">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
