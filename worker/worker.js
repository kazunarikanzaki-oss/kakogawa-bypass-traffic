// ============================================================
//  NERV TRAFFIC — Push subscription store (Cloudflare Worker)
//  KV binding:  SUBS
//  Secret:      ADMIN_TOKEN  (GitHub Action 用の管理トークン)
//
//  Endpoints:
//    POST /subscribe    { subscription }     購読登録 (公開)
//    POST /unsubscribe  { endpoint }         購読解除 (公開)
//    GET  /list         (Bearer ADMIN_TOKEN) 全購読を返す (Action用)
//    GET  /state        (Bearer ADMIN_TOKEN) 直近の渋滞状態を返す
//    PUT  /state        (Bearer ADMIN_TOKEN) 渋滞状態を保存
// ============================================================

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

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      // ---- 購読登録 ----
      if (path === '/subscribe' && request.method === 'POST') {
        const body = await request.json();
        const sub = body && body.subscription;
        if (!sub || !sub.endpoint) return json({ error: 'invalid subscription' }, 400);
        const key = 'sub:' + (await sha256hex(sub.endpoint));
        await env.SUBS.put(key, JSON.stringify(sub));
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

      // ---- 全購読一覧 (Action用) ----
      if (path === '/list' && request.method === 'GET') {
        if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
        const out = [];
        let cursor;
        do {
          const res = await env.SUBS.list({ prefix: 'sub:', cursor });
          for (const k of res.keys) {
            const v = await env.SUBS.get(k.name);
            if (v) out.push(JSON.parse(v));
          }
          cursor = res.list_complete ? null : res.cursor;
        } while (cursor);
        return json({ subscriptions: out });
      }

      // ---- 渋滞状態の取得 / 保存 (Action用) ----
      if (path === '/state' && request.method === 'GET') {
        if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
        const v = await env.SUBS.get('state');
        return json(v ? JSON.parse(v) : null);
      }
      if (path === '/state' && request.method === 'PUT') {
        if (!requireAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
        const body = await request.json();
        await env.SUBS.put('state', JSON.stringify(body));
        return json({ ok: true });
      }

      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};
