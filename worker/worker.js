// ============================================================
//  NERV TRAFFIC — Cloudflare Worker (取得 + 判定 + Web Push 送信)
//  GitHub Actions のスケジュール間引きを避けるため、定期処理は
//  Cloudflare Cron Trigger (確実・最短1分) で実行する。
//
//  KV binding:  SUBS  (購読 / 状態 / 最新ツイートを保存)
//  Vars:        VAPID_PUBLIC_KEY, VAPID_SUBJECT
//  Secrets:     ADMIN_TOKEN, VAPID_PRIVATE_KEY
//
//  Endpoints:
//    GET  /tweets       最新ツイート(取得済み)を返す (公開・アプリ用)
//    POST /subscribe    { subscription }     購読登録 (公開)
//    POST /unsubscribe  { endpoint }         購読解除 (公開)
//    GET  /list         (Bearer ADMIN_TOKEN) 全購読を返す
//    GET  /state        (Bearer ADMIN_TOKEN) 直近の渋滞状態
//    PUT  /state        (Bearer ADMIN_TOKEN) 渋滞状態を保存
//    POST /run          (Bearer ADMIN_TOKEN) 定期処理を手動実行
//  Cron:  scheduled() が tick() を実行 (wrangler.toml の triggers)
// ============================================================

const SCREEN_NAME = 'mlit_himeji';
const TIMELINE_URL =
  `https://syndication.twitter.com/srv/timeline-profile/screen-name/${SCREEN_NAME}?showReplies=false`;
const TWEET_LIMIT = 20;
const APP_URL = 'https://kazunarikanzaki-oss.github.io/kakogawa-bypass-traffic/';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// ============================================================
//  渋滞判定 (scripts/congestion.js と一致させること)
// ============================================================
const RESIDUAL_RE = /渋滞\s*残/;
const CONGESTION_CLEARED_RE = /渋滞[^。\n]{0,8}(解消|解除)/;
const RESIDUAL_TTL_MS = 3 * 60 * 60 * 1000;
const INCIDENT_TTL_MS = 3 * 60 * 60 * 1000;

