// node --test worker/test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderFor, localNow, encrypt } from './src/index.js';

const D = globalThis.Dates;

test('day maths and labels', () => {
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.daysLeft('2026-10-18', '2026-10-18'), 0);
  assert.equal(D.daysLeft('2026-03-30', '2026-03-28'), 2); // across a DST change
  assert.equal(D.label(-1), 'Expired: throw away');
  assert.equal(D.label(0), 'Eat today');
  assert.equal(D.label(1), 'Eat by tomorrow');
  assert.equal(D.label(4), '4 days left');
  assert.deepEqual([-2, 0, 1, 2].map(D.status), ['expired', 'soon', 'soon', 'ok']);
  assert.deepEqual([-1, 0, 1, 5, 13, 14, 27, 30, 60, 91, 182].map(D.short),
    ['Throw away', 'Today', 'Tomorrow', '5 days', '13 days', '2 weeks', '3 weeks',
      '1 month', '2 months', '3 months', '6 months']);
});

test('summary counts only what needs attention', () => {
  const t = '2026-10-18';
  assert.equal(D.summary(['2026-10-25'], t), null);
  assert.equal(
    D.summary(['2026-10-18', '2026-10-19', '2026-10-19', '2026-10-10'], t),
    '1 thing to eat today, 2 things to eat by tomorrow, 1 thing to throw away'
  );
});

test('local time follows the phone timezone', () => {
  const now = new Date('2026-10-18T23:30:00Z');
  assert.deepEqual(localNow('Asia/Tokyo', now), { date: '2026-10-19', hour: 8 });
  assert.deepEqual(localNow('America/New_York', now), { date: '2026-10-18', hour: 19 });
  assert.deepEqual(localNow('Not/AZone', now), { date: '2026-10-18', hour: 23 });
});

test('reminds at 9:00 local, once a day, only when something is due', () => {
  const rec = { tz: 'Asia/Kolkata', dates: ['2026-10-19'], lastSent: null };
  const nine = new Date('2026-10-18T03:30:00Z'); // 09:00 IST
  const ten = new Date('2026-10-18T04:30:00Z');
  assert.deepEqual(reminderFor(rec, nine), { date: '2026-10-18', summary: '1 thing to eat by tomorrow' });
  assert.equal(reminderFor(rec, ten), null);
  assert.equal(reminderFor({ ...rec, lastSent: '2026-10-18' }, nine), null);
  assert.equal(reminderFor({ ...rec, dates: ['2026-10-30'] }, nine), null);
  assert.equal(reminderFor({ ...rec, dates: [] }, nine), null);
});

test('encrypted payload has the aes128gcm header layout', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', ua.publicKey)).toString('base64url');
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
  const body = await encrypt({ p256dh, auth }, new TextEncoder().encode('hi'));
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(body[20], 65);
  assert.equal(body.length, 16 + 4 + 1 + 65 + 2 + 1 + 16); // + plaintext, delimiter, tag
});
