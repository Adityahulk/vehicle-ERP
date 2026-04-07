import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import useAuthStore from '@/store/authStore';
import {
  LayoutDashboard, Car, FileText, Landmark, Receipt,
  BarChart3, Clock, Settings, LogOut, Search, X, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inventory', label: 'Inventory', icon: Car },
  { to: '/sales', label: 'Sales', icon: FileText },
  { to: '/loans', label: 'Loans', icon: Landmark },
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/attendance', label: 'Attendance', icon: Clock },
  { to: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
];

function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const navigate = useNavigate();
  const timerRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const handleSearch = (value) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);

    if (value.length < 2) {
      setResults([]);
      return;
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/vehicles/search?q=${encodeURIComponent(value)}`);
        setResults(data.vehicles || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const handleSelect = (vehicle) => {
    setOpen(false);
    setQuery('');
    setResults([]);
    navigate(`/vehicles/${vehicle.id}`);
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="hidden sm:flex items-center gap-2 text-muted-foreground w-52"
        onClick={() => setOpen(true)}
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs flex-1 text-left">Search vehicles...</span>
        <kbd className="pointer-events-none h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 hidden sm:inline-flex">
          ⌘K
        </kbd>
      </Button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search chassis, model, engine..."
            className="w-72 pl-8 h-9 text-sm"
          />
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => { setOpen(false); setQuery(''); setResults([]); }}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {(results.length > 0 || loading) && (
        <div className="absolute top-full mt-1 left-0 w-80 bg-popover border border-border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && results.map((v) => (
            <button
              key={v.id}
              onClick={() => handleSelect(v)}
              className="w-full text-left px-3 py-2.5 hover:bg-accent transition-colors flex items-center gap-3 border-b border-border/50 last:border-0"
            >
              <Car className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {[v.make, v.model, v.variant].filter(Boolean).join(' ') || 'Unknown'}
                </p>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {v.chassis_number}
                </p>
              </div>
              <span className={cn(
                'text-[10px] font-semibold px-1.5 py-0.5 rounded ml-auto shrink-0',
                v.status === 'in_stock' ? 'bg-emerald-100 text-emerald-700' :
                v.status === 'sold' ? 'bg-blue-100 text-blue-700' :
                'bg-amber-100 text-amber-700',
              )}>
                {v.status?.replace('_', ' ')}
              </span>
            </button>
          ))}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No vehicles found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AppLayout({ children }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-muted">
      <header className="sticky top-0 z-30 bg-card border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold">Vehicle ERP</h1>
          <nav className="hidden md:flex items-center gap-1">
            {navItems
              .filter(({ adminOnly }) => !adminOnly || ['super_admin', 'company_admin'].includes(user?.role))
              .map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <GlobalSearch />
          <span className="text-sm text-muted-foreground hidden lg:inline">
            {user?.name} <span className="text-xs">({user?.role})</span>
          </span>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}
