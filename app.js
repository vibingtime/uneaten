// Uneaten: snap leftovers, see what's left, get nudged before it goes off.
'use strict';

const $ = (id) => document.getElementById(id);
const cfg = globalThis.UNEATEN_CONFIG || {};

// How long a kind of food usually keeps decides which expiry choices it offers.
const KEEPS = {
  days: { label: 'A few days', days: 3, choices: [['Tomorrow', 1], ['3 days', 3], ['5 days', 5], ['1 week', 7]] },
  weeks: { label: 'A few weeks', days: 14, choices: [['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['2 months', 60]] },
  months: { label: 'Months', days: 30, choices: [['1 month', 30], ['2 months', 60], ['3 months', 91], ['6 months', 182]] },
};
// Kinds every fridge starts with. The user's own kinds are added from the DB.
const BUILT_IN = {
  leftovers: { id: 'leftovers', label: 'Leftovers', icon: '🍲', keeps: 'days', shelf: 'middle', example: 'Biryani' },
  sauces: { id: 'sauces', label: 'Dips & sauces', icon: '🥫', keeps: 'weeks', shelf: 'door', example: 'Garlic mayo' },
  fruitveg: { id: 'fruitveg', label: 'Fruit & veg', icon: '🥕', keeps: 'days', shelf: 'drawer', example: 'Spinach' },
};
const ICONS = ['🧀', '🥛', '🥚', '🥗', '🍎', '🥕', '🍰', '🍕', '🍗', '🐟', '🍚', '🧃', '🍫', '🥣', '🍲', '🥫'];

// Name limits, counted as a person sees them: an emoji is one character.
const NOTE_MAX = 40;
const KIND_MAX = 20;
const segmenter = globalThis.Intl?.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const chars = (text) => (segmenter ? [...segmenter.segment(text)].map((x) => x.segment) : [...text]);
const clip = (text, max) => chars(text).slice(0, max).join('');
const SHELVES = { top: 'Top shelf', middle: 'Middle shelf', bottom: 'Bottom shelf', drawer: 'Drawer', door: 'Door' };
const PLACES = { top: 'the top shelf', middle: 'the middle shelf', bottom: 'the bottom shelf', drawer: 'the drawer', door: 'the door' };

let items = [];
let kinds = { ...BUILT_IN };
let urls = [];

const cat = (item) => kinds[item.category] ?? kinds.leftovers;
const keepsOf = (c) => KEEPS[c.keeps] ?? KEEPS.days;

// ---------- fridge ----------

async function load() {
  const slow = setTimeout(() => {
    $('alert').hidden = false;
    $('alert').textContent = STUCK;
  }, STUCK_MS);
  try {
    // Items saved before shelves and categories existed go on the middle shelf.
    items = (await DB.all()).map((i) => ({ category: 'leftovers', shelf: 'middle', ...i }));
    kinds = { ...BUILT_IN };
    for (const c of await DB.categories()) kinds[c.id] = c;
  } catch (err) {
    console.error(err);
    render();
    $('alert').hidden = false;
    $('alert').textContent = `Your fridge could not be opened (${err?.message || err}). Close the app and open it again.`;
    return;
  } finally {
    clearTimeout(slow);
  }
  render();
}

function render() {
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];

  const today = Dates.today();
  const sorted = [...items].sort((a, b) => a.expires.localeCompare(b.expires) || a.added - b.added);
  for (const rack of document.querySelectorAll('.rack')) {
    const here = sorted.filter((i) => (SHELVES[i.shelf] ? i.shelf : 'middle') === rack.dataset.shelf);
    rack.querySelector('.rack-items').replaceChildren(...here.map((i) => tile(i, today)));
  }

  const expired = items.filter((i) => Dates.daysLeft(i.expires, today) < 0).length;
  $('alert').hidden = !expired;
  $('alert').textContent = expired === 1
    ? '1 thing is past its date. Throw it away.'
    : `${expired} things are past their date. Throw them away.`;
  $('empty').hidden = items.length > 0;
  showDoorNote();
  $('drag-hint').hidden = !(items.length >= 2 && !seen('dragHint'));
  renderOffer();
}

function tile(item, today) {
  const days = Dates.daysLeft(item.expires, today);
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `tile ${Dates.status(days)}`;
  btn.setAttribute('aria-label', `${item.note || cat(item).label}, ${Dates.label(days)}`);
  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = item.note || cat(item).label;
  const when = document.createElement('span');
  when.className = `tile-when ${Dates.status(days)}`;
  when.textContent = Dates.short(days);
  btn.append(thumb(item), name, when);
  btn.addEventListener('click', () => {
    if (dragJustEnded) return;
    openItem(item);
  });
  btn.addEventListener('pointerdown', (e) => press(e, item, btn));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  li.append(btn);
  return li;
}

function thumb(item) {
  if (!item.photo) {
    const span = document.createElement('span');
    span.className = 'thumb';
    span.textContent = cat(item).icon;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
  const img = document.createElement('img');
  img.className = 'thumb';
  img.alt = '';
  img.draggable = false;
  img.src = objectUrl(item.photo);
  return img;
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

// Tiny per-phone memory (last shelf used, hints seen). Losing it costs nothing.
function remember(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
const seen = (key) => recall(key) === '1';

// Runs a save and, if the phone refuses it, says so instead of silently
// doing nothing.
function safely(fn) {
  return async (...args) => {
    const slow = setTimeout(() => toast(STUCK), STUCK_MS);
    try {
      await fn(...args);
    } catch (err) {
      console.error(err);
      toast(`Could not save (${err?.message || err}). Please try again.`);
    } finally {
      clearTimeout(slow);
    }
  };
}

// The phone queues every save behind an older copy of the app that still has
// the fridge open (another tab, or the installed app in the background). It
// carries on by itself once that copy closes.
const STUCK_MS = 2000;
const STUCK = 'Uneaten is still open somewhere else. Close its other tabs and swipe the app away, and this will finish.';

// ---------- drag between shelves ----------

// Press and hold a tile, then drag it onto another shelf. A quick tap still
// opens the item, and moving early is treated as scrolling the page.
const HOLD_MS = 350;
let pressing = null;
let dragging = null;
let dragJustEnded = false;

function press(e, item, btn) {
  if (e.button > 0 || dragging) return;
  pressing = {
    item, btn, x: e.clientX, y: e.clientY,
    timer: setTimeout(() => lift(e.clientX, e.clientY), HOLD_MS),
  };
}

function lift(x, y) {
  const { item, btn } = pressing;
  pressing = null;
  const box = btn.getBoundingClientRect();
  const ghost = btn.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.style.width = `${box.width}px`;
  document.body.append(ghost);
  dragging = { item, btn, ghost, dx: x - box.left, dy: y - box.top };
  btn.classList.add('lifted');
  document.body.classList.add('dragging');
  navigator.vibrate?.(15);
  follow(x, y);
}

function follow(x, y) {
  const { ghost, dx, dy } = dragging;
  ghost.style.transform = `translate(${x - dx}px, ${y - dy}px) scale(1.08)`;
  const over = rackAt(x, y);
  for (const r of document.querySelectorAll('.rack')) r.classList.toggle('drop', r === over);
}

function rackAt(x, y) {
  return document.elementFromPoint(x, y)?.closest('.rack') ?? null;
}

function endDrag(x, y) {
  const { item, btn, ghost } = dragging;
  dragging = null;
  ghost.remove();
  btn.classList.remove('lifted');
  document.body.classList.remove('dragging');
  for (const r of document.querySelectorAll('.rack')) r.classList.remove('drop');
  // The browser follows pointerup with a click; don't let it open the item.
  dragJustEnded = true;
  setTimeout(() => (dragJustEnded = false), 50);
  const to = x == null ? null : rackAt(x, y)?.dataset.shelf;
  if (to && to !== item.shelf) moveTo(item, to);
}

function cancelPress() {
  if (pressing) clearTimeout(pressing.timer);
  pressing = null;
}

document.addEventListener('pointermove', (e) => {
  if (dragging) return follow(e.clientX, e.clientY);
  if (pressing && Math.hypot(e.clientX - pressing.x, e.clientY - pressing.y) > 10) cancelPress();
});
document.addEventListener('pointerup', (e) => {
  if (dragging) endDrag(e.clientX, e.clientY);
  else cancelPress();
});
document.addEventListener('pointercancel', () => {
  if (dragging) endDrag(null, null);
  else cancelPress();
});
// Once an item is lifted, a finger moving must drag it, not scroll the page.
document.addEventListener('touchmove', (e) => dragging && e.preventDefault(), { passive: false });

const moveTo = safely(async (item, shelf) => {
  const from = item.shelf;
  item.shelf = shelf;
  await DB.put(item);
  remember('dragHint', '1');
  render();
  toast(`Moved to ${PLACES[shelf]}`, async () => {
    item.shelf = from;
    await DB.put(item);
    render();
  });
});

// ---------- chips ----------

// One-of-many buttons. options: [[value, label], ...]; onPick(value).
function pickOne(container, options, selected, onPick) {
  container.replaceChildren();
  const all = options.map(([value, label]) => {
    const b = chip(label);
    b.setAttribute('aria-pressed', String(value === selected));
    b.addEventListener('click', () => {
      all.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onPick(value);
    });
    return b;
  });
  container.append(...all);
}

// Expiry quick picks plus a "Pick date" chip that reveals a date input.
// onPick(iso) fires on every choice.
function dateChips(container, choices, onPick, selectedDays, fallbackDays) {
  pickOne(container, [...choices.map(([label, days]) => [days, label]), ['pick', 'Pick date']], selectedDays, (v) => {
    date.hidden = v !== 'pick';
    if (v !== 'pick') return onPick(Dates.addDays(Dates.today(), v));
    date.value ||= Dates.addDays(Dates.today(), fallbackDays);
    date.showPicker?.();
  });
  const date = document.createElement('input');
  date.type = 'date';
  date.hidden = true;
  date.min = Dates.today();
  date.setAttribute('aria-label', 'Expiry date');
  date.addEventListener('change', () => date.value && onPick(date.value));
  container.append(date);
}

function chip(label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.setAttribute('aria-pressed', 'false');
  return b;
}

const shelfOptions = Object.entries(SHELVES);

// Stops a text box at `max` characters (typed or pasted) and shows a small
// "34/40" counter once the end is near.
function limit(input, counter, max) {
  const update = () => {
    if (chars(input.value).length > max) input.value = clip(input.value, max);
    const n = chars(input.value).length;
    counter.hidden = n < max - 10;
    counter.textContent = `${n}/${max}`;
  };
  input.addEventListener('input', update);
  return update;
}
const refreshNoteCount = limit($('add-note'), $('add-note-count'), NOTE_MAX);
const refreshKindCount = limit($('kind-name'), $('kind-name-count'), KIND_MAX);

// ---------- add ----------

const draft = { photo: null, category: 'leftovers', shelf: 'middle', expires: null };
let previewUrl = null;

$('add').addEventListener('click', () => {
  resetDraft();
  $('add-sheet').showModal();
});

// The camera and gallery pickers are shared by the add sheet and the item
// screen; `photoTarget` says who gets the picture.
let photoTarget = null;
// The camera or gallery opening sends the app to the background; coming back
// from that is not "opening the app again", so the door stays as it was.
let pickingPhoto = false;
function pickPhoto(input, onPhoto) {
  photoTarget = onPhoto;
  pickingPhoto = true;
  input.click();
}

$('pick-camera').addEventListener('click', () => pickPhoto($('camera'), setPhoto));
$('pick-gallery').addEventListener('click', () => pickPhoto($('gallery'), setPhoto));
$('photo-change').addEventListener('click', () => setPhoto(null));

for (const input of [$('camera'), $('gallery')]) {
  // If the picker never left the app, don't let the flag outlive it.
  const done = () => setTimeout(() => (pickingPhoto = false), 1500);
  input.addEventListener('cancel', done);
  input.addEventListener('change', done);
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file || !photoTarget) return;
    let blob;
    try {
      blob = await shrink(file);
    } catch {
      return toast('That picture could not be opened. Try another one.');
    }
    await photoTarget(blob);
  });
}

function resetDraft() {
  setPhoto(null);
  $('add-note').value = '';
  refreshNoteCount();
  closeKindForm();
  setCategory('leftovers');
}

// The kind chips: built-in kinds, the user's own, and "+ New kind".
function renderKinds() {
  const options = Object.values(kinds).map((c) => [c.id, `${c.icon} ${c.label}`]);
  pickOne($('add-category'), [...options, ['new', '+ New kind']], draft.category, (key) => {
    if (key === 'new') openKindForm(null);
    else setCategory(key);
  });
  $('kind-edit').hidden = Boolean(BUILT_IN[draft.category]) || !$('kind-form').hidden;
}

// Switching kind resets the shelf and expiry to what suits that kind.
function setCategory(key) {
  const c = kinds[key] ?? kinds.leftovers;
  const k = keepsOf(c);
  closeKindForm();
  draft.category = c.id;
  draft.shelf = SHELVES[recall(`shelf:${c.id}`)] ? recall(`shelf:${c.id}`) : c.shelf;
  draft.expires = Dates.addDays(Dates.today(), k.days);
  $('add-note').placeholder = c.example ?? '';
  renderKinds();
  pickOne($('add-shelf'), shelfOptions, draft.shelf, (s) => (draft.shelf = s));
  dateChips($('add-chips'), k.choices, (iso) => (draft.expires = iso), k.days, k.days);
}

// ---------- your own kinds ----------

const kindDraft = { id: null, icon: ICONS[0], keeps: 'days', shelf: 'middle' };

function openKindForm(c) {
  Object.assign(kindDraft, c ? { id: c.id, icon: c.icon, keeps: c.keeps, shelf: c.shelf }
    : { id: null, icon: ICONS[0], keeps: 'days', shelf: 'middle' });
  $('kind-title').textContent = c ? 'Edit kind' : 'New kind';
  $('kind-save').textContent = c ? 'Save kind' : 'Add kind';
  $('kind-delete').hidden = !c;
  $('kind-error').hidden = true;
  $('kind-name').value = c?.label ?? '';
  refreshKindCount();
  pickOne($('kind-icon'), ICONS.map((i) => [i, i]), kindDraft.icon, (i) => (kindDraft.icon = i));
  pickOne($('kind-keeps'), Object.entries(KEEPS).map(([k, v]) => [k, v.label]), kindDraft.keeps, (k) => (kindDraft.keeps = k));
  pickOne($('kind-shelf'), shelfOptions, kindDraft.shelf, (s) => (kindDraft.shelf = s));
  $('kind-form').hidden = false;
  $('kind-edit').hidden = true;
  // One obvious next step: finish the kind before saving the item.
  $('add-actions').hidden = true;
  $('kind-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('kind-name').focus({ preventScroll: true });
}

function closeKindForm() {
  $('kind-form').hidden = true;
  $('add-actions').hidden = false;
}

$('kind-edit').addEventListener('click', () => openKindForm(kinds[draft.category]));
$('kind-cancel').addEventListener('click', () => setCategory(draft.category));
// Enter in the name box saves the kind, not the whole item.
$('kind-name').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  $('kind-save').click();
});

$('kind-save').addEventListener('click', safely(async () => {
  const label = clip($('kind-name').value.trim(), KIND_MAX);
  const clash = Object.values(kinds).find((c) => c.id !== kindDraft.id && c.label.toLowerCase() === label.toLowerCase());
  $('kind-error').textContent = !label ? 'Give it a name first.' : clash ? `You already have “${clash.label}”.` : '';
  $('kind-error').hidden = !$('kind-error').textContent;
  if (!$('kind-error').hidden) return;
  const c = {
    id: kindDraft.id ?? `k-${Date.now().toString(36)}`,
    label, icon: kindDraft.icon, keeps: kindDraft.keeps, shelf: kindDraft.shelf,
  };
  await DB.putCategory(c);
  kinds[c.id] = c;
  remember(`shelf:${c.id}`, c.shelf);
  setCategory(c.id);
  render();
}));

$('kind-delete').addEventListener('click', safely(async () => {
  const c = kinds[kindDraft.id];
  const using = items.filter((i) => i.category === c.id);
  const what = using.length === 1 ? '1 item' : `${using.length} items`;
  if (!confirm(`Delete “${c.label}”?${using.length ? ` ${what} will become Leftovers.` : ''}`)) return;
  for (const i of using) {
    i.category = 'leftovers';
    await DB.put(i);
  }
  await DB.removeCategory(c.id);
  delete kinds[c.id];
  setCategory('leftovers');
  render();
}));

function setPhoto(blob) {
  draft.photo = blob;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = blob ? URL.createObjectURL(blob) : null;
  $('add-preview').hidden = !blob;
  $('add-preview').src = previewUrl || '';
  $('photo-buttons').hidden = !!blob;
  $('photo-change').hidden = !blob;
}

$('add-form').addEventListener('submit', safely(async (e) => {
  e.preventDefault();
  const item = {
    id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    photo: draft.photo,
    note: clip($('add-note').value.trim(), NOTE_MAX),
    category: draft.category,
    shelf: draft.shelf,
    expires: draft.expires,
    added: Date.now(),
  };
  await DB.put(item);
  items.push(item);
  remember(`shelf:${item.category}`, item.shelf);
  $('add-sheet').close();
  setDoor(true); // show where it went (quietly; the chime is for tapping the door)
  render();
  changed();
  // Ask the browser not to evict photos when space runs low.
  navigator.storage?.persist?.();
}));

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
  showItemPhoto(item);
  showName(item);
  stopRename();
  showWhen(item);
  $('item-date').hidden = true;
  $('item-move').hidden = true;
  $('item-sheet').showModal();
}

