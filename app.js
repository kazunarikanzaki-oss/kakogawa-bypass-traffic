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

  const renderTweets = (data) => {
    const tweets = (data && data.tweets) || [];
    if (!tweets.length) {
      tweetsEl.innerHTML = '<div class="tweet-empty">投稿が取得できませんでした。X で直接ご確認ください。</div>';
      return;
    }
    let critical = 0;
    const html = tweets.map(t => {
      const tags = classifyTags(t.text);
      const dir = detectDirection(t.text);
      const area = detectArea(t.text);
      const isCrit = tags.some(x => x.kind === 'critical');
      if (isCrit) critical++;
      const tagHtml = tags.map(x => `<span class="tw-tag ${x.kind}">${x.label}</span>`).join('');
      const dirHtml = dir ? `<span class="tw-dir ${dir.kind}">${escapeHtml(dir.label)}</span>` : '';
      const areaHtml = area ? `<span class="tw-area">${escapeHtml(area)}</span>` : '';
      return `
        <article class="tweet ${isCrit ? 'crit' : ''}">
          <div class="tweet-meta">
            <span class="tw-time" title="${escapeHtml(t.created_at)}">${escapeHtml(fmtRel(t.created_at))} <span class="dim">/ ${escapeHtml(fmtAbs(t.created_at))}</span></span>
            <a class="tw-permalink" target="_blank" rel="noopener" href="${escapeHtml(t.permalink)}">X</a>
          </div>
          <div class="tweet-chips">${areaHtml}${dirHtml}${tagHtml}</div>
          <div class="tweet-text">${linkify(t.text, t.urls)}</div>
        </article>
      `;
    }).join('');
    tweetsEl.innerHTML = html;
    if (critical > 0) tweetsEl.classList.add('has-crit');
    else tweetsEl.classList.remove('has-crit');
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
      const r = await fetch(`tweets.json?t=${Date.now()}`, { cache: 'no-cache' });
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
