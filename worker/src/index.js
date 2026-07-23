/* JaviTrader — Worker de avisos (Web Push)
 * ------------------------------------------------------------------
 * Rutas:
 *   POST /subscribe    { subscription, topics }  -> guarda/actualiza (upsert)
 *   POST /unsubscribe  { endpoint }              -> borra
 *   POST /send         { topic, title, body, url, icon?, tag? }
 *                      Authorization: Bearer <ADMIN_TOKEN>  -> envía a la categoría
 *   GET  /vapidPublicKey                         -> devuelve la clave pública
 *
 * Almacenamiento: KV (binding SUBS). Clave = "sub:" + endpoint.
 * Envío Web Push: VAPID (ES256 JWT) + cifrado aes128gcm (RFC 8291/8188)
 * con WebCrypto — sin dependencias externas.
 */

const TOPICS = ['novedades', 'comunidad', 'macro', 'formacion'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/vapidPublicKey' && request.method === 'GET') {
        return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, cors);
      }
      if (url.pathname === '/subscribe' && request.method === 'POST') {
        return await handleSubscribe(request, env, cors);
      }
      if (url.pathname === '/unsubscribe' && request.method === 'POST') {
        return await handleUnsubscribe(request, env, cors);
      }
      if (url.pathname === '/send' && request.method === 'POST') {
        return await handleSend(request, env, ctx, cors);
      }
      return json({ error: 'not_found' }, 404, cors);
    } catch (err) {
      return json({ error: 'server_error', detail: String(err && err.message || err) }, 500, cors);
    }
  }
};

// ===================== RUTAS =====================

async function handleSubscribe(request, env, cors) {
  const data = await request.json();
  const sub = data && data.subscription;
  let topics = Array.isArray(data && data.topics) ? data.topics : [];
  topics = topics.filter((t) => TOPICS.includes(t));

  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return json({ error: 'invalid_subscription' }, 400, cors);
  }
  if (topics.length === 0) {
    // Sin categorías = borrar (equivale a desuscribirse)
    await env.SUBS.delete(key(sub.endpoint));
    return json({ ok: true, topics: [] }, 200, cors);
  }

  const record = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    topics: topics,
    ts: Date.now()
  };
  await env.SUBS.put(key(sub.endpoint), JSON.stringify(record), {
    metadata: { topics: topics }
  });
  return json({ ok: true, topics: topics }, 200, cors);
}

async function handleUnsubscribe(request, env, cors) {
  const data = await request.json();
  if (!data || !data.endpoint) return json({ error: 'missing_endpoint' }, 400, cors);
  await env.SUBS.delete(key(data.endpoint));
  return json({ ok: true }, 200, cors);
}

async function handleSend(request, env, ctx, cors) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401, cors);
  }
  const data = await request.json();
  const topic = data && data.topic;
  if (!TOPICS.includes(topic)) return json({ error: 'invalid_topic' }, 400, cors);
  if (!data.title || !data.body) return json({ error: 'missing_fields' }, 400, cors);

  const payload = JSON.stringify({
    title: String(data.title),
    body: String(data.body),
    url: data.url ? String(data.url) : 'https://javitrader.net/',
    icon: data.icon ? String(data.icon) : undefined,
    tag: data.tag ? String(data.tag) : topic,
    topic: topic
  });

  // Recorre las suscripciones (KV list paginado) y envía a las de esta categoría
  let cursor = undefined;
  let sent = 0, pruned = 0, failed = 0, total = 0;

  do {
    const list = await env.SUBS.list({ prefix: 'sub:', cursor, limit: 1000 });
    for (const k of list.keys) {
      const t = (k.metadata && k.metadata.topics) || null;
      if (t && !t.includes(topic)) continue; // filtro rápido por metadata
      const raw = await env.SUBS.get(k.name);
      if (!raw) continue;
      let rec;
      try { rec = JSON.parse(raw); } catch (e) { continue; }
      if (!rec.topics || !rec.topics.includes(topic)) continue;
      total++;
      const res = await sendPush(rec, payload, env);
      if (res.ok) sent++;
      else if (res.gone) { await env.SUBS.delete(k.name); pruned++; }
      else failed++;
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  return json({ ok: true, topic, total, sent, pruned, failed }, 200, cors);
}

// ===================== WEB PUSH =====================

async function sendPush(rec, payloadStr, env) {
  try {
    const endpoint = rec.endpoint;
    const body = await encryptPayload(payloadStr, rec.keys.p256dh, rec.keys.auth);
    const jwt = await vapidJWT(endpoint, env);

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': '2419200',
        'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`
      },
      body
    });
    if (resp.status === 404 || resp.status === 410) return { ok: false, gone: true };
    if (resp.ok) return { ok: true };
    return { ok: false, gone: false, status: resp.status };
  } catch (e) {
    return { ok: false, gone: false, error: String(e && e.message || e) };
  }
}