// ---------- the dish's photo ----------

// Kept apart from the shelf thumbnails' URLs, which render() replaces.
let itemPhotoUrl = null;

function showItemPhoto(item, picking = false) {
  if (itemPhotoUrl) URL.revokeObjectURL(itemPhotoUrl);
  itemPhotoUrl = item.photo ? URL.createObjectURL(item.photo) : null;
  $('item-photo').hidden = !item.photo;
  $('item-photo').src = itemPhotoUrl ?? '';
  // No photo: offer the two buttons straight away. A photo: "Change photo".
  $('item-photo-pick').hidden = Boolean(item.photo) && !picking;
  $('item-photo-change').hidden = !item.photo || picking;
  $('item-photo-remove').hidden = !item.photo;
}

const setItemPhoto = safely(async (photo) => {
  const item = current;
  const before = item.photo;
  item.photo = photo;
  await DB.put(item);
  if (current === item) showItemPhoto(item);
  render();
  toast(photo ? (before ? 'Photo changed' : 'Photo added') : 'Photo removed', async () => {
    item.photo = before;
    await DB.put(item);
    if (current === item && $('item-sheet').open) showItemPhoto(item);
    render();
  });
});

$('item-photo-change').addEventListener('click', () => showItemPhoto(current, true));
$('item-pick-camera').addEventListener('click', () => pickPhoto($('camera'), setItemPhoto));
$('item-pick-gallery').addEventListener('click', () => pickPhoto($('gallery'), setItemPhoto));
$('item-photo-remove').addEventListener('click', () => setItemPhoto(null));

