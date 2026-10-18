// Expiry maths, shared by the page and the service worker (plain script, no
// modules, so sw.js can importScripts it). Dates are local calendar days as
// 'YYYY-MM-DD' strings; times of day never matter for leftovers.
globalThis.Dates = (() => {
  const pad = (n) => String(n).padStart(2, '0');

  function today(now = new Date()) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function toUTC(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function addDays(iso, n) {
    const d = new Date(toUTC(iso) + n * 864e5);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  // Whole days from `from` to `iso`: 0 today, 1 tomorrow, -1 yesterday.
  function daysLeft(iso, from = today()) {
    return Math.round((toUTC(iso) - toUTC(from)) / 864e5);
  }

  function status(days) {
    if (days < 0) return 'expired';
    if (days <= 1) return 'soon';
    return 'ok';
  }

  function label(days) {
    if (days < 0) return 'Expired: throw away';
    if (days === 0) return 'Eat today';
    if (days === 1) return 'Eat by tomorrow';
    return `${days} days left`;
  }

  // A few words that fit under a small tile on a shelf.
  function short(days) {
    if (days < 0) return 'Throw away';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 14) return `${days} days`;
    if (days < 28) return `${Math.floor(days / 7)} weeks`;
    const months = Math.round(days / 30.4);
    return months === 1 ? '1 month' : `${months} months`;
  }

  function longDate(iso) {
    return new Date(toUTC(iso)).toLocaleDateString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });
  }

  const things = (n) => (n === 1 ? '1 thing' : `${n} things`);

  // One line for the daily reminder, or null when nothing needs attention.
  function summary(expiryDates, from = today()) {
    let expired = 0, now = 0, tomorrow = 0;
    for (const iso of expiryDates) {
      const d = daysLeft(iso, from);
      if (d < 0) expired++;
      else if (d === 0) now++;
      else if (d === 1) tomorrow++;
    }
    const parts = [];
    if (now) parts.push(`${things(now)} to eat today`);
    if (tomorrow) parts.push(`${things(tomorrow)} to eat by tomorrow`);
    if (expired) parts.push(`${things(expired)} to throw away`);
    return parts.length ? parts.join(', ') : null;
  }

  return { today, addDays, daysLeft, status, label, short, longDate, summary };
})();