// --- Cifrado del payload: RFC 8291 (deriva IKM) + RFC 8188 (aes128gcm) ---
async function encryptPayload(payloadStr, clientP256dhB64, clientAuthB64) {
  const enc = new TextEncoder();
  const clientPub = b64urlToBytes(clientP256dhB64); // 65 bytes
  const authSecret = b64urlToBytes(clientAuthB64);   // 16 bytes
  const plaintext = enc.encode(payloadStr);

  // 1) Par efímero del servidor (ECDH P-256)
  const serverKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey)); // 65

  // 2) Secreto ECDH compartido
  const clientPubKey = await crypto.subtle.importKey(
    'raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPubKey }, serverKeys.privateKey, 256
  )); // 32

  // 3) IKM = HKDF(salt=auth, ikm=shared, info="WebPush: info\0"||clientPub||serverPub, L=32)
  const keyInfo = concat(enc.encode('WebPush: info\0'), clientPub, serverPubRaw);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // 4) salt aleatorio (16) -> CEK (16) y NONCE (12) vía HKDF (RFC 8188)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // 5) Cifrado AES-128-GCM. Registro único -> delimitador 0x02 al final del texto.
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const record = concat(plaintext, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, record
  ));

  // 6) Cabecera aes128gcm: salt(16) | rs(4=BE) | idlen(1) | keyid(serverPub 65) | ciphertext
  const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00]); // 4096
  const idlen = new Uint8Array([serverPubRaw.length]); // 65
  return concat(salt, rs, idlen, serverPubRaw, ciphertext);
}

// HKDF-SHA256 (Extract+Expand) devolviendo `length` bytes
async function hkdf(salt, ikm, info, length) {
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, baseKey, length * 8
  );
  return new Uint8Array(bits);
}

// --- VAPID: JWT ES256 firmado con la clave privada ---
async function vapidJWT(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud, exp: now + 12 * 3600, sub: env.VAPID_SUBJECT };

  const signingInput =
    b64url(new TextEncoder().encode(JSON.stringify(header))) + '.' +
    b64url(new TextEncoder().encode(JSON.stringify(payload)));

  const privKey = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privKey, new TextEncoder().encode(signingInput)
  )); // r||s (64 bytes), formato JOSE
  return signingInput + '.' + b64url(sig);
}

// Reconstruye la JWK privada (d + coords x,y de la pública) para firmar
async function importVapidPrivateKey(privB64, pubB64) {
  const pub = b64urlToBytes(pubB64); // 0x04 || X(32) || Y(32)
  const x = b64url(pub.slice(1, 33));
  const y = b64url(pub.slice(33, 65));
  const jwk = { kty: 'EC', crv: 'P-256', d: privB64, x, y, ext: true };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// ===================== UTILIDADES =====================

function key(endpoint) { return 'sub:' + endpoint; }

function concat(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || '*'),
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors || {})
  });
}
