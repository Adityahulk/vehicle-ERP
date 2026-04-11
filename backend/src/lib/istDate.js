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

module.exports = { istYmd };