function showName(item) {
  $('item-note').textContent = item.note || cat(item).label;
}

// ---------- rename ----------

// Tap a name to change it: the name turns into a text box. Enter, "Save name"
// or tapping elsewhere saves; Escape keeps the old name.
function editable({ shown, box, input, counter, saveBtn, max, start, commit }) {
  let on = false;
  const refresh = limit(input, counter, max);
  const stop = () => {
    on = false;
    shown.hidden = false;
    box.hidden = true;
  };
  const save = safely(async () => {
    if (!on) return;
    const value = clip(input.value.trim(), max);
    stop();
    await commit(value);
  });
  shown.querySelector('button').addEventListener('click', () => {
    on = true;
    start(input);
    refresh();
    shown.hidden = true;
    box.hidden = false;
    input.focus();
    input.select();
  });
  saveBtn.addEventListener('click', save);
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault(); // keep the sheet open
      stop();
    }
  });
  return { stop };
}

const itemRename = editable({
  shown: $('item-name').closest('h2'),
  box: $('item-rename'),
  input: $('item-rename-input'),
  counter: $('item-rename-count'),
  saveBtn: $('item-rename-save'),
  max: NOTE_MAX,
  start: (input) => {
    input.value = current.note;
    input.placeholder = cat(current).example ?? cat(current).label;
  },
  commit: async (note) => {
    if (note === current.note) return;
    current.note = note;
    showName(current);
    await DB.put(current);
    render();
  },
});
const stopRename = () => itemRename.stop();

