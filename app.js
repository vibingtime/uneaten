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
function pickPhoto(input, onPhoto) {
  photoTarget = onPhoto;
  input.click();
}

$('pick-camera').addEventListener('click', () => pickPhoto($('camera'), setPhoto));
$('pick-gallery').addEventListener('click', () => pickPhoto($('gallery'), setPhoto));
$('photo-change').addEventListener('click', () => setPhoto(null));

for (const input of [$('camera'), $('gallery')]) {
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
// resync in case an earlier sync failed offline.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load().then(changed);
});

load().then(changed);
