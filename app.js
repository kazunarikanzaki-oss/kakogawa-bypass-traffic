(() => {
  const updated   = document.getElementById('updated');
  const statusEl  = document.getElementById('status');
  const congEdge  = document.getElementById('congEdge');
  const reloadBtn = document.getElementById('reload');
  const simBtn    = document.getElementById('simulate');
  const tweetsEl  = document.getElementById('tweets');
  const tweetsFetchedEl = document.getElementById('tweetsFetched');
  const tweetsReloadBtn = document.getElementById('tweetsReload');
  const notifyBtn = document.getElementById('notifyToggle');

  // ============================================================
  //  Severity model
  // ============================================================
  const SEV = { normal: 0, caution: 1, alert: 2 };
  const maxSev = (...lvs) => lvs.reduce((acc, l) => SEV[l] > SEV[acc] ? l : acc, 'normal');

  // ============================================================
  //  Utility
  // ============================================================
  const fmt2 = n => String(n).padStart(2, '0');
  const setClock = () => {
    const d = new Date();
    updated.textContent = `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}:${fmt2(d.getSeconds())}`;
  };
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
  const safeHref = (u) => {
    if (!u) return '#';
    const s = String(u).trim();
    if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
    if (s.startsWith('/') || s.startsWith('./') || s.startsWith('#')) return s;
    return '#';
  };
  const fmtRel = (createdAt) => {
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return '';
    const min = Math.floor((Date.now() - d.getTime()) / 60000);
    if (min < 1) return 'たった今';
    if (min < 60) return `${min}分前`;
    if (min < 1440) return `${Math.floor(min/60)}時間前`;
    return `${Math.floor(min/1440)}日前`;
  };
  const fmtAbs = (createdAt) => {
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('ja-JP', {timeZone:'Asia/Tokyo', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
  };

  // ============================================================
  //  Camera matching
  // ============================================================
  const CAMERAS = [
    { name: '加古川東', re: /加古川東/,         img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00453.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/kako_e.html' },
    { name: '加古川',   re: /加古川(?![バ東])/, img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00454.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/kako.html' },
    { name: '高砂北',   re: /高砂北/,           img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00457.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/takasago_n.html' },
    { name: '別所',     re: /別所/,             img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00461.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/bessho1.html' },
    { name: '姫路東',   re: /姫路東/,           img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00463.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/himeji_e.html' },
    { name: '市川',     re: /市川/,             img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00464.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/ichikawa.html' },
  ];
  const matchCameras = (text) => {
    const found = []; const seen = new Set();
    for (const c of CAMERAS) {
      if (c.re.test(text) && !seen.has(c.name)) { found.push(c); seen.add(c.name); }
    }
    return found;
  };

  const refreshCams = () => {
    document.querySelectorAll('img.cam').forEach(img => {
      img.src = `${img.dataset.src}?t=${Date.now()}`;
    });
  };
  // 画像取得失敗フォールバック (event delegation)
  document.addEventListener('error', (e) => {
    const tgt = e.target;
    if (tgt && tgt.tagName === 'IMG' && tgt.classList.contains('cam') && !tgt.dataset.failed) {
      tgt.dataset.failed = '1';
      tgt.style.background = '#1a0808';
      tgt.alt = '画像取得失敗';
      tgt.removeAttribute('src');
    }
  }, true);

  // Expose for tests
  window.__nerv = window.__nerv || {};

  // ============================================================
  //  Tweet classification
  // ============================================================
  // 渋滞シグナル判定:
  //   定型文「渋滞情報は(…)をご確認下さい」やハッシュタグ ＃渋滞 はほぼ全投稿に
  //   付くため除外し、実際に渋滞が発生・残存している記述だけを渋滞とみなす。
  const RESIDUAL_RE = /渋滞\s*残/;                          // 渋滞残有 / 渋滞残あり / 渋滞残り
  const CONGESTION_CLEARED_RE = /渋滞[^。\n]{0,8}(解消|解除)/; // 渋滞解消 / 渋滞は解除 等
  const mentionsCongestion = (text) => {
    const s = String(text);
    if (CONGESTION_CLEARED_RE.test(s)) return false;       // 渋滞解消の記述があれば渋滞ではない
    const cleaned = s
      .replace(/[#＃]渋滞/g, '')                            // ハッシュタグ ＃渋滞
      .replace(/渋滞情報は[\s\S]*?(ご確認下さい|確認ください|確認下さい)/g, ''); // 定型文
    return /渋滞/.test(cleaned);
  };

  const classifyTags = (text) => {
    // 「【○月○日 …工事規制予定】」形式は将来/予定のお知らせであり、
    // 実際の渋滞・規制ではないため info 扱いとし、ステータスを上げない。
    if (isSchedule(text)) return [{label:'工事予定', kind:'info'}];
    const tags = [];
    if (/通行止/.test(text))           tags.push({label:'通行止', kind:'critical'});
    if (/事故/.test(text))             tags.push({label:'事故', kind:'critical'});
    if (/故障車/.test(text))           tags.push({label:'故障車', kind:'warn'});
    if (/車線規制|追越車線|走行車線|車線閉鎖|規制/.test(text))
                                        tags.push({label:'規制', kind:'warn'});
    if (mentionsCongestion(text))      tags.push({label:'渋滞', kind:'warn'});
    if (/工事/.test(text))             tags.push({label:'工事', kind:'info'});
    const seen = new Set();
    return tags.filter(t => seen.has(t.label) ? false : seen.add(t.label));
  };
  const detectDirection = (text) => {
    const up   = /上り|大阪方面|神戸方面|東行/;
    const down = /下り|岡山方面|姫路方面|広島方面|西行/;
    const u = up.test(text), d = down.test(text);
    if (u && !d) return {label:'上り (神戸方面)', kind:'up'};
    if (d && !u) return {label:'下り (姫路方面)', kind:'down'};
    if (u && d)  return {label:'上下', kind:'both'};
    return null;
  };
  const detectArea = (text) => {
    const areas = [];
    if (/加古川バイパス/.test(text)) areas.push('加古川BP');
    if (/姫路バイパス/.test(text))   areas.push('姫路BP');
    if (/太子竜野バイパス/.test(text)) areas.push('太子竜野BP');
    if (!areas.length && /国道2号|国道2|R2/.test(text)) areas.push('国道2号');
    return areas;
  };
  const isUseless = (text) => {
    return /【.+(工事規制|規制).*予定】/.test(text) &&
           /国道2号[\s:：]*車線規制を伴う工事予定なし/.test(text);
  };
  // 「【○月○日 昼間/夜間の工事規制予定】」形式 = 将来の予定お知らせ。
  // 本文に「車線規制」が含まれていてもステータスを上げない。
  const isSchedule = (text) => /【[^】]*工事規制予定】/.test(text);
  const isClearance = (text) => {
    if (!/(終了|解消|解除|撤去)/.test(text)) return false;
    return /(事故|故障車|物件落下|通行止|車線規制|規制)/.test(text);
  };
  const incidentKey = (text) => {
    const types = ['通行止','事故','故障車','物件落下'];
    const incType = types.find(k => text.includes(k)) || 'その他';
    const kpMatch = text.match(/(\d+(?:\.\d+)?)\s*kp/);
    const kp = kpMatch ? kpMatch[1] : null;
    const tm = text.match(/(\d{1,2})\s*時\s*(\d{1,2})\s*分\s*頃/);
    const incTime = tm ? `${tm[1]}:${tm[2]}` : null;
    if (!kp || !incTime) return `__noKey__${Math.random()}`;
    return `${incType}|${kp}|${incTime}`;
  };

  // Expose pure functions for testing
  Object.assign(window.__nerv, {
    classifyTags, detectDirection, detectArea,
    isUseless, isSchedule, isClearance, incidentKey, matchCameras,
    mentionsCongestion
  });

  // ============================================================
  //  Linkify
  // ============================================================
  const linkify = (text, urls) => {
    let s = escapeHtml(text);
    for (const u of (urls || [])) {
      if (!u.url) continue;
      const display = escapeHtml(u.display_url || u.expanded_url || u.url);
      const exp = escapeHtml(safeHref(u.expanded_url || u.url));
      const safeUrl = u.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp(safeUrl, 'g'), `<a href="${exp}" target="_blank" rel="noopener">${display}</a>`);
    }
    s = s.replace(/(#[^\s#<>]+)/g, '<span class="tag-hash">$1</span>');
    s = s.replace(/\n/g, '<br>');
    return s;
  };

  // ============================================================
  //  Tweet rendering
  // ============================================================
  let feedLevel = 'normal';   // 'normal' | 'caution' | 'alert'
  let lastCriticalIds = [];   // 通知用: 直近の表示済 critical id
  // 「処理終了 渋滞残あり」は渋滞解消の続報が出ないことも多いため、一定時間で
  //  自動的に解消扱いにしてアラートを下げる (最新ツイート監視のフォールバック)。
  const RESIDUAL_TTL_MS = 3 * 60 * 60 * 1000; // 3時間
  // 発生事象(事故/故障車/規制等)の続報「処理終了」がスクレイピングの遅延等で
  // 取得できないと、元の発生ツイートが古いまま渋滞ステータスを維持してしまう。
  // @mlit_himeji は通常数時間以内に処理終了を投稿するため、一定時間を超えた
  // 発生ツイートは「続報未取得=おそらく解消済み」とみなしステータスを上げない。
  const INCIDENT_TTL_MS = 3 * 60 * 60 * 1000; // 3時間
  const ageMsOf = (t) => Date.now() - new Date(t.created_at).getTime();

  const renderTweets = (data) => {
    const allTweets = (data && data.tweets) || [];
    const pre = allTweets.filter(t => !isUseless(t.text));

    // 解消(処理終了/解除/撤去)された発生事象のキーを収集
    const clearedKeys = new Set();
    for (const t of pre) {
      if (isClearance(t.text)) clearedKeys.add(incidentKey(t.text));
    }

    const now = Date.now();
    let residualCongestion = false; // 「処理終了 渋滞残あり」が期限内に存在するか
    let suppressedCount = 0;
    const tweets = pre.filter(t => {
      if (isClearance(t.text)) {
        // 「事故 の処理終了 渋滞残あり」= 事故等は解消したが渋滞は継続中。
        //  → 重要情報として表示し続け、渋滞ステータスを維持する。
        if (RESIDUAL_RE.test(t.text) && !CONGESTION_CLEARED_RE.test(t.text)) {
          const ageMs = now - new Date(t.created_at).getTime();
          if (ageMs <= RESIDUAL_TTL_MS) { residualCongestion = true; return true; }
        }
        // 渋滞残なし(完全解消) または 期限切れの渋滞残 → 非表示(解消扱い)
        suppressedCount++; return false;
      }
      // 解消済み事象の「発生」ツイートは非表示
      if (clearedKeys.has(incidentKey(t.text))) { suppressedCount++; return false; }
      return true;
    });

    // 重要度集計（表示対象のみ）
    let hasCrit = false, hasWarn = false, hasCongestion = residualCongestion;
    const criticalTweets = [];
    for (const t of tweets) {
      const cleared = isClearance(t.text);
      // 発生から INCIDENT_TTL_MS を超えた事象は続報未取得=解消済みとみなしステータスに数えない
      const stale = ageMsOf(t) > INCIDENT_TTL_MS;
      const tags = classifyTags(t.text);
      // 処理終了済み/期限切れのツイートは事故等の critical / warn として数えない
      if (!cleared && !stale && tags.some(x => x.kind === 'critical')) { hasCrit = true; criticalTweets.push(t); }
      else if (!cleared && !stale && tags.some(x => x.kind === 'warn')) { hasWarn = true; }
      if (!stale && mentionsCongestion(t.text)) hasCongestion = true;
    }
    // 重大事象(事故/通行止) または 渋滞が継続中 → 「渋滞」アラート、規制のみ → 注意
    feedLevel = (hasCrit || hasCongestion) ? 'alert' : hasWarn ? 'caution' : 'normal';
    applyStatus(); // STATUS 即時反映

    // 新規 critical のみ通知
    notifyNewCritical(criticalTweets);

    if (!tweets.length) {
      tweetsEl.innerHTML = `<div class="tweet-empty">現在、加古川・姫路バイパスで表示対象の事象はありません。<br>${suppressedCount>0?`<span class="dim">（解消済 ${suppressedCount}件 を非表示）</span>`:''}</div>`;
      return;
    }

    const html = tweets.map(t => {
      const tags = classifyTags(t.text);
      const dir = detectDirection(t.text);
      const areas = detectArea(t.text);
      const cams = matchCameras(t.text);
      // 発生から時間が経過し続報(処理終了)が未取得 = おそらく解消済み
      const stale = !isClearance(t.text) && ageMsOf(t) > INCIDENT_TTL_MS &&
                    tags.some(x => x.kind === 'critical' || x.kind === 'warn');
      // 処理終了済み/期限切れは赤の重大表示にしない (渋滞残ありでも「解消したが渋滞継続」)
      const isCrit = !isClearance(t.text) && !stale && tags.some(x => x.kind === 'critical');
      const staleHtml = stale
        ? '<div class="tw-stale">※ 発生から時間が経過しています。続報（処理終了）が未取得のため、すでに解消している可能性があります。</div>'
        : '';
      const tagHtml = tags.map(x => `<span class="tw-tag ${x.kind}">${x.label}</span>`).join('');
      const dirHtml = dir ? `<span class="tw-dir ${dir.kind}">${escapeHtml(dir.label)}</span>` : '';
      const areaHtml = areas.map(a => `<span class="tw-area">${escapeHtml(a)}</span>`).join('');
      const camHtml = cams.length ? `
        <div class="tweet-cams">
          ${cams.map(c => `
            <figure>
              <figcaption>${escapeHtml(c.name)} ライブカメラ</figcaption>
              <a target="_blank" rel="noopener" href="${escapeHtml(safeHref(c.page))}">
                <img class="cam tw-cam" data-src="${escapeHtml(safeHref(c.img))}" alt="${escapeHtml(c.name)}" referrerpolicy="no-referrer" loading="lazy">
              </a>
            </figure>
          `).join('')}
        </div>` : '';
      return `
        <article class="tweet ${isCrit ? 'crit' : ''}">
          <div class="tweet-meta">
            <span class="tw-time" title="${escapeHtml(t.created_at)}">${escapeHtml(fmtRel(t.created_at))} <span class="dim">/ ${escapeHtml(fmtAbs(t.created_at))}</span></span>
            <a class="tw-permalink" target="_blank" rel="noopener" href="${escapeHtml(safeHref(t.permalink))}">X</a>
          </div>
          <div class="tweet-chips">${areaHtml}${dirHtml}${tagHtml}</div>
          <div class="tweet-text">${linkify(t.text, t.urls)}</div>
          ${staleHtml}
          ${camHtml}
        </article>
      `;
    }).join('');
    tweetsEl.innerHTML = html;
    refreshCams();
  };

  const updateFetchedLabel = (fetchedAt) => {
    if (!fetchedAt) { tweetsFetchedEl.textContent = '取得失敗'; return; }
    tweetsFetchedEl.textContent = `最終取得: ${fmtRel(fetchedAt)} (${fmtAbs(fetchedAt)})`;
  };

  // 取得元: まず Cloudflare Worker (2分毎・確実に更新) を優先し、
  // 失敗時は GitHub のコミット済み tweets.json にフォールバックする。
  const RAW_TWEETS_URL = 'https://raw.githubusercontent.com/kazunarikanzaki-oss/kakogawa-bypass-traffic/main/tweets.json';
  const workerTweetsUrl = () => {
    const api = (window.NERV_CONFIG && window.NERV_CONFIG.PUSH_API) || '';
    return api ? api.replace(/\/+$/, '') + '/tweets' : '';
  };
  const loadTweets = async () => {
    tweetsFetchedEl.textContent = '読み込み中…';
    const sources = [workerTweetsUrl(), RAW_TWEETS_URL].filter(Boolean);
    let lastErr = null;
    for (const src of sources) {
      try {
        const r = await fetch(`${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (!data || !Array.isArray(data.tweets)) throw new Error('bad payload');
        renderTweets(data);
        updateFetchedLabel(data.fetched_at);
        return;
      } catch (e) { lastErr = e; }
    }
    tweetsEl.innerHTML = `<div class="tweet-empty">取得エラー: ${escapeHtml(String(lastErr))}<br>「X で開く」ボタンから直接ご確認ください。</div>`;
    tweetsFetchedEl.textContent = '取得エラー';
  };

  // ============================================================
  //  NERV alert
  // ============================================================
  const evalTimeLevel = (now = new Date()) => {
    const h = now.getHours();
    const day = now.getDay();
    const weekday = day >= 1 && day <= 5;
    if (weekday && ((h >= 7 && h < 9) || (h >= 17 && h < 20))) return 'alert';
    if (weekday && ((h >= 6 && h < 10) || (h >= 16 && h < 21))) return 'caution';
    return 'normal';
  };

  let lastShown = null;

  const applyStatus = () => {
    const time = evalTimeLevel();
    const level = maxSev(time, feedLevel);
    statusEl.classList.remove('normal', 'caution', 'alert');
    statusEl.classList.add(level);
    statusEl.textContent =
      level === 'alert'   ? 'STATUS: 渋滞' :
      level === 'caution' ? 'STATUS: 混雑' :
                            'STATUS: NORMAL';
    // 渋滞検知時は画面の縁だけをジワっと赤く脈動させる (枠線のみ・操作可能)。
    if (level === 'alert') {
      congEdge.classList.add('show');
    } else {
      congEdge.classList.remove('show');
    }
    lastShown = level;
    reschedulePolling(level);
  };

  // ============================================================
  //  Push notifications (browser local)
  // ============================================================
  const NOTIF_KEY = 'nerv_notif_seen_v1';
  const getSeenIds = () => {
    try { return new Set(JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]')); }
    catch { return new Set(); }
  };
  const saveSeenIds = (set) => {
    try {
      const arr = [...set].slice(-200);
      localStorage.setItem(NOTIF_KEY, JSON.stringify(arr));
    } catch {}
  };

  // iOS 判定 / ホーム画面PWA(standalone)判定
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  const NOTIF_ON_KEY = 'nervNotifyOn';
  let notifyOn = false; // 現在の購読ON/OFF状態 (refreshで更新)

  const updateNotifyButton = () => {
    // iOS の Safari 通常タブでは Notification API が無いため、無効化せず
    // タップで「ホーム画面に追加」を案内する。
    if (!('Notification' in window)) {
      if (isIOS && !isStandalone) {
        notifyBtn.textContent = '🔔 通知を設定';
        notifyBtn.disabled = false;
      } else {
        notifyBtn.textContent = '🔕 通知非対応';
        notifyBtn.disabled = true;
      }
      return;
    }
    notifyBtn.disabled = false;
    const p = Notification.permission;
    if (p === 'denied') { notifyBtn.textContent = '🔕 通知ブロック'; return; }
    if (p === 'granted' && notifyOn) { notifyBtn.textContent = '🔔 通知ON（タップでオフ）'; return; }
    if (p === 'granted')             { notifyBtn.textContent = '🔕 通知OFF（タップでオン）'; return; }
    notifyBtn.textContent = '🔔 通知を有効化';
  };

  // ---- Web Push (ページを閉じていても通知) ----
  const pushCfg = (window.NERV_CONFIG) || {};
  const pushEnabled = () => !!(pushCfg.PUSH_API && pushCfg.VAPID_PUBLIC_KEY &&
    'serviceWorker' in navigator && 'PushManager' in window);

  const urlBase64ToUint8Array = (base64) => {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  };

  const subscribeToPush = async () => {
    if (!pushEnabled() || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushCfg.VAPID_PUBLIC_KEY),
        });
      }
      await fetch(pushCfg.PUSH_API.replace(/\/+$/, '') + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub }),
      });
    } catch (e) { /* プッシュ未対応/拒否時はローカル通知にフォールバック */ }
  };

  // 購読を解除 (オフ)。Worker からも削除し、端末側の購読も破棄する。
  const unsubscribeFromPush = async () => {
    try {
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          if (pushCfg.PUSH_API) {
            try {
              await fetch(pushCfg.PUSH_API.replace(/\/+$/, '') + '/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: sub.endpoint }),
              });
            } catch {}
          }
          await sub.unsubscribe();
        }
      }
    } catch {}
  };

  // 現在のON/OFF状態を購読有無から判定してボタンに反映 (起動時/操作後に呼ぶ)
  const refreshNotifyState = async () => {
    notifyOn = false;
    if ('Notification' in window && Notification.permission === 'granted'
        && 'serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        // 購読があり、かつ明示的にオフにしていなければ ON
        notifyOn = !!sub && localStorage.getItem(NOTIF_ON_KEY) !== '0';
      } catch {}
    }
    updateNotifyButton();
  };

  const requestNotifyPermission = async () => {
    // iOS の Safari 通常タブ: 通知APIが無いので「ホーム画面に追加」を案内
    if (!('Notification' in window)) {
      if (isIOS && !isStandalone) {
        alert('iPhone で通知を受け取るには:\n\n' +
          '1. Safari の「共有」ボタン（□↑）をタップ\n' +
          '2.「ホーム画面に追加」を選ぶ\n' +
          '3. 追加したアイコンから起動\n' +
          '4. もう一度「🔔 通知を有効化」をタップ\n\n' +
          '※ Safari の通常タブでは iOS の仕様により通知を有効化できません。');
      }
      return;
    }
    if (Notification.permission === 'denied') {
      alert('通知がブロックされています。\n端末の設定 →（このアプリ/Safari）→ 通知 から許可してください。');
      return;
    }

    // 既にON → タップでオフ
    if (Notification.permission === 'granted' && notifyOn) {
      localStorage.setItem(NOTIF_ON_KEY, '0');
      await unsubscribeFromPush();
      await refreshNotifyState();
      return;
    }

    // オフ/未設定 → オンにする
    if (Notification.permission === 'default') {
      try {
        const result = await Notification.requestPermission();
        if (result !== 'granted') { await refreshNotifyState(); return; }
      } catch { await refreshNotifyState(); return; }
    }
    if (Notification.permission === 'granted') {
      localStorage.setItem(NOTIF_ON_KEY, '1');
      await subscribeToPush();
      try { new Notification('NERV TRAFFIC', { body: '通知をオンにしました', tag: 'nerv-init' }); } catch {}
    }
    await refreshNotifyState();
  };

  let isFirstFeed = true;
  const notifyNewCritical = (criticalTweets) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      lastCriticalIds = criticalTweets.map(t => t.id);
      isFirstFeed = false;
      return;
    }
    const seen = getSeenIds();
    // 初回読み込み時は既存事象を通知しない (履歴として記録のみ)
    if (isFirstFeed) {
      criticalTweets.forEach(t => seen.add(t.id));
      saveSeenIds(seen);
      isFirstFeed = false;
      return;
    }
    const newOnes = criticalTweets.filter(t => !seen.has(t.id));
    newOnes.slice(0, 3).forEach(t => {
      try {
        new Notification('🚨 加古川・姫路バイパス 重大事象', {
          body: t.text.slice(0, 140),
          tag: t.id,
          icon: 'icon.svg',
        });
      } catch {}
      seen.add(t.id);
    });
    saveSeenIds(seen);
  };

  // ============================================================
  //  Adaptive polling (alert=30s, caution/normal=90s)
  // ============================================================
  let pollIntervalId = null;
  let currentPollMs = 0;
  const reschedulePolling = (level) => {
    const ms = level === 'alert' ? 30000 : 90000;
    if (ms === currentPollMs) return;
    currentPollMs = ms;
    if (pollIntervalId) clearInterval(pollIntervalId);
    pollIntervalId = setInterval(guardedLoad, ms);
  };

  // ============================================================
  //  Concurrency guard
  // ============================================================
  let loading = false;
  const guardedLoad = async () => {
    if (loading) return;
    loading = true;
    tweetsReloadBtn.disabled = true;
    reloadBtn.disabled = true;
    try { await loadTweets(); }
    finally {
      loading = false;
      tweetsReloadBtn.disabled = false;
      reloadBtn.disabled = false;
    }
  };

  // ============================================================
  //  Wiring
  // ============================================================
  reloadBtn.addEventListener('click', () => { guardedLoad(); setClock(); });
  let simTimer = null;
  simBtn.addEventListener('click', () => {
    // 全画面化はせず、縁の赤点滅だけをテスト表示 (操作可能なまま)
    statusEl.classList.remove('normal', 'caution');
    statusEl.classList.add('alert');
    statusEl.textContent = 'STATUS: 渋滞 (テスト)';
    congEdge.classList.add('show');
    if (navigator.vibrate) navigator.vibrate(120);
    clearTimeout(simTimer);
    simTimer = setTimeout(() => { applyStatus(); }, 6000);
  });
  tweetsReloadBtn.addEventListener('click', guardedLoad);
  if (notifyBtn) notifyBtn.addEventListener('click', requestNotifyPermission);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) guardedLoad();
  });

  // ============================================================
  //  Service Worker
  // ============================================================
  if ('serviceWorker' in navigator) {
    // 新しい SW が制御権を取得したら自動で1回だけリロードし、
    // 古いキャッシュ(全画面オーバーレイ等)を確実に新コードへ更新する。
    let swRefreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swRefreshed) return;
      swRefreshed = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        // 既存ページでも更新を取りに行く
        reg.update().catch(() => {});
        // 既に通知ONなら毎回購読を更新 (購読の失効/サーバ再構築に追従)。
        // オフにしている場合は購読し直さない。
        if ('Notification' in window && Notification.permission === 'granted'
            && localStorage.getItem(NOTIF_ON_KEY) !== '0') {
          subscribeToPush().then(refreshNotifyState);
        } else {
          refreshNotifyState();
        }
      }).catch(() => {});
    });
  }

  // ============================================================
  //  Boot
  // ============================================================
  setClock();
  setInterval(setClock, 1000);
  refreshCams();
  setInterval(refreshCams, 60000);
  updateNotifyButton();
  refreshNotifyState();
  applyStatus();
  setInterval(applyStatus, 60000);
  guardedLoad();
  // reschedulePolling は applyStatus 内で初回起動
})();