function mentionsCongestion(text) {
  const s = String(text);
  if (CONGESTION_CLEARED_RE.test(s)) return false;
  const cleaned = s
    .replace(/[#＃]渋滞/g, '')
    .replace(/渋滞情報は[\s\S]*?(ご確認下さい|確認ください|確認下さい)/g, '');
  return /渋滞/.test(cleaned);
}
function isUseless(text) {
  return /【.+(工事規制|規制).*予定】/.test(text) &&
         /国道2号[\s:：]*車線規制を伴う工事予定なし/.test(text);
}
function isClearance(text) {
  if (!/(終了|解消|解除|撤去)/.test(text)) return false;
  return /(事故|故障車|物件落下|通行止|車線規制|規制)/.test(text);
}
function incidentKey(text) {
  const types = ['通行止', '事故', '故障車', '物件落下'];
  const incType = types.find(k => text.includes(k)) || 'その他';
  const kpMatch = text.match(/(\d+(?:\.\d+)?)\s*kp/);
  const kp = kpMatch ? kpMatch[1] : null;
  const tm = text.match(/(\d{1,2})\s*時\s*(\d{1,2})\s*分\s*頃/);
  const incTime = tm ? `${tm[1]}:${tm[2]}` : null;
  if (!kp || !incTime) return `__noKey__${Math.random()}`;
  return `${incType}|${kp}|${incTime}`;
}
function isCritical(text) {
  return /(通行止|事故)/.test(text);
}
function evaluate(tweets, now) {
  now = now || Date.now();
  const pre = (tweets || []).filter(t => !isUseless(t.text));
  const clearedKeys = new Set();
  for (const t of pre) if (isClearance(t.text)) clearedKeys.add(incidentKey(t.text));

  let residual = false;
  const visible = pre.filter(t => {
    if (isClearance(t.text)) {
      if (RESIDUAL_RE.test(t.text) && !CONGESTION_CLEARED_RE.test(t.text)) {
        const ageMs = now - new Date(t.created_at).getTime();
        if (ageMs <= RESIDUAL_TTL_MS) { residual = true; return true; }
      }
      return false;
    }
    if (clearedKeys.has(incidentKey(t.text))) return false;
    return true;
  });

  let hasCrit = false, hasCongestion = residual, headlineTweet = null;
  for (const t of visible) {
    const cleared = isClearance(t.text);
    const stale = (now - new Date(t.created_at).getTime()) > INCIDENT_TTL_MS;
    if (!cleared && !stale && isCritical(t.text)) { hasCrit = true; if (!headlineTweet) headlineTweet = t; }
    if (!stale && mentionsCongestion(t.text)) { hasCongestion = true; if (!headlineTweet) headlineTweet = t; }
  }
  const congested = hasCrit || hasCongestion;
  const headline = congested && headlineTweet
    ? headlineTweet.text.replace(/\s*https?:\/\/\S+/g, '').replace(/\n+/g, ' ').trim().slice(0, 120)
    : null;
  return { congested, headline };
}

// ============================================================
//  ツイート取得 (fetch_tweets.py の移植)
// ============================================================
async function fetchTweets() {
  const r = await fetch(TIMELINE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en;q=0.8',
      'Referer': 'https://platform.twitter.com/',
    },
  });
  if (!r.ok) throw new Error('fetch timeline ' + r.status);
  const html = await r.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ not found');
  const data = JSON.parse(m[1]);
  const entries = data.props.pageProps.timeline.entries || [];
  const out = [];
  for (const e of entries) {
    const t = (e.content || {}).tweet;
    if (!t) continue;
    const urls = [];
    const ents = t.entities || {};
    for (const u of (ents.urls || [])) {
      urls.push({ url: u.url, expanded_url: u.expanded_url, display_url: u.display_url });
    }
    const photos = [];
    for (const md of (((t.extended_entities || {}).media) || [])) {
      if (md.type === 'photo') photos.push(md.media_url_https);
    }
    let createdIso = t.created_at;
    try { createdIso = new Date(t.created_at).toISOString(); } catch {}
    out.push({
      id: t.id_str,
      created_at: createdIso,
      created_at_raw: t.created_at,
      text: t.full_text || t.text || '',
      permalink: t.permalink || `https://x.com/${SCREEN_NAME}/status/${t.id_str}`,
      urls,
      photos,
    });
  }
  out.sort((a, b) => (a.id.length - b.id.length) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  out.reverse();
  return out.slice(0, TWEET_LIMIT);
}

// ============================================================
//  Web Push (VAPID + RFC8291 aes128gcm) — Web Crypto 実装
// ============================================================
const enc = new TextEncoder();
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function bytesToB64url(bytes) {
  let bin = '';
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concatBytes(...arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}
// HKDF (length <= 32: 単一ブロック)
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const out = await hmac(prk, concatBytes(info, new Uint8Array([1])));
  return out.slice(0, length);
}

async function importVapidKey(publicKeyB64, privateKeyB64) {
  const pub = b64urlToBytes(publicKeyB64); // 65 bytes uncompressed
  const d = b64urlToBytes(privateKeyB64);  // 32 bytes
  const x = pub.slice(1, 33), y = pub.slice(33, 65);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: bytesToB64url(d), x: bytesToB64url(x), y: bytesToB64url(y),
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function vapidAuthHeader(endpoint, subject, publicKeyB64, privateKey) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject,
  })));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(signingInput));
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
  return `vapid t=${jwt}, k=${publicKeyB64}`;
}

// RFC 8291: payload を購読鍵で暗号化して body(Uint8Array) を返す
async function encryptPayload(payloadStr, p256dhB64, authB64) {
  const uaPublic = b64urlToBytes(p256dhB64);   // 65 bytes
  const authSecret = b64urlToBytes(authB64);   // 16 bytes

  const asKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey)); // 65 bytes
  const uaPubKey = await crypto.subtle.importKey(
    'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubKey }, asKeys.privateKey, 256));

  const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext = concatBytes(enc.encode(payloadStr), new Uint8Array([2])); // 0x02 = 最終レコード区切り
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

  const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00]); // 4096
  const idlen = new Uint8Array([asPublic.length]);     // 65
  return concatBytes(salt, rs, idlen, asPublic, ciphertext);
}

async function sendPush(sub, payloadStr, env, vapidKey) {
  const endpoint = sub.endpoint;
  const auth = await vapidAuthHeader(endpoint, env.VAPID_SUBJECT || 'mailto:admin@example.com',
    env.VAPID_PUBLIC_KEY, vapidKey);
  const body = await encryptPayload(payloadStr, sub.keys.p256dh, sub.keys.auth);
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    },
    body,
  });
}

