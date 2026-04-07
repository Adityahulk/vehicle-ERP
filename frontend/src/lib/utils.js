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
