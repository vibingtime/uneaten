#!/usr/bin/env node
// Makes a VAPID key pair for Web Push. Run once:  node worker/gen-vapid.mjs
// The public key goes in config.js and wrangler.toml; the private JWK goes
// into `npx wrangler secret put VAPID_PRIVATE_JWK` and nowhere else.

const { subtle } = globalThis.crypto;
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const jwk = await subtle.exportKey('jwk', pair.privateKey);

console.log('Public key (config.js vapidPublicKey and wrangler.toml VAPID_PUBLIC_KEY):\n');
console.log(raw);
console.log('\nPrivate JWK (paste when `wrangler secret put VAPID_PRIVATE_JWK` asks):\n');
console.log(JSON.stringify(jwk));
