// NoSmoke — Cloudflare Worker
// VAPID Web Push scheduling with KV storage + Cron delivery

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── Byte helpers ────────────────────────────────────────────────────────────

function b64uDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function b64uEncode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ─── VAPID JWT ────────────────────────────────────────────────────────────────

async function vapidAuthHeader(endpoint, pubKey, privKey) {
  const pub = b64uDecode(pubKey);
  const x = b64uEncode(pub.slice(1, 33));
  const y = b64uEncode(pub.slice(33, 65));

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: privKey, x, y, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );

  const { protocol, host } = new URL(endpoint);
  const enc = o => b64uEncode(new TextEncoder().encode(JSON.stringify(o)));
  const header  = enc({ typ: 'JWT', alg: 'ES256' });
  const payload = enc({ aud: `${protocol}//${host}`, exp: Math.floor(Date.now() / 1000) + 43200, sub: 'mailto:alexandru.brasoveanu7@gmail.com' });
  const sig = b64uEncode(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`)
  ));

  return `vapid t=${header}.${payload}.${sig},k=${pubKey}`;
}

// ─── Web Push encryption (RFC 8291 / aes128gcm) ──────────────────────────────

async function encryptPayload(subscription, plaintext) {
  const p256dh = b64uDecode(subscription.keys.p256dh);
  const auth   = b64uDecode(subscription.keys.auth);

  const serverPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPub  = new Uint8Array(await crypto.subtle.exportKey('raw', serverPair.publicKey));

  const subKey = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: subKey }, serverPair.privateKey, 256));

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Stage 1: IKM from shared secret + auth
  const s1 = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: auth, info: concat(new TextEncoder().encode('WebPush: info\0'), p256dh, serverPub) },
    s1, 256
  ));

  // Stage 2: CEK + nonce from salt + IKM
  const s2 = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const cek = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: aes128gcm\0') },
    s2, { name: 'AES-GCM', length: 128 }, false, ['encrypt']
  );
  const nonce = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: nonce\0') },
    s2, 96
  ));

  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cek,
    concat(new TextEncoder().encode(plaintext), new Uint8Array([2]))
  ));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([65]), serverPub, ciphertext);
}

// ─── Send one push ────────────────────────────────────────────────────────────

async function sendPush(subscription, title, body, env) {
  const payload   = JSON.stringify({ title, body });
  const [auth, encrypted] = await Promise.all([
    vapidAuthHeader(subscription.endpoint, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY),
    encryptPayload(subscription, payload),
  ]);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', TTL: '86400', Urgency: 'normal' },
    body: encrypted,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`Push failed ${res.status}: ${text}`);
  } else {
    console.log(`Push sent OK ${res.status}`);
  }
  return res;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return new Response('OK', { status: 200, headers: CORS });

    let body;
    try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400, headers: CORS }); }

    const { action, subscription, tag, title, message, sendAt } = body;

    if (action === 'cancel') {
      await env.KV.delete(tag).catch(() => {});
      return new Response('OK', { status: 200, headers: CORS });
    }

    if (action === 'cancelAll') {
      const list = await env.KV.list();
      await Promise.all(list.keys.map(k => env.KV.delete(k.name)));
      return new Response('OK', { status: 200, headers: CORS });
    }

    if (!subscription || !sendAt) return new Response('OK', { status: 200, headers: CORS }); // ping

    await env.KV.put(
      tag || crypto.randomUUID(),
      JSON.stringify({ subscription, title, body: message, sendAt }),
      { expiration: Math.floor(sendAt / 1000) + 3600 }
    );
    return new Response('Scheduled', { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  },

  async scheduled(event, env) {
    const now  = Date.now();
    const list = await env.KV.list();
    await Promise.all(list.keys.map(async ({ name }) => {
      const raw = await env.KV.get(name);
      if (!raw) return;
      const { subscription, title, body, sendAt } = JSON.parse(raw);
      if (sendAt <= now + 60000) {
        await sendPush(subscription, title, body, env).catch(e => console.error('sendPush error:', e.message));
        await env.KV.delete(name);
      }
    }));
  },
};