// ============================================================
//  定期処理: 取得 → 保存 → 判定 → 遷移時にプッシュ送信
// ============================================================
async function listSubscriptions(env) {
  const out = [];
  let cursor;
  do {
    const res = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const k of res.keys) {
      const v = await env.SUBS.get(k.name);
      if (v) out.push({ key: k.name, sub: JSON.parse(v) });
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  return out;
}

// ツイート集合が前回と変わったか判定するための署名 (id列)。
function tweetsSignature(tweets) {
  return (tweets || []).map(t => t.id).join(',');
}

async function tick(env) {
  // 1) 取得。KV書込は「ツイート集合が前回と変わった時だけ」行う。
  //    (無料枠の書込回数を節約。毎回書くと1日1000回をすぐ超える)
  let tweets = null, tweetsChanged = false;
  try {
    const fresh = await fetchTweets();
    const prevRaw = await env.SUBS.get('tweets');
    const prevSig = prevRaw ? tweetsSignature(JSON.parse(prevRaw).tweets) : null;
    if (tweetsSignature(fresh) !== prevSig) {
      const payload = { screen_name: SCREEN_NAME, fetched_at: new Date().toISOString(), tweets: fresh };
      await env.SUBS.put('tweets', JSON.stringify(payload));
      tweetsChanged = true;
    }
    tweets = fresh;
  } catch (e) {
    const prev = await env.SUBS.get('tweets');
    if (prev) tweets = JSON.parse(prev).tweets;
    else return { ok: false, error: 'fetch failed and no cache: ' + String(e && e.message || e) };
  }

  // 2) 渋滞判定
  const { congested, headline } = evaluate(tweets, Date.now());

  // 3) 前回状態と比較
  const prevRaw = await env.SUBS.get('state');
  const prev = prevRaw ? JSON.parse(prevRaw) : null;
  const prevCongested = prev && typeof prev.congested === 'boolean' ? prev.congested : null;

  // 初回はベースライン保存のみ
  if (prevCongested === null) {
    await env.SUBS.put('state', JSON.stringify({ congested, headline, ts: Date.now() }));
    return { ok: true, transition: false, congested, note: 'baseline', tweetsChanged };
  }
  // 変化なし → KVに書き込まない (書込回数の節約)。状態は前回のままで正しい。
  if (prevCongested === congested) {
    return { ok: true, transition: false, congested, tweetsChanged };
  }

  // 4) 遷移 → プッシュ送信
  const payload = congested
    ? { title: '🚗 加古川・姫路バイパス 渋滞発生', body: headline || '渋滞が発生しています。', tag: 'nerv-congestion', url: APP_URL }
    : { title: '✅ 加古川・姫路バイパス 渋滞解消', body: '渋滞は解消しました。', tag: 'nerv-congestion', url: APP_URL };
  const payloadStr = JSON.stringify(payload);

  const subs = await listSubscriptions(env);
  let sent = 0, pruned = 0;
  if (subs.length) {
    const vapidKey = await importVapidKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    await Promise.all(subs.map(async ({ key, sub }) => {
      try {
        const res = await sendPush(sub, payloadStr, env, vapidKey);
        if (res.status === 404 || res.status === 410) { await env.SUBS.delete(key); pruned++; }
        else if (res.ok || res.status === 201) { sent++; }
      } catch (_) { /* 個別失敗は無視 */ }
    }));
  }

  await env.SUBS.put('state', JSON.stringify({ congested, headline, ts: Date.now() }));
  return { ok: true, transition: true, congested, sent, pruned, subscribers: subs.length };
}

// ============================================================
//  HTTP ハンドラ
// ============================================================
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      // ---- 最新ツイート (公開・アプリ用) ----
      if (path === '/tweets' && request.method === 'GET') {
        const v = await env.SUBS.get('tweets');
        if (!v) return json({ screen_name: SCREEN_NAME, fetched_at: null, tweets: [] });
        return new Response(v, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
        });
      }

      // ---- 購読登録 ----
      if (path === '/subscribe' && request.method === 'POST') {
        const body = await request.json();
        const sub = body && body.subscription;
        if (!sub || !sub.endpoint) return json({ error: 'invalid subscription' }, 400);
        await env.SUBS.put('sub:' + (await sha256hex(sub.endpoint)), JSON.stringify(sub));
        return json({ ok: true }, 201);
      }

      // ---- 購読解除 ----
      if (path === '/unsubscribe' && request.method === 'POST') {
        const body = await request.json();
        const endpoint = body && body.endpoint;
        if (!endpoint) return json({ error: 'endpoint required' }, 400);
        await env.SUBS.delete('sub:' + (await sha256hex(endpoint)));
        return json({ ok: true });
      }

      // ---- 定期処理の手動実行 ----
      if (path === '/run' && request.method === 'POST') {
        if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
        return json(await tick(env));
      }

      // ---- 全購読一覧 ----
      if (path === '/list' && request.method === 'GET') {
        if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
        const subs = await listSubscriptions(env);
        return json({ subscriptions: subs.map(s => s.sub) });
      }

      // ---- 渋滞状態 ----
      if (path === '/state' && request.method === 'GET') {
        if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
        const v = await env.SUBS.get('state');
        return json(v ? JSON.parse(v) : null);
      }
      if (path === '/state' && request.method === 'PUT') {
        if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
        await env.SUBS.put('state', JSON.stringify(await request.json()));
        return json({ ok: true });
      }

      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};
