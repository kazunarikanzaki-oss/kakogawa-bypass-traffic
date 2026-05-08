(() => {
  const updated   = document.getElementById('updated');
  const statusEl  = document.getElementById('status');
  const alertEl   = document.getElementById('alert');
  const alertPat  = document.getElementById('alertPattern');
  const closeBtn  = document.getElementById('alertClose');
  const reloadBtn = document.getElementById('reload');
  const simBtn    = document.getElementById('simulate');

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

  // 平日の朝夕ラッシュを「使徒接近」相当として自動演出
  // - 平日 7:00-9:00, 17:00-20:00 → ALERT (使徒接近)
  // - 平日 6-7, 9-10, 16-17, 20-21 → CAUTION
  // - それ以外 → NORMAL
  const evalLevel = (now = new Date()) => {
    const h = now.getHours();
    const day = now.getDay(); // 0=Sun, 6=Sat
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

    // 自動発動: alertになった瞬間だけオーバーレイを出す（連発防止）
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
  };

  closeBtn.addEventListener('click', hideAlert);
  reloadBtn.addEventListener('click', () => {
    refreshCams();
    setClock();
  });
  simBtn.addEventListener('click', () => {
    manualAlert = true;
    showAlert('RED');
    statusEl.classList.remove('normal', 'caution');
    statusEl.classList.add('alert');
    statusEl.textContent = 'STATUS: 使徒接近';
  });

  setClock();
  setInterval(setClock, 1000);
  refreshCams();
  setInterval(refreshCams, 60000);
  applyStatus();
  setInterval(applyStatus, 60000);
})();
