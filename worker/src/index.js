// Uneaten reminder worker (Cloudflare Workers + KV, no dependencies).
//
//   POST   /sync  {subscription, tz, dates[]}  remember what to watch
//   DELETE /sync  {endpoint}                    forget a phone
//   cron hourly                                 9:00 local -> one Web Push
//
// Only expiry dates are stored, never photos or notes. The push carries a
// rough count; the phone's service worker rewrites it from its own data.

import '../../dates.js';

const Dates = globalThis.Dates;
const REMIND_HOUR = 9;
const enc = new TextEncoder();

export default {
  async fetch(req, env) {
    const cors = {
      'access-control-allow-origin': env.ALLOWED_ORIGIN,
      'access-control-allow-methods': 'POST, DELETE',
      'access-control-allow-headers': 'content-type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (url.pathname !== '/sync') return new Response('Not found', { status: 404, headers: cors });

    let body;
    try {
      body = await req.json();
    } catch {
      return new Response('Bad JSON', { status: 400, headers: cors });
    }

    if (req.method === 'DELETE' && typeof body.endpoint === 'string') {
      await env.SUBS.delete(await keyFor(body.endpoint));
      return new Response(null, { status: 204, headers: cors });
    }

    if (req.method === 'POST' && valid(body)) {
      const key = await keyFor(body.subscription.endpoint);
      const old = await env.SUBS.get(key, 'json');
      await env.SUBS.put(key, JSON.stringify({
        subscription: body.subscription,
        tz: body.tz,
        dates: body.dates,
        lastSent: old?.lastSent ?? null,
      }));
      return new Response(null, { status: 204, headers: cors });
    }

    return new Response('Bad request', { status: 400, headers: cors });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(remindAll(env, new Date()));
  },
};

function valid(b) {
  const s = b?.subscription;
  return s && typeof s.endpoint === 'string' && s.endpoint.startsWith('https://')
    && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string'
    && typeof b.tz === 'string' && b.tz.length < 64
    && Array.isArray(b.dates) && b.dates.length <= 500
    && b.dates.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
}

async function keyFor(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(endpoint));
  return 'sub:' + b64url(hash);
}

// ---------- the daily decision ----------

export function localNow(tz, now) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
      }).formatToParts(now).map((p) => [p.type, p.value])
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  } catch {
    return localNow('UTC', now);
  }
}

// The message to send for this record right now, or null.
export function reminderFor(record, now) {
  const { date, hour } = localNow(record.tz, now);
  if (hour !== REMIND_HOUR || record.lastSent === date) return null;
  const summary = Dates.summary(record.dates, date);
  return summary && { date, summary };
}

async function remindAll(env, now) {
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const { name } of page.keys) {
      const record = await env.SUBS.get(name, 'json');
      const due = record && reminderFor(record, now);
      if (!due) continue;
      const res = await sendPush(record.subscription, { summary: due.summary }, env);
      if (res.status === 404 || res.status === 410) {
        await env.SUBS.delete(name); // the phone unsubscribed or reinstalled
      } else if (res.ok) {
        await env.SUBS.put(name, JSON.stringify({ ...record, lastSent: due.date }));
      } else {
        console.log('push failed', res.status, await res.text());
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

// ---------- Web Push (RFC 8291 payload + RFC 8292 VAPID) ----------

export async function sendPush(subscription, payload, env) {
  const endpoint = new URL(subscription.endpoint);
  const body = await encrypt(subscription.keys, enc.encode(JSON.stringify(payload)));
  const jwt = await vapidJwt(endpoint.origin, env);
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(12 * 3600),
      urgency: 'normal',
    },
    body,
  });
}

async function vapidJwt(aud, env) {
  const key = await crypto.subtle.importKey(
    'jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const head = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT,
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

// aes128gcm content encoding, single record. `salt` and `local` are only
// passed by tests to reproduce the RFC 8291 example.
export async function encrypt(keys, plaintext, salt, local) {
  const uaPublic = unb64url(keys.p256dh);
  const auth = unb64url(keys.auth);
  salt ??= crypto.getRandomValues(new Uint8Array(16));
  local ??= await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);

  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([2])); // 0x02: last record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

// Single-block HKDF (length <= 32), which is all Web Push needs.
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) out.set(p, (i += p.length) - p.length);
  return out;
}

function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
