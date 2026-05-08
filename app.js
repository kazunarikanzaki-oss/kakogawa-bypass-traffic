(() => {
  const updated = document.getElementById('updated');
  const setNow = () => {
    const d = new Date();
    updated.textContent = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const refreshCams = () => {
    document.querySelectorAll('img.cam').forEach(img => {
      const base = img.dataset.src;
      img.src = `${base}?t=${Date.now()}`;
    });
    setNow();
  };

  refreshCams();
  setInterval(refreshCams, 60000);
  document.getElementById('reload').addEventListener('click', refreshCams);
})();
