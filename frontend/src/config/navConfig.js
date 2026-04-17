import {
  LayoutDashboard, Car, FileText, Landmark, Receipt,
  Clock, Settings,
  ShoppingCart, PackagePlus, PieChart, BarChart2,
  Users,
  UserCircle,
  CalendarDays,
} from 'lucide-react';

const ICON_MAP = {
  LayoutDashboard,
  Car,
  ShoppingCart,
  PackagePlus,
  FileText,
  Landmark,
  Receipt,
  BarChart2,
  Clock,
  Settings,
  PieChart,
  Users,
  UserCircle,
  CalendarDays,
};

/** Role → primary navigation (paths and icon keys). */
export const NAV_CONFIG = {
  company_admin: [
    { label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Inventory', path: '/inventory', icon: 'Car' },
    { label: 'Sales', path: '/sales', icon: 'ShoppingCart' },
    { label: 'Purchases', path: '/purchases', icon: 'PackagePlus' },
    { label: 'Quotations', path: '/quotations', icon: 'FileText' },
    { label: 'Loans', path: '/loans', icon: 'Landmark' },
    { label: 'Expenses', path: '/expenses', icon: 'Receipt' },
    { label: 'Reports', path: '/reports', icon: 'BarChart2' },
    { label: 'Team attendance', path: '/attendance', icon: 'Users' },
    { label: 'Settings', path: '/settings', icon: 'Settings' },
  ],
  branch_manager: [
    { label: 'Branch Dashboard', path: '/branch-dashboard', icon: 'LayoutDashboard' },
    { label: 'Inventory', path: '/inventory', icon: 'Car' },
    { label: 'Sales', path: '/sales', icon: 'ShoppingCart' },
    { label: 'Purchases', path: '/purchases', icon: 'PackagePlus' },
    { label: 'Quotations', path: '/quotations', icon: 'FileText' },
    { label: 'Loans', path: '/loans', icon: 'Landmark' },
    { label: 'Expenses', path: '/expenses', icon: 'Receipt' },
    { label: 'My clock', path: '/my-attendance', icon: 'Clock' },
    { label: 'Team attendance', path: '/attendance', icon: 'Users' },
    { label: 'My profile', path: '/me/profile', icon: 'UserCircle' },
  ],
  ca: [
    { label: 'Finance Overview', path: '/ca/dashboard', icon: 'PieChart' },
    { label: 'Sales', path: '/sales', icon: 'ShoppingCart' },
    { label: 'Purchases', path: '/purchases', icon: 'PackagePlus' },
    { label: 'Quotations', path: '/quotations', icon: 'FileText' },
    { label: 'Expenses', path: '/expenses', icon: 'Receipt' },
    { label: 'Loans', path: '/loans', icon: 'Landmark' },
    { label: 'Reports & Filing', path: '/reports', icon: 'BarChart2' },
  ],
  staff: [
    { label: 'Attendance', path: '/my-attendance', icon: 'Clock' },
    { label: 'My profile', path: '/me/profile', icon: 'UserCircle' },
  ],
};

function resolveNavPath(path, user) {
  if (path === '/me/profile' && user?.id) {
    return `/employees/${user.id}`;
  }
  return path;
}

export function navItemsForRole(role, user = null) {
  const adminNav = NAV_CONFIG.company_admin;
  if (role === 'super_admin') {
    return adminNav.map((item) => ({
      to: resolveNavPath(item.path, user),
      label: item.label,
      icon: ICON_MAP[item.icon] || LayoutDashboard,
    }));
  }
  const raw = NAV_CONFIG[role] ?? NAV_CONFIG.staff;
  return raw.map((item) => ({
    to: resolveNavPath(item.path, user),
    label: item.label,
    icon: ICON_MAP[item.icon] || LayoutDashboard,
  }));
}

/** Desktop top bar: keep a short primary row; rest go under "More" (reduces clutter). */
const DESKTOP_PRIMARY_PATHS = {
  company_admin: ['/dashboard', '/inventory', '/sales', '/attendance'],
  branch_manager: ['/branch-dashboard', '/inventory', '/sales', '/my-attendance', '/attendance'],
};

/**
 * @returns {{ primary: ReturnType<navItemsForRole>, overflow: ReturnType<navItemsForRole> }}
 */
export function splitNavForDesktopBar(role, user = null) {
  const items = navItemsForRole(role, user);
  const key = role === 'super_admin' ? 'company_admin' : role;
  const primaryPaths = DESKTOP_PRIMARY_PATHS[key];
  if (!primaryPaths?.length) {
    return { primary: items, overflow: [] };
  }
  const set = new Set(primaryPaths);
  const primary = [];
  const overflow = [];
  for (const item of items) {
    if (set.has(item.to)) primary.push(item);
    else overflow.push(item);
  }
  return { primary, overflow };
}
