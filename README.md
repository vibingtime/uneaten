# Uneaten

A tiny phone app for leftovers. Snap a photo, maybe type what it is, tap
**Save**. The fridge list shows what to eat first and what to throw away, and
a reminder pops up at 9:00 when something is due.

- **Add:** tap **+ Add** → the camera opens → (optional note) → pick *Tomorrow
  · 3 days · 5 days · 1 week · Pick date* (3 days is preselected) → **Save**.
- **List:** soonest first, with plain-words badges: *3 days left*, *Eat by
  tomorrow*, *Eat today*, *Expired: throw away*.
- **Done with it:** tap the item → **Eaten or thrown away**. **Undo** is there for 5
  seconds. **Change date** is on the same screen.

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
npx wrangler deploy                       # prints https://uneaten-reminders.<you>.workers.dev
```

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
