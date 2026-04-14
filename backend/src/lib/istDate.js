/**
 * Business calendar date YYYY-MM-DD in Asia/Kolkata (IST).
 * Used for attendance and leave so "today" matches users in India even when
 * server runs in UTC (avoids midnight-boundary bugs with toISOString().slice(0,10)).
 */
function istYmd(d = new Date()) {
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
 * Calendar YYYY-MM-DD for values coming from PostgreSQL `date` or JS Date.
 * Never use toISOString().slice(0,10) — it shifts the calendar day for IST users when the
 * server runs in UTC.
 */
function pgDateToYmd(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const s = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const yy = parts.find((p) => p.type === 'year').value;
    const mm = parts.find((p) => p.type === 'month').value;
    const dd = parts.find((p) => p.type === 'day').value;
    return `${yy}-${mm}-${dd}`;
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

module.exports = { istYmd, pgDateToYmd };
