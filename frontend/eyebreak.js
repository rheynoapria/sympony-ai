const secs = Number(new URLSearchParams(location.search).get('secs')) || 20;
const end = Date.now() + secs * 1000;
const el = document.getElementById('count');
const done = () => window.notch.svc('health', 'eyeBreakDone');
document.getElementById('skip').onclick = done;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
(function tick() {
  const left = Math.ceil((end - Date.now()) / 1000);
  el.textContent = Math.max(0, left);
  if (left <= 0) { done(); return; }
  setTimeout(tick, 250);
})();
