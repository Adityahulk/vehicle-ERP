import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Format paise as Indian Rupee string with proper Indian grouping (1,23,456.00).
 */
export function formatCurrency(paise) {
  if (paise == null || isNaN(paise)) return '₹0.00';
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Format a number with Indian grouping (1,23,456).
 */
export function formatNumber(num) {
  if (num == null || isNaN(num)) return '0';
  return new Intl.NumberFormat('en-IN').format(Number(num));
}

/**
 * Format a date string as IST (Indian Standard Time) — DD MMM YYYY.
 * Always shows IST regardless of user's local timezone.
 */
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(dateStr));
  } catch {
    return String(dateStr);
  }
}

/**
 * Format a datetime string as IST — DD MMM YYYY, hh:mm AM/PM.
 */
export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }).format(new Date(dateStr));
  } catch {
    return String(dateStr);
  }
}

/**
 * Format a date as YYYY-MM-DD for input[type=date] fields.
 */
export function toInputDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toISOString().slice(0, 10);
}

/** Calendar YYYY-MM-DD in Asia/Kolkata (matches attendance backend). */
export function istYmd(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${day}`;
}

/**
 * Unique id for client-only keys (e.g. sortable row ids). Uses randomUUID when
 * available; on plain HTTP many browsers omit randomUUID (secure context only).
 */
export function randomClientId() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let s = '';
    for (let i = 0; i < 16; i++) s += (0x100 + b[i]).toString(16).slice(1);
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
