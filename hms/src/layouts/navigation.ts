import {
  BarChart3,
  BedDouble,
  CalendarClock,
  ClipboardList,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Pill,
  Receipt,
  Send,
  Settings,
  ShieldCheck,
  Stethoscope,
  Syringe,
  Ticket,
  Users,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@hms/shared';
import type { HospitalSettings } from '../types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** The user needs at least one of these permissions. */
  anyOf: Permission[];
  module?: keyof HospitalSettings['modules'];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, anyOf: [] }],
  },
  {
    label: 'Front desk',
    items: [
      { to: '/patients', label: 'Patients', icon: UserRound, anyOf: ['patient:read'] },
      { to: '/appointments', label: 'Appointments', icon: CalendarClock, anyOf: ['appointment:read'] },
      { to: '/reception', label: 'Reception', icon: Ticket, anyOf: ['queue:read'] },
    ],
  },
  {
    label: 'Clinical',
    items: [
      { to: '/consultations', label: 'Consultations', icon: Stethoscope, anyOf: ['consultation:read'] },
      { to: '/prescriptions', label: 'Prescriptions', icon: ClipboardList, anyOf: ['prescription:read'] },
      { to: '/referrals', label: 'Referrals', icon: Send, anyOf: ['referral:read'] },
    ],
  },
  {
    label: 'Services',
    items: [
      { to: '/billing', label: 'Billing', icon: Receipt, anyOf: ['billing:read'] },
      { to: '/pharmacy', label: 'Pharmacy', icon: Pill, anyOf: ['pharmacy:read'], module: 'pharmacy' },
      { to: '/laboratory', label: 'Laboratory', icon: FlaskConical, anyOf: ['lab:read'], module: 'laboratory' },
      { to: '/beds', label: 'Rooms & Beds', icon: BedDouble, anyOf: ['bed:read'], module: 'beds' },
      { to: '/ot', label: 'Operation Theatre', icon: Syringe, anyOf: ['ot:read', 'settings:manage'] },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: FileText, anyOf: ['report:read'] },
      { to: '/analytics', label: 'Analytics', icon: BarChart3, anyOf: ['analytics:read'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users', icon: Users, anyOf: ['user:read'] },
      { to: '/settings', label: 'Settings', icon: Settings, anyOf: ['settings:manage', 'service:manage', 'lab:catalog', 'ward:configure'] },
      { to: '/audit', label: 'Audit Logs', icon: ShieldCheck, anyOf: ['audit:read'] },
    ],
  },
];