// The fridge's own name, kept on this phone.
const FRIDGE_MAX = 24;
const fridgeName = () => recall('fridgeName') || 'My fridge';
function showFridgeName() {
  $('fridge-name-text').textContent = fridgeName();
  // Long names get a slightly smaller title so they stay on one line.
  $('fridge-name').closest('h1').classList.toggle('long', chars(fridgeName()).length > 14);
}
editable({
  shown: $('fridge-name').closest('h1'),
  box: $('fridge-rename'),
  input: $('fridge-rename-input'),
  counter: $('fridge-rename-count'),
  saveBtn: $('fridge-rename-save'),
  max: FRIDGE_MAX,
  start: (input) => (input.value = recall('fridgeName') ?? ''),
  commit: (name) => {
    remember('fridgeName', name === 'My fridge' ? '' : name);
    showFridgeName();
  },
});
showFridgeName();

function showWhen(item) {
  $('item-where').textContent = `${cat(item).icon} ${cat(item).label} · ${SHELVES[item.shelf] ?? SHELVES.middle}`;
  $('item-when').replaceChildren(`Eat by ${Dates.longDate(item.expires)}`, badge(Dates.daysLeft(item.expires)));
}

$('item-change').addEventListener('click', () => {
  $('item-move').hidden = true;
  $('item-date').hidden = false;
  const k = keepsOf(cat(current));
  dateChips($('item-chips'), k.choices, safely(async (iso) => {
    current.expires = iso;
    await DB.put(current);
    showWhen(current);
    render();
    changed();
    // A quick-pick chip is a final answer; a typed date may still be fiddled with.
    if (document.activeElement?.type !== 'date') $('item-sheet').close();
  }), null, k.days);
});

