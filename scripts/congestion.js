// ============================================================
//  渋滞判定ロジック (サーバ/Action 用)
//  クライアント app.js の判定と一致させること。
//  純粋関数のみ。Node から require して使う。
// ============================================================
'use strict';

const RESIDUAL_RE = /渋滞\s*残/;                          // 渋滞残有 / 渋滞残あり / 渋滞残り
const CONGESTION_CLEARED_RE = /渋滞[^。\n]{0,8}(解消|解除)/; // 渋滞解消 / 渋滞は解除 等
const RESIDUAL_TTL_MS = 3 * 60 * 60 * 1000;              // 渋滞残: 3時間で自動的に解消扱い

// 定型文「渋滞情報は…ご確認下さい」とハッシュタグ ＃渋滞 はほぼ全投稿に付くため
// 除外し、実際に渋滞が発生・残存している記述だけを渋滞とみなす。
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

// tweets: [{text, created_at}], now: epoch ms
// returns { congested: bool, headline: string|null }
function evaluate(tweets, now) {
  now = now || Date.now();
  const pre = (tweets || []).filter(t => !isUseless(t.text));

  const clearedKeys = new Set();
  for (const t of pre) {
    if (isClearance(t.text)) clearedKeys.add(incidentKey(t.text));
  }

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

  let hasCrit = false, hasCongestion = residual;
  let headlineTweet = null;
  for (const t of visible) {
    const cleared = isClearance(t.text);
    if (!cleared && isCritical(t.text)) {
      hasCrit = true;
      if (!headlineTweet) headlineTweet = t;
    }
    if (mentionsCongestion(t.text)) {
      hasCongestion = true;
      if (!headlineTweet) headlineTweet = t;
    }
  }

  const congested = hasCrit || hasCongestion;
  const headline = congested && headlineTweet
    ? headlineTweet.text.replace(/\s*https?:\/\/\S+/g, '').replace(/\n+/g, ' ').trim().slice(0, 120)
    : null;
  return { congested, headline };
}

module.exports = {
  RESIDUAL_RE, CONGESTION_CLEARED_RE, RESIDUAL_TTL_MS,
  mentionsCongestion, isUseless, isClearance, incidentKey, isCritical, evaluate,
};
