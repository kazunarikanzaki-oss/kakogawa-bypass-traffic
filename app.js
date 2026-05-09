(() => {
  const updated   = document.getElementById('updated');
  const statusEl  = document.getElementById('status');
  const alertEl   = document.getElementById('alert');
  const alertPat  = document.getElementById('alertPattern');
  const closeBtn  = document.getElementById('alertClose');
  const reloadBtn = document.getElementById('reload');
  const simBtn    = document.getElementById('simulate');
  const tweetsEl  = document.getElementById('tweets');
  const tweetsFetchedEl = document.getElementById('tweetsFetched');
  const tweetsReloadBtn = document.getElementById('tweetsReload');

  const fmt2 = n => String(n).padStart(2, '0');

  const setClock = () => {
    const d = new Date();
    updated.textContent = `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}:${fmt2(d.getSeconds())}`;
  };

  const refreshCams = () => {
    document.querySelectorAll('img.cam').forEach(img => {
      img.src = `${img.dataset.src}?t=${Date.now()}`;
    });
  };

  // ---- CAMERA MATCHING ----
  // Map @mlit_himeji location names → 国土交通省 ライブカメラ
  const CAMERAS = [
    { name: '加古川東', re: /加古川東/,           img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00453.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/kako_e.html' },
    { name: '加古川',   re: /加古川(?![バ東])/,   img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00454.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/kako.html' },
    { name: '高砂北',   re: /高砂北/,             img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00457.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/takasago_n.html' },
    { name: '別所',     re: /別所/,               img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00461.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/bessho1.html' },
    { name: '姫路東',   re: /姫路東/,             img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00463.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/himeji_e.html' },
    { name: '市川',     re: /市川/,               img: 'https://www.seishiga.kkr.mlit.go.jp/himeji/pic/C00464.jpg', page: 'https://www.kkr.mlit.go.jp/himeji/bousai/livecam/r2cam_map/ichikawa.html' },
  ];
  const matchCameras = (text) => {
    const found = []; const seen = new Set();
    for (const c of CAMERAS) {
      if (c.re.test(text) && !seen.has(c.name)) { found.push(c); seen.add(c.name); }
    }
    return found;
  };

  // ---- TWEETS ----
  const escapeHtml = s => s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);

  const classifyTags = (text) => {
    const tags = [];
    if (/通行止/.test(text))           tags.push({label:'通行止', kind:'critical'});
    if (/事故/.test(text))             tags.push({label:'事故', kind:'critical'});
    if (/故障車/.test(text))           tags.push({label:'故障車', kind:'warn'});
    if (/車線規制|追越車線|走行車線|車線閉鎖|規制/.test(text))
                                        tags.push({label:'規制', kind:'warn'});
    if (/渋滞/.test(text))             tags.push({label:'渋滞', kind:'warn'});
    if (/工事/.test(text))             tags.push({label:'工事', kind:'info'});
    // de-duplicate by label
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
    if (/加古川バイパス/.test(text)) return '加古川BP';
    if (/姫路バイパス/.test(text))   return '姫路BP';
    if (/太子竜野バイパス/.test(text)) return '太子竜野BP';
    if (/国道2号|国道2|R2/.test(text)) return '国道2号';
    return null;
  };

  const linkify = (text, urls) => {
    let s = escapeHtml(text);
    for (const u of (urls || [])) {
      if (!u.url) continue;
      const display = escapeHtml(u.display_url || u.expanded_url || u.url);
      const exp = escapeHtml(u.expanded_url || u.url);
      // The text already escaped, so t.co URLs (no special chars) still match raw form
      const safeUrl = u.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp(safeUrl, 'g'), `<a href="${exp}" target="_blank" rel="noopener">${display}</a>`);
    }
    s = s.replace(/(#[^\s#<>]+)/g, '<span class="tag-hash">$1</span>');
    s = s.replace(/\n/g, '<br>');
    return s;
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

  // 「国道2号:車線規制を伴う工事予定なし」等のルーチン通知（加古川・姫路BP に直接関係しない）は除外
  const isUseless = (text) => {
    if (/【.+(工事規制|規制).*予定】/.test(text) &&
        /国道2号[\s:：]*車線規制を伴う工事予定なし/.test(text)) {
      return true;
    }
    return false;
  };

  // 「終了 / 解消 / 解除 / 撤去終了」を含む = 事象解消の通知
  const isClearance = (text) => {
    if (!/(終了|解消|解除|撤去)/.test(text)) return false;
    // 単に「お知らせ終了」等の不関連語は除外。事象タイプ語と共起している場合のみ
    return /(事故|故障車|物件落下|通行止|車線規制|規制)/.test(text);
  };

  // 同一インシデントを識別するキー: 事象種別 + 地点 + 発生時刻
  const incidentKey = (text) => {
    const types = ['通行止','事故','故障車','物件落下'];
    const incType = types.find(k => text.includes(k)) || 'その他';
    const cams = matchCameras(text);
    const loc = cams.length ? cams.map(c => c.name).sort().join(',') : 'na';
    // 「10時30分頃」形式の時刻
    const m = text.match(/(\d{1,2})\s*時\s*(\d{1,2})\s*分\s*頃/);
    const incTime = m ? `${m[1]}:${m[2]}` : 'na';
    return `${incType}|${loc}|${incTime}`;
  };

  const renderTweets = (data) => {
    const allTweets = (data && data.tweets) || [];
    // Step 1: drop routine "no-regulation" notices
    let pre = allTweets.filter(t => !isUseless(t.text));
    // Step 2: build a set of cleared incident keys (any clearance tweet anywhere in the feed)
    const clearedKeys = new Set();
    for (const t of pre) {
      if (isClearance(t.text)) clearedKeys.add(incidentKey(t.text));
    }
    let suppressedCount = 0;
    const tweets = pre.filter(t => {
      // Hide clearance notice itself (situation already over)
      if (isClearance(t.text)) { suppressedCount++; return false; }
      // Hide active incident if a matching clearance tweet exists
      if (clearedKeys.has(incidentKey(t.text))) { suppressedCount++; return false; }
      return true;
    });
    if (!tweets.length) {
      tweetsEl.innerHTML = `<div class="tweet-empty">現在、加古川・姫路バイパスで表示対象の事象はありません。<br>${suppressedCount>0?`<span class="dim">（解消済 ${suppressedCount}件 を非表示）</span>`:''}</div>`;
      return;
    }
    let critical = 0;
    const html = tweets.map(t => {
      const tags = classifyTags(t.text);
      const dir = detectDirection(t.text);
      const area = detectArea(t.text);
      const cams = matchCameras(t.text);
      const isCrit = tags.some(x => x.kind === 'critical');
      if (isCrit) critical++;
      const tagHtml = tags.map(x => `<span class="tw-tag ${x.kind}">${x.label}</span>`).join('');
      const dirHtml = dir ? `<span class="tw-dir ${dir.kind}">${escapeHtml(dir.label)}</span>` : '';
      const areaHtml = area ? `<span class="tw-area">${escapeHtml(area)}</span>` : '';
      const camHtml = cams.length ? `
        <div class="tweet-cams">
          ${cams.map(c => `
            <figure>
              <figcaption>${escapeHtml(c.name)} ライブカメラ</figcaption>
              <a target="_blank" rel="noopener" href="${escapeHtml(c.page)}">
                <img class="cam tw-cam" data-src="${escapeHtml(c.img)}" alt="${escapeHtml(c.name)}" referrerpolicy="no-referrer" loading="lazy">
              </a>
            </figure>
          `).join('')}
        </div>` : '';
      return `
        <article class="tweet ${isCrit ? 'crit' : ''}">
          <div class="tweet-meta">
            <span class="tw-time" title="${escapeHtml(t.created_at)}">${escapeHtml(fmtRel(t.created_at))} <span class="dim">/ ${escapeHtml(fmtAbs(t.created_at))}</span></span>
            <a class="tw-permalink" target="_blank" rel="noopener" href="${escapeHtml(t.permalink)}">X</a>
          </div>
          <div class="tweet-chips">${areaHtml}${dirHtml}${tagHtml}</div>
          <div class="tweet-text">${linkify(t.text, t.urls)}</div>
          ${camHtml}
        </article>
      `;
    }).join('');
    tweetsEl.innerHTML = html;
    if (critical > 0) tweetsEl.classList.add('has-crit');
    else tweetsEl.classList.remove('has-crit');
    // tweet 内に挿入された <img.cam> にも src を即座に流し込む
    refreshCams();
  };

  const updateFetchedLabel = (fetchedAt) => {
    if (!fetchedAt) {
      tweetsFetchedEl.textContent = '取得失敗';
      return;
    }
    const d = new Date(fetchedAt);
    const rel = fmtRel(d.toString());
    tweetsFetchedEl.textContent = `最終取得: ${rel} (${fmtAbs(d.toString())})`;
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

  // ---- ALERT (NERV) ----
  const evalLevel = (now = new Date()) => {
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
    const auto = evalLevel();
    const level = manualAlert ? 'alert' : auto;
    statusEl.classList.remove('normal', 'caution', 'alert');
    statusEl.classList.add(level);
    statusEl.textContent =
      level === 'alert'   ? 'STATUS: 使徒接近' :
      level === 'caution' ? 'STATUS: CAUTION' :
                            'STATUS: NORMAL';
    if (level === 'alert' && lastShown !== 'alert' && !manualAlert) {
      showAlert('ORANGE');
    }
    lastShown = level;
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
    lastShown = null;
    applyStatus();
  };

  // ---- WIRING ----
  closeBtn.addEventListener('click', hideAlert);
  reloadBtn.addEventListener('click', () => { refreshCams(); loadTweets(); setClock(); });
  simBtn.addEventListener('click', () => {
    manualAlert = true;
    showAlert('RED');
    statusEl.classList.remove('normal', 'caution');
    statusEl.classList.add('alert');
    statusEl.textContent = 'STATUS: 使徒接近';
  });
  tweetsReloadBtn.addEventListener('click', loadTweets);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { loadTweets(); refreshCams(); }
  });

  setClock();
  setInterval(setClock, 1000);
  refreshCams();
  setInterval(refreshCams, 60000);
  applyStatus();
  setInterval(applyStatus, 60000);
  loadTweets();
  setInterval(loadTweets, 60000);
})();