$('item-relocate').addEventListener('click', () => {
  $('item-date').hidden = true;
  $('item-move').hidden = false;
  pickOne($('item-shelf'), shelfOptions, current.shelf, (shelf) => {
    $('item-sheet').close();
    if (shelf !== current.shelf) moveTo(current, shelf);
  });
});

$('item-done').addEventListener('click', safely(async () => {
  const gone = current;
  $('item-sheet').close();
  await DB.remove(gone.id);
  items = items.filter((i) => i.id !== gone.id);
  render();
  changed();
  toast(`Removed ${gone.note || cat(gone).label.toLowerCase()}`, async () => {
    await DB.put(gone);
    items.push(gone);
    render();
    changed();
  });
}));

// ---------- shared UI ----------

for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => btn.closest('dialog').close());
}
// A message shown inside a sheet moves back to the page when the sheet closes,
// so it stays visible (and Undo stays tappable).
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('close', () => {
    if ($('toast').parentElement === d) document.body.append($('toast'));
  });
}

// Tapping the dimmed backdrop closes a sheet, as people expect. A tap on the
// sheet's own padding also reports the dialog as its target, so check the
// tap really landed outside the sheet.
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) d.close();
  });
}

let toastTimer;
let undoFn;
function toast(msg, undo) {
  // An open sheet blocks everything behind it, so show the message inside it
  // to keep Undo tappable.
  const host = [...document.querySelectorAll('dialog')].find((d) => d.open) ?? document.body;
  if ($('toast').parentElement !== host) host.append($('toast'));
  $('toast').classList.toggle('in-sheet', host !== document.body);
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

// ---------- fridge door ----------

// The fridge starts closed. Tapping the door plays a chime and swings it
// open; "Close door" shuts it again. The door's note says what is inside.
function setDoor(open) {
  $('fridge').classList.toggle('closed', !open);
  $('fridge-door').tabIndex = open ? -1 : 0;
  $('fridge-door').setAttribute('aria-hidden', String(open));
  // While closed, what is behind the door can't be tapped or reached.
  for (const part of $('fridge').querySelectorAll(':scope > .cabinet, :scope > .door')) part.inert = !open;
}
setDoor(false);

function showDoorNote() {
  const n = items.length;
  $('door-count').textContent = n === 0 ? 'Empty' : n === 1 ? '1 thing inside' : `${n} things inside`;
  $('fridge-door').setAttribute('aria-label', `Open the fridge. ${$('door-count').textContent}.`);
}

$('fridge-door').addEventListener('click', () => {
  playDoorSound();
  setDoor(true);
});
$('door-close').addEventListener('click', () => {
  stopDoorSound();
  setDoor(false);
});

// ---------- door sound ----------

// What plays when the door opens: the built-in chime, a sound file the user
// picked from their own phone (kept only on the phone, never uploaded), or
// nothing.
const SOUND_MAX_BYTES = 5 * 1024 * 1024;
const soundMode = () => recall('doorSound') || 'chime';
let customSound = null; // {audio, url, name}, ready to play straight from a tap

async function loadCustomSound() {
  try {
    const saved = await DB.doorSound();
    if (saved?.blob) useCustomSound(saved.blob, saved.name);
  } catch {}
}

function useCustomSound(blob, name) {
  if (customSound) URL.revokeObjectURL(customSound.url);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = 'auto';
  customSound = { audio, url, name };
}

function playDoorSound() {
  const mode = soundMode();
  if (mode === 'off') return;
  if (mode === 'custom' && customSound) {
    // Called straight from the tap so phones allow the sound to play.
    customSound.audio.currentTime = 0;
    customSound.audio.play().catch(() => chime());
    return;
  }
  chime();
}

function stopDoorSound() {
  customSound?.audio.pause();
}

// Checks the browser can actually play a file before keeping it.
// Checks the phone can play a file before keeping it. Decoding the sound is
// the reliable test on phones; asking a media element is the fallback.
async function playable(file) {
  try {
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
    await ctx.decodeAudioData(await file.arrayBuffer());
    return true;
  } catch {}
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const a = new Audio();
      const finish = (ok) => { clearTimeout(timer); a.removeAttribute('src'); resolve(ok); };
      const timer = setTimeout(() => finish(false), 8000);
      a.addEventListener('loadedmetadata', () => finish(true), { once: true });
      a.addEventListener('error', () => finish(false), { once: true });
      a.preload = 'metadata'; // some phones load nothing unless asked
      a.src = url;
      a.load();
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Phones often report MP3s and friends as "unknown type"; label them from
// the file name so they play back later.
const AUDIO_TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };
function asAudio(file) {
  if (file.type.startsWith('audio/')) return file;
  const type = AUDIO_TYPES[file.name.split('.').pop().toLowerCase()];
  return type ? new Blob([file], { type }) : file;
}

function renderSoundSheet() {
  const mode = soundMode();
  pickOne($('sound-choices'), [['chime', '🎵 Built-in chime'], ['custom', '📁 My own sound'], ['off', '🔇 No sound']], mode, (m) => {
    if (m === 'custom' && !customSound) return $('sound-input').click();
    remember('doorSound', m);
    renderSoundSheet();
  });
  $('sound-file').hidden = mode !== 'custom' || !customSound;
  $('sound-file').textContent = customSound ? `Your sound: ${customSound.name}` : '';
  $('sound-pick').hidden = mode !== 'custom';
  $('sound-pick').textContent = customSound ? 'Choose a different file' : 'Choose a sound file';
  $('sound-play').hidden = mode === 'off';
}

// ---------- settings ----------

$('settings-btn').addEventListener('click', () => {
  renderSoundSheet();
  renderColors();
  $('settings-sheet').showModal();
});
$('sound-pick').addEventListener('click', () => $('sound-input').click());
$('sound-play').addEventListener('click', () => {
  stopDoorSound();
  playDoorSound();
});
$('settings-sheet').addEventListener('close', stopDoorSound);

// ---------- door color ----------

// The door (closed and open) and the fridge's frame follow one color; shades
// for the shine and edges are mixed from it in CSS. Kept on this phone.
const DEFAULT_DOOR = '#dde4e7';
const DOOR_COLORS = [
  ['#dde4e7', 'Classic steel'], ['#f7f7f4', 'White'], ['#2c3135', 'Black'], ['#c8323c', 'Red'],
  ['#a8dcc5', 'Mint'], ['#a9cfee', 'Sky blue'], ['#f3e3a1', 'Butter yellow'], ['#f2b8c6', 'Pink'],
];
const doorColor = () => (/^#[0-9a-f]{6}$/i.test(recall('doorColor') ?? '') ? recall('doorColor').toLowerCase() : DEFAULT_DOOR);

function applyDoorColor(hex) {
  document.documentElement.style.setProperty('--door', hex);
}

function setDoorColor(hex) {
  remember('doorColor', hex);
  applyDoorColor(hex);
  renderColors();
}

// The color buttons are made once and only re-marked afterwards: rebuilding
// them mid-tap (when leaving the color code box saves) would swallow the tap.
$('door-swatches').append(...DOOR_COLORS.map(([hex, name]) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.style.background = hex;
  b.dataset.color = hex;
  b.setAttribute('aria-label', name);
  b.title = name;
  b.addEventListener('click', () => setDoorColor(hex));
  return b;
}));

function renderColors() {
  const current = doorColor();
  for (const b of $('door-swatches').children) b.setAttribute('aria-pressed', String(b.dataset.color === current));
  showPicker(current);
}

// ---------- color picker ----------

// Hue (0-360), saturation and value (0-1). The square sets saturation (left
// to right) and value (top to bottom); the rainbow bar sets the hue. Dragging
// recolors the door live; letting go saves.
const hsv = { h: 0, s: 0, v: 1 };

function hsvToHex({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function hexToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

// Moves the controls to show `hex`. The hue is kept for greys, which have none.
function showPicker(hex) {
  const next = hexToHsv(hex);
  if (next.s === 0) next.h = hsv.h;
  Object.assign(hsv, next);
  drawPicker(hex);
}

// `typing` is true while the color code box itself is being edited, so the
// box is not rewritten under the person's fingers.
function drawPicker(hex = hsvToHex(hsv), typing = false) {
  const sv = $('sv');
  sv.style.setProperty('--hue', hsv.h);
  sv.style.setProperty('--s', hsv.s);
  sv.style.setProperty('--v', hsv.v);
  sv.setAttribute('aria-valuetext', hex);
  $('hue').value = Math.round(hsv.h);
  if (!typing) $('hex').value = hex;
}

function previewPicked(typing = false) {
  const hex = hsvToHex(hsv);
  applyDoorColor(hex);
  drawPicker(hex, typing);
  for (const b of $('door-swatches').children) b.setAttribute('aria-pressed', 'false');
}

const savePicked = () => setDoorColor(hsvToHex(hsv));

function svAt(e) {
  const r = $('sv').getBoundingClientRect();
  hsv.s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  hsv.v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  previewPicked();
}

$('sv').addEventListener('pointerdown', (e) => {
  $('sv').setPointerCapture(e.pointerId);
  svAt(e);
});
$('sv').addEventListener('pointermove', (e) => $('sv').hasPointerCapture(e.pointerId) && svAt(e));
$('sv').addEventListener('pointerup', savePicked);
$('sv').addEventListener('keydown', (e) => {
  const step = { ArrowRight: [0.02, 0], ArrowLeft: [-0.02, 0], ArrowUp: [0, 0.02], ArrowDown: [0, -0.02] }[e.key];
  if (!step) return;
  e.preventDefault();
  hsv.s = Math.min(1, Math.max(0, hsv.s + step[0]));
  hsv.v = Math.min(1, Math.max(0, hsv.v + step[1]));
  previewPicked();
  savePicked();
});
$('hue').addEventListener('input', () => {
  hsv.h = Number($('hue').value);
  // Picking a hue on a grey would show no change, so give it some color.
  if (hsv.s < 0.15) hsv.s = 0.6;
  if (hsv.v < 0.15) hsv.v = 0.85;
  previewPicked();
});
$('hue').addEventListener('change', savePicked);
$('hex').addEventListener('input', () => {
  let v = $('hex').value.trim().toLowerCase();
  if (!v.startsWith('#')) v = '#' + v;
  if (!/^#[0-9a-f]{6}$/.test(v)) return;
  Object.assign(hsv, hexToHsv(v));
  previewPicked(true);
});
$('hex').addEventListener('change', () => {
  let v = $('hex').value.trim().toLowerCase();
  if (!v.startsWith('#')) v = '#' + v;
  if (/^#[0-9a-f]{6}$/.test(v)) setDoorColor(v);
  else $('hex').value = doorColor(); // not a color code: put the current one back
});
$('hex').addEventListener('keydown', (e) => e.key === 'Enter' && $('hex').blur());
applyDoorColor(doorColor());

$('sound-input').addEventListener('change', safely(async () => {
  const file = $('sound-input').files[0];
  $('sound-input').value = '';
  if (!file) return renderSoundSheet();
  if (file.size > SOUND_MAX_BYTES) {
    renderSoundSheet();
    return toast('That sound file is too big. Pick one under 5 MB, a few seconds long.');
  }
  const sound = asAudio(file);
  if (!(await playable(sound))) {
    renderSoundSheet();
    return toast('That file could not be played. Try an MP3 or M4A sound.');
  }
  await DB.putDoorSound(sound, file.name);
  useCustomSound(sound, file.name);
  remember('doorSound', 'custom');
  renderSoundSheet();
  playDoorSound(); // let them hear it
  toast('Door sound saved');
}));
$('sound-input').addEventListener('cancel', renderSoundSheet);
loadCustomSound();

// An original, cheerful door chime (a rising bell arpeggio), synthesized so
// there is no sound file to download. Plays only from a tap, as browsers
// require.
let audio = null;
function chime() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const start = audio.currentTime + 0.03;
    const out = audio.createGain();
    out.gain.value = 0.2;
    out.connect(audio.destination);
    // [frequency in Hz, start offset, ring time] — G5 C6 E6 G6, then a high C.
    const notes = [[784, 0, 0.6], [1047, 0.14, 0.6], [1319, 0.28, 0.6], [1568, 0.42, 0.7], [2093, 0.62, 1.4]];
    for (const [freq, at, ring] of notes) {
      // A bell: the note plus a quieter, slightly sour overtone.
      for (const [mult, level] of [[1, 1], [2.76, 0.22]]) {
        const osc = audio.createOscillator();
        const env = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * mult;
        env.gain.setValueAtTime(0.0001, start + at);
        env.gain.exponentialRampToValueAtTime(level, start + at + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, start + at + ring);
        osc.connect(env).connect(out);
        osc.start(start + at);
        osc.stop(start + at + ring + 0.05);
      }
    }
  } catch {
    // No sound is fine; the door still opens.
  }
}

// ---------- fridge light ----------

// Just for fun: tap the light to switch it on and off. It starts off, and
// the phone remembers if it was switched on.
function setLight(on) {
  $('fridge').classList.toggle('light-off', !on);
  $('light').setAttribute('aria-pressed', String(on));
}
$('light').addEventListener('click', () => {
  const on = $('light').getAttribute('aria-pressed') !== 'true';
  setLight(on);
  remember('light', on ? 'on' : 'off');
});
setLight(recall('light') === 'on');

// ---------- reminders ----------

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const configured = Boolean(cfg.pushUrl && cfg.vapidPublicKey);
const canPush = configured && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const SNOOZE_MS = 7 * 864e5;

// The reminder server is private: it needs the passcode its owner set. It is
// asked for once and kept on the phone; if the server rejects it, ask again.
let keyRejected = false;
const syncKey = () => recall('syncKey') || '';
const needsKey = () => !syncKey() || keyRejected;

function offerKind() {
  if (!items.length || !configured) return null;
  // Reminders already on but the passcode is missing or wrong: they would
  // silently stop updating, so ask even if the offer was snoozed.
  if (canPush && Notification.permission === 'granted' && needsKey()) return 'key';
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
  const askKey = needsKey() && (kind === 'push' || kind === 'key' || Boolean(offerNote?.retry));
  $('offer').hidden = !kind && !offerNote;
  $('offer-text').textContent = offerNote?.text ?? (kind === 'key'
    ? 'Enter the reminder passcode to keep your reminders coming.'
    : 'Want a reminder before food goes bad?');
  $('offer-key-field').hidden = !askKey;
  $('offer-yes').hidden = Boolean(offerNote && !offerNote.retry);
  $('offer-yes').textContent = offerNote?.retry ? 'Try again' : kind === 'key' ? 'Save passcode' : 'Turn on';
  $('offer-no').textContent = offerNote && !offerNote.retry ? 'OK' : 'Not now';
}

$('offer-yes').addEventListener('click', async () => {
  if (offerKind() === 'ios') return $('ios-sheet').showModal();
  const btn = $('offer-yes');
  if (!$('offer-key-field').hidden) {
    const key = $('offer-key').value.trim();
    if (!key) {
      offerNote = { text: 'Type the reminder passcode first.', retry: true };
      return renderOffer();
    }
    remember('syncKey', key);
    keyRejected = false;
  }
  btn.disabled = true;
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm === 'granted') {
      await sync();
      offerNote = null;
      $('offer-key').value = '';
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
    offerNote = err.status === 401
      ? { text: 'That passcode did not work. Check it and try again.', retry: true }
      : err.status === 403
        ? { text: 'The reminder server already has its 5 phones, so this one cannot join.', retry: false }
        : { text: `Could not turn on reminders (${err.message || err}). Check your internet and try again.`, retry: true };
  } finally {
    btn.disabled = false;
    renderOffer();
  }
});
$('offer-key').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  $('offer-yes').click();
});

