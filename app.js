(() => {
  const updated   = document.getElementById('updated');
  const statusEl  = document.getElementById('status');
  const alertEl   = document.getElementById('alert');
  const alertFrame = document.getElementById('alertFrame');
  const alertPat  = document.getElementById('alertPattern');
  const closeBtn  = document.getElementById('alertClose');
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
  const classifyTags = (text) => {
    const tags = [];
    if (/通行止/.test(text))           tags.push({label:'通行止', kind:'critical'});
    if (/事故/.test(text))             tags.push({label:'事故', kind:'critical'});
    if (/故障車/.test(text))           tags.push({label:'故障車', kind:'warn'});
    if (/車線規制|追越車線|走行車線|車線閉鎖|規制/.test(text))
                                        tags.push({label:'規制', kind:'warn'});
    if (/渋滞/.test(text))             tags.push({label:'渋滞', kind:'warn'});
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
    isUseless, isClearance, incidentKey, matchCameras
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

  const renderTweets = (data) => {
    const allTweets = (data && data.tweets) || [];
    let pre = allTweets.filter(t => !isUseless(t.text));
    const clearedKeys = new Set();
    for (const t of pre) {
      if (isClearance(t.text)) clearedKeys.add(incidentKey(t.text));
    }
    let suppressedCount = 0;
    const tweets = pre.filter(t => {
      if (isClearance(t.text)) { suppressedCount++; return false; }
      if (clearedKeys.has(incidentKey(t.text))) { suppressedCount++; return false; }
      return true;
    });

    // 重要度集計（表示対象のみ）
    let hasCrit = false, hasWarn = false;
    const criticalTweets = [];
    for (const t of tweets) {
      const tags = classifyTags(t.text);
      if (tags.some(x => x.kind === 'critical')) { hasCrit = true; criticalTweets.push(t); }
      else if (tags.some(x => x.kind === 'warn')) { hasWarn = true; }
    }
    feedLevel = hasCrit ? 'alert' : hasWarn ? 'caution' : 'normal';
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
      const isCrit = tags.some(x => x.kind === 'critical');
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

  const loadTweets = async () => {
    try {
      tweetsFetchedEl.textContent = '読み込み中…';
      const url = `https://raw.githubusercontent.com/kazunarikanzaki-oss/kakogawa-bypass-traffic/main/tweets.json?t=${Date.now()}`;
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      renderTweets(data);
      updateFetchedLabel(data.fetched_at);
    } catch (e) {
      tweetsEl.innerHTML = `<div class="tweet-empty">取得エラー: ${escapeHtml(String(e))}<br>「X で開く」ボタンから直接ご確認ください。</div>`;
      tweetsFetchedEl.textContent = '取得エラー';
    }
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

  let manualAlert = false;
  let lastShown = null;

  const applyStatus = () => {
    const time = evalTimeLevel();
    const combined = maxSev(time, feedLevel);
    const level = manualAlert ? 'alert' : combined;
    statusEl.classList.remove('normal', 'caution', 'alert');
    statusEl.classList.add(level);
    let cause = 'time';
    if (manualAlert) cause = 'manual';
    else if (SEV[feedLevel] >= SEV[time]) cause = 'feed';
    statusEl.textContent =
      level === 'alert'   ? (cause === 'feed' ? 'STATUS: 使徒接近 (実検出)' :
                             cause === 'manual' ? 'STATUS: 使徒接近 (シミュレート)' :
                                                  'STATUS: 使徒接近 (ラッシュ予測)') :
      level === 'caution' ? 'STATUS: CAUTION' :
                            'STATUS: NORMAL';
    // 渋滞検知時は画面全体をブロックせず、枠周りをジワっと赤点滅させる。
    // 操作はそのまま可能なまま。緊急事態シミュレートのみ全画面オーバーレイ。
    if (level === 'alert' && !manualAlert) {
      alertFrame.classList.add('show');
    } else {
      alertFrame.classList.remove('show');
    }
    lastShown = level;
    reschedulePolling(level);
  };

  const showAlert = (pattern = 'ORANGE') => {
    alertPat.textContent = pattern;
    alertEl.classList.remove('hidden');
    alertEl.setAttribute('aria-hidden', 'false');
    if (navigator.vibrate) navigator.vibrate([200, 80, 200, 80, 400]);
  };
  const hideAlert = () => {
    alertEl.classList.add('hidden');
    alertEl.setAttribute('aria-hidden', 'true');
    manualAlert = false;
    lastShown = 'alert';
    applyStatus();
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

  const updateNotifyButton = () => {
    if (!('Notification' in window)) {
      notifyBtn.textContent = '🔕 通知非対応';
      notifyBtn.disabled = true;
      return;
    }
    const p = Notification.permission;
    if (p === 'granted')     notifyBtn.textContent = '🔔 通知ON';
    else if (p === 'denied') notifyBtn.textContent = '🔕 通知ブロック';
    else                     notifyBtn.textContent = '🔔 通知を有効化';
  };

  const requestNotifyPermission = async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      try {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
          new Notification('NERV TRAFFIC', { body: '通知が有効になりました', tag: 'nerv-init' });
        }
      } catch {}
    }
    updateNotifyButton();
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
  closeBtn.addEventListener('click', hideAlert);
  reloadBtn.addEventListener('click', () => { guardedLoad(); setClock(); });
  simBtn.addEventListener('click', () => {
    manualAlert = true;
    showAlert('RED');
    statusEl.classList.remove('normal', 'caution');
    statusEl.classList.add('alert');
    statusEl.textContent = 'STATUS: 使徒接近 (シミュレート)';
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
  applyStatus();
  setInterval(applyStatus, 60000);
  guardedLoad();
  // reschedulePolling は applyStatus 内で初回起動
})();
