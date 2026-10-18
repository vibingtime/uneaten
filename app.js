// Uneaten: snap leftovers, see what's left, get nudged before it goes off.
'use strict';

const $ = (id) => document.getElementById(id);
const cfg = globalThis.UNEATEN_CONFIG || {};

const CHOICES = [
  ['Tomorrow', 1],
  ['3 days', 3],
  ['5 days', 5],
  ['1 week', 7],
];
const DEFAULT_DAYS = 3;

let items = [];
let urls = [];

// ---------- list ----------

async function load() {
  items = await DB.all();
  render();
}

function render() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];

  const today = Dates.today();
  const sorted = [...items].sort((a, b) => a.expires.localeCompare(b.expires) || a.added - b.added);
  const list = $('list');
  list.replaceChildren();

  for (const item of sorted) {
    const days = Dates.daysLeft(item.expires, today);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item';
    btn.append(thumb(item), text(item, days));
    btn.addEventListener('click', () => openItem(item));
    li.append(btn);
    list.append(li);
  }

  const expired = items.filter((i) => Dates.daysLeft(i.expires, today) < 0).length;
  $('alert').hidden = !expired;
  $('alert').textContent = expired === 1
    ? '1 thing is past its date. Throw it away.'
    : `${expired} things are past their date. Throw them away.`;
  $('empty').hidden = items.length > 0;
  renderOffer();
}

function thumb(item) {
  if (!item.photo) {
    const span = document.createElement('span');
    span.className = 'thumb';
    span.textContent = '🍲';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
  const img = document.createElement('img');
  img.className = 'thumb';
  img.alt = '';
  img.src = objectUrl(item.photo);
  return img;
}

function text(item, days) {
  const wrap = document.createElement('span');
  wrap.className = 'item-text';
  const note = document.createElement('span');
  note.className = 'item-note';
  note.textContent = item.note || 'Leftovers';
  wrap.append(note, badge(days));
  return wrap;
}

function badge(days) {
  const b = document.createElement('span');
  b.className = `badge ${Dates.status(days)}`;
  b.textContent = Dates.label(days);
  return b;
}

function objectUrl(blob) {
  const u = URL.createObjectURL(blob);
  urls.push(u);
  return u;
}

// ---------- chips (shared by "add" and "change date") ----------

// Builds the quick-pick chips plus a "Pick date" chip that reveals a date
// input. onPick(iso) fires on every choice.
function chips(container, onPick, selectedDays) {
  container.replaceChildren();
  const all = [];
  const select = (btn) => all.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));

  for (const [label, days] of CHOICES) {
    const b = chip(label);
    if (days === selectedDays) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => {
      select(b);
      date.hidden = true;
      onPick(Dates.addDays(Dates.today(), days));
    });
    all.push(b);
  }

  const pick = chip('Pick date');
  const date = document.createElement('input');
  date.type = 'date';
  date.hidden = true;
  date.min = Dates.today();
  date.setAttribute('aria-label', 'Expiry date');
  pick.addEventListener('click', () => {
    select(pick);
    date.hidden = false;
    date.value ||= Dates.addDays(Dates.today(), DEFAULT_DAYS);
    date.showPicker?.();
  });
  date.addEventListener('change', () => date.value && onPick(date.value));
  all.push(pick);

  container.append(...all, date);
}

function chip(label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.setAttribute('aria-pressed', 'false');
  return b;
}

// ---------- add ----------

const draft = { photo: null, expires: null };
let previewUrl = null;

$('add').addEventListener('click', () => {
  resetDraft();
  // Straight to the camera. Whether a photo comes back or the camera is
  // dismissed, the sheet opens so a note-only entry is still possible.
  $('camera').click();
});

$('add-photo').addEventListener('click', () => $('camera').click());

$('camera').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) {
    try {
      setPhoto(await shrink(file));
    } catch {
      setPhoto(null);
    }
  }
  showAddSheet();
});
$('camera').addEventListener('cancel', showAddSheet);

function resetDraft() {
  draft.expires = Dates.addDays(Dates.today(), DEFAULT_DAYS);
  setPhoto(null);
  $('add-note').value = '';
  chips($('add-chips'), (iso) => (draft.expires = iso), DEFAULT_DAYS);
}

function setPhoto(blob) {
  draft.photo = blob;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = blob ? URL.createObjectURL(blob) : null;
  $('add-preview').hidden = !blob;
  $('add-preview').src = previewUrl || '';
  $('add-photo-hint').hidden = !!blob;
}

function showAddSheet() {
  if (!$('add-sheet').open) $('add-sheet').showModal();
}

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const item = {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    photo: draft.photo,
    note: $('add-note').value.trim(),
    expires: draft.expires,
    added: Date.now(),
  };
  await DB.put(item);
  items.push(item);
  $('add-sheet').close();
  render();
  changed();
  // Ask the browser not to evict photos when space runs low.
  navigator.storage?.persist?.();
});