$('offer-no').addEventListener('click', () => {
  if (!offerNote) {
    try { localStorage.setItem('offerSnoozed', String(Date.now())); } catch {}
  }
  offerNote = null;
  renderOffer();
});

function changed() {
  // A background update the server refused for the passcode: ask for it.
  sync().catch((err) => err.status === 401 && renderOffer());
}

// Tells the reminder worker which dates to watch. Only dates leave the
// phone: no photos, no notes.
async function sync() {
  if (!canPush || Notification.permission !== 'granted') return;
  if (!syncKey()) return renderOffer();
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.vapidPublicKey) });
  const res = await fetch(new URL('sync', cfg.pushUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-uneaten-key': syncKey() },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      dates: items.map((i) => i.expires),
    }),
  });
  if (res.status === 401) {
    keyRejected = true;
    remember('syncKey', '');
  }
  if (!res.ok) throw Object.assign(new Error(`reminder server said ${res.status}`), { status: res.status });
}

// Safari wants the key as bytes, not the base64url text.
function keyBytes(b64url) {
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ---------- start ----------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

// Badges are day-relative; refresh when the app comes back to the front, and
// resync in case an earlier sync failed offline. Coming back to the app also
// finds the fridge door closed, as on a fresh start.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (pickingPhoto) pickingPhoto = false;
  else setDoor(false);
  load().then(changed);
});

load().then(changed);
