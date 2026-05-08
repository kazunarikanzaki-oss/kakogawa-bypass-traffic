(() => {
  const updated = document.getElementById('updated');
  const setNow = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    updated.textContent = `${hh}:${mm}`;
  };
  setNow();
  document.getElementById('reload').addEventListener('click', () => location.reload());
})();