// Downscale to ~800px JPEG so a fridge full of photos stays small.
async function shrink(file, max = 800) {
  const img = new Image();
  const src = URL.createObjectURL(file);
  try {
    img.src = src;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
  } finally {
    URL.revokeObjectURL(src);
  }
}

// ---------- item ----------

let current = null;

function openItem(item) {
  current = item;
  const photo = $('item-photo');
  photo.hidden = !item.photo;
  if (item.photo) photo.src = objectUrl(item.photo);
  $('item-note').textContent = item.note || 'Leftovers';
  showWhen(item);
  $('item-date').hidden = true;
  $('item-change').hidden = false;
  $('item-sheet').showModal();
}

function showWhen(item) {
  const when = $('item-when');
  when.replaceChildren(`Eat by ${Dates.longDate(item.expires)}`, badge(Dates.daysLeft(item.expires)));
}

$('item-change').addEventListener('click', () => {
  $('item-change').hidden = true;
  $('item-date').hidden = false;
  chips($('item-chips'), async (iso) => {
    current.expires = iso;
    await DB.put(current);
    showWhen(current);
    render();
    changed();
    // A quick-pick chip is a final answer; a typed date may still be fiddled with.
    if (document.activeElement?.type !== 'date') $('item-sheet').close();
  });
});

$('item-done').addEventListener('click', async () => {
  const gone = current;
  $('item-sheet').close();
  await DB.remove(gone.id);
  items = items.filter((i) => i.id !== gone.id);
  render();
  changed();
  toast(`Removed ${gone.note || 'leftovers'}`, async () => {
    await DB.put(gone);
    items.push(gone);
    render();
    changed();
  });
});

// ---------- shared UI ----------

for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => btn.closest('dialog').close());
}
// Tapping the dimmed backdrop closes a sheet, as people expect.
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => e.target === d && d.close());
}

let toastTimer;
let undoFn;
function toast(msg, undo) {
  $('toast-text').textContent = msg;
  undoFn = undo;
  $('toast-undo').hidden = !undo;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 5000);
}
$('toast-undo').addEventListener('click', () => {
  $('toast').hidden = true;
  clearTimeout(toastTimer);
  undoFn?.();
});

// ---------- reminders ----------

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const configured = Boolean(cfg.pushUrl && cfg.vapidPublicKey);
const canPush = configured && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const SNOOZE_MS = 7 * 864e5;

function offerKind() {
  if (!items.length || !configured) return null;
  let snoozed = 0;
  try { snoozed = Number(localStorage.getItem('offerSnoozed')) || 0; } catch {}
  if (Date.now() - snoozed < SNOOZE_MS) return null;
  // Safari only allows web push for apps opened from the Home Screen.
  if (isIOS && !standalone) return 'ios';
  if (canPush && Notification.permission === 'default') return 'push';
  return null;
}

// A message that replaces the offer after "Turn on", so every outcome is
// visible: {text, retry} where retry shows the button again.
let offerNote = null;

function renderOffer() {
  const kind = offerKind();
  $('offer').hidden = !kind && !offerNote;
  $('offer-text').textContent = offerNote?.text ?? 'Want a reminder before food goes bad?';
  $('offer-yes').hidden = Boolean(offerNote && !offerNote.retry);
  $('offer-yes').textContent = offerNote?.retry ? 'Try again' : 'Turn on';
  $('offer-no').textContent = offerNote && !offerNote.retry ? 'OK' : 'Not now';
}

$('offer-yes').addEventListener('click', async () => {
  if (offerKind() === 'ios') return $('ios-sheet').showModal();
  const btn = $('offer-yes');
  btn.disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await sync();
      offerNote = null;
      toast('Reminders are on. You will get one at 9:00 when food is due.');
    } else if (perm === 'denied') {
      offerNote = {
        text: 'Notifications are blocked for this app. Allow them in your phone or browser settings, then reopen the app.',
        retry: false,
      };
    } else {
      offerNote = { text: 'Tap Allow when your phone asks. Look for a bell icon in the address bar if nothing pops up.', retry: true };
    }
  } catch (err) {
    offerNote = { text: `Could not turn on reminders (${err.message || err}). Check your internet and try again.`, retry: true };
  } finally {
    btn.disabled = false;
    renderOffer();
  }
});

$('offer-no').addEventListener('click', () => {
  if (!offerNote) {
    try { localStorage.setItem('offerSnoozed', String(Date.now())); } catch {}
  }
  offerNote = null;
  renderOffer();
});

function changed() {
  sync().catch(() => {});
}

// Tells the reminder worker which dates to watch. Only dates leave the
// phone: no photos, no notes.
async function sync() {
  if (!canPush || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.vapidPublicKey) });
  const res = await fetch(new URL('sync', cfg.pushUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dates: items.map((i) => i.expires),
    }),
  });
  if (!res.ok) throw new Error(`reminder server said ${res.status}`);
}

// Safari wants the key as bytes, not the base64url text.
function keyBytes(b64url) {
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ---------- start ----------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

// Badges are day-relative; refresh when the app comes back to the front, and
// resync in case an earlier sync failed offline.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load().then(changed);
});

load().then(changed);
