// ============================================================
//  NERV TRAFFIC — Web Push 送信 (GitHub Actions 用)
//  tweets.json から渋滞状態を判定し、前回状態(Worker KV)と比較。
//  「渋滞発生」「渋滞解消」への遷移時のみ購読端末へプッシュ送信する。
//
//  必要な環境変数:
//    WORKER_URL          Cloudflare Worker のベースURL
//    ADMIN_TOKEN         Worker の管理トークン
//    VAPID_PUBLIC_KEY    VAPID 公開鍵
//    VAPID_PRIVATE_KEY   VAPID 秘密鍵
//    VAPID_SUBJECT       mailto:... または https://...
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { evaluate } = require('./congestion');

// 非機密の設定は push.config.json から、機密(秘密鍵/管理トークン)は環境変数から。
const fileCfgPath = path.resolve(__dirname, 'push.config.json');
const fileCfg = fs.existsSync(fileCfgPath) ? JSON.parse(fs.readFileSync(fileCfgPath, 'utf-8')) : {};

const WORKER_URL = process.env.WORKER_URL || fileCfg.WORKER_URL;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || fileCfg.VAPID_PUBLIC_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || fileCfg.VAPID_SUBJECT || 'mailto:admin@example.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;        // GitHub Secret
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY; // GitHub Secret

function need(name, v) { if (!v) { console.error(`Missing config: ${name}`); process.exit(1); } }
need('WORKER_URL', WORKER_URL);
need('ADMIN_TOKEN', ADMIN_TOKEN);
need('VAPID_PUBLIC_KEY', VAPID_PUBLIC_KEY);
need('VAPID_PRIVATE_KEY', VAPID_PRIVATE_KEY);

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const base = WORKER_URL.replace(/\/+$/, '');
const admin = { Authorization: `Bearer ${ADMIN_TOKEN}` };

async function api(method, p, body) {
  const r = await fetch(base + p, {
    method,
    headers: { ...admin, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function main() {
  const tweetsPath = path.resolve(__dirname, '..', 'tweets.json');
  if (!fs.existsSync(tweetsPath)) { console.error('tweets.json not found'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(tweetsPath, 'utf-8'));
  const { congested, headline } = evaluate(data.tweets || [], Date.now());

  const prev = await api('GET', '/state');
  const prevCongested = prev && typeof prev.congested === 'boolean' ? prev.congested : null;

  console.log(`state: prev=${prevCongested} now=${congested}`);

  // 初回(基準なし)は通知せずベースラインだけ保存
  if (prevCongested === null) {
    await api('PUT', '/state', { congested, headline, ts: Date.now() });
    console.log('baseline stored (no notification on first run)');
    return;
  }

  // 状態が変わらなければ何もしない (状態は更新して headline を最新化)
  if (prevCongested === congested) {
    await api('PUT', '/state', { congested, headline, ts: Date.now() });
    console.log('no transition');
    return;
  }

  // 遷移検知 → 通知ペイロード作成
  const payload = congested
    ? {
        title: '🚗 加古川・姫路バイパス 渋滞発生',
        body: headline || '渋滞が発生しています。',
        tag: 'nerv-congestion',
        url: 'https://kazunarikanzaki-oss.github.io/kakogawa-bypass-traffic/',
      }
    : {
        title: '✅ 加古川・姫路バイパス 渋滞解消',
        body: '渋滞は解消しました。',
        tag: 'nerv-congestion',
        url: 'https://kazunarikanzaki-oss.github.io/kakogawa-bypass-traffic/',
      };

  const { subscriptions } = await api('GET', '/list');
  console.log(`sending to ${subscriptions.length} subscriber(s): ${payload.title}`);

  let sent = 0, pruned = 0;
  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) {
        // 失効した購読は削除
        try { await api('POST', '/unsubscribe', { endpoint: sub.endpoint }); pruned++; } catch {}
      } else {
        console.error('send error:', code || (e && e.message));
      }
    }
  }));

  await api('PUT', '/state', { congested, headline, ts: Date.now() });
  console.log(`done. sent=${sent} pruned=${pruned}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
