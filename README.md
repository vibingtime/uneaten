# Uneaten

A tiny phone app for leftovers. Snap a photo, maybe type what it is, tap
**Save**. The fridge list shows what to eat first and what to throw away, and
a reminder pops up at 9:00 when something is due.

- **Add:** tap **+ Add** → **Take photo** or **Choose from gallery** → pick
  *Leftovers*, *Dips & sauces* or *Fruit & veg* → (optional name) → pick a shelf → pick how
  long it keeps → **Save**. Each kind has its own expiry choices (leftovers:
  days; dips & sauces: weeks to months) and its usual spot (sauces go on the
  door). The app remembers the last shelf you used for each kind.
- **Your own kinds:** tap **+ New kind** → name it (e.g. *Dairy*) → pick a
  picture → say how long it usually keeps (*a few days*, *a few weeks* or
  *months*) and which shelf it goes on. Choose your kind, then tap **Edit this
  kind** to rename or delete it. Deleting a kind turns its items into Leftovers.
- **Door:** the fridge starts closed, with a note saying how much is inside.
  Tap the door: a little chime plays and it swings open. **Close door** at the
  bottom of the open door shuts it. Saving a new dish opens it to show where it
  went.
- **Fridge:** inside is an open fridge with a top, middle and bottom
  shelf, a fruit & veg drawer and a door rack. Every item shows a plain-words badge, such as *3 days*,
  *Tomorrow*, *Today* or *Throw away*. Tap the light at the top to switch it
  on and off (it starts off).
- **Move:** press and hold an item, then drag it to another shelf. **Move
  shelf** on the item's screen does the same thing.
- **Done with it:** tap the item → **Eaten or thrown away**. **Undo** is there
  for 5 seconds. **Change date** is on the same screen.
- **Photo:** forgot one, or want a better one? Tap the dish → **Take photo** /
  **Choose from gallery**, or **Change photo** → … / **Remove photo**. Each
  change saves at once and can be undone.
- **Rename:** tap a dish's name on its screen (✏️) to change it, or tap
  **My fridge** at the top to name your fridge. Enter or tapping elsewhere
  saves; Escape keeps the old name.

Everything (photos included) stays on the phone in IndexedDB. Works offline.
Plain HTML/CSS/JS, no build step.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Publish the app

Enable GitHub Pages for this repo (Settings → Pages → deploy from branch, root).
After changing any cached file, bump `VERSION` in `sw.js`.

## Reminders (optional)

Web Push needs a small server to wake the phone. `worker/` is a free-tier
Cloudflare Worker. Each time the fridge changes, the app sends it **only the
expiry dates** (no photos, no notes) plus the phone's timezone. Every hour the
worker checks which phones are at 9:00 local time and have something due today or
tomorrow (or already expired), and sends one encrypted push to each. The phone's
service worker then writes the exact message from its own data.

Leave `config.js` empty and the app simply never offers reminders.

```sh
cd worker
node gen-vapid.mjs                        # prints a public key and a private JWK
npx wrangler kv namespace create SUBS     # paste the id into wrangler.toml
# wrangler.toml: set ALLOWED_ORIGIN, VAPID_SUBJECT, VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_JWK # paste the private JWK
npx wrangler secret put SYNC_KEY          # choose a reminder passcode
npx wrangler deploy                       # prints https://uneaten-reminders.<you>.workers.dev
```

**Keeping it private:** the site is public, so the worker only accepts phones
that send the passcode (`SYNC_KEY`), and at most 5 of them (set `MAX_PHONES`
under `[vars]` to change that). Phones already signed up keep working when the
limit is reached. With no `SYNC_KEY` set, nobody can sign up. The app asks for
the passcode once when **Turn on** is tapped and keeps it on the phone; if the
passcode changes, it asks again.

Then fill in `config.js` with the worker URL (ending in `/`) and the public key,
bump `VERSION` in `sw.js`, and push.

**iPhone:** Safari only allows web push for apps opened from the Home
Screen (iOS 16.4+). The app shows the *Share → Add to Home Screen* steps when it
is opened in Safari.

## Tests

```sh
node --test worker/test.mjs   # date maths, 9:00 timezone rule, push encoding
```

Icons: edit `icon.svg`, then `node tools/make-icons.mjs` (needs Playwright).
