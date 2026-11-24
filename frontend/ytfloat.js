// The floating video (picture in picture): the YouTube video playing in the browser (media.video, found by
// youtube.rs), muted and kept in step with the tab as Music's video is (NotchKit.ytSync), in a small window over
// everything. Its controls go to the tab; × (or Esc) closes it. The player is helper/yt.html (yt.url) in an iframe.
(function () {
  const api = window.notch;
  const K = window.NotchKit;
  const _t = window._t || ((s) => s);
  const $ = (s) => document.querySelector(s);
  const body = document.body;
  if (!api || !K) return;

  let media = {};
  // as in notch.js: the player's YT state and time (t, told tAt), its speed (rate, nudge), the learned seek lead
  // (error: what YouTube said when it refused the video, shown until another one loads)
  const yt = { url: null, frame: $('#frame'), ready: false, id: null, t: 0, tAt: 0, d: 0, state: -1, stateAt: 0, played: 0,
    seekAt: 0, cmdAt: 0, rate: 1, nudge: 1, lead: 0.2, landing: false, error: '' };

  $('#close').innerHTML = window.ICONS.x;
  $('#prev').innerHTML = window.ICONS.prev;
  $('#next').innerHTML = window.ICONS.next;
  if (window._tApply) window._tApply(document);

  // where the tab is now: its last position, run on while it plays
  function position() {
    const m = media;
    if (!m.active || !m.duration) return 0;
    let pos = m.position || 0;
    if (m.playing) pos += Math.max(0, Math.min(((Date.now() - (m.positionUpdated || Date.now())) / 1000) * (m.rate || 1), m.duration));
    return Math.min(pos, m.duration);
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function post(msg) {
    if (yt.url && yt.frame.contentWindow) yt.frame.contentWindow.postMessage(msg, new URL(yt.url).origin);
  }
  function control(action, value) {
    api.helper({ cmd: 'media', action, value });
  }

  function onMedia(m) {
    media = m || {};
    const vid = media.video;
    // (between two videos, or while the tab plays something else: the last video stays, paused)
    if (vid && vid !== yt.id) {
      yt.id = vid; yt.state = -1; yt.played = 0; yt.error = ''; yt.d = 0;
      $('#thumb').src = `https://i.ytimg.com/vi/${encodeURIComponent(vid)}/hqdefault.jpg`;
      if (yt.ready) { post({ type: 'load', id: vid, at: position(), playing: !!media.playing }); yt.cmdAt = Date.now(); yt.rate = 1; yt.nudge = 1; }
    }
    $('#title').textContent = media.title || '';
    $('#app').textContent = media.app ? String(media.app).replace(/\.exe$/i, '') : 'YouTube';
    $('#play').innerHTML = media.playing ? window.ICONS.pause : window.ICONS.play;
    $('#play').title = media.playing ? _t('Pause') : _t('Play');
    $('#prev').disabled = media.canPrev === false;
    $('#next').disabled = media.canNext === false;
    $('#bar').classList.toggle('off', !media.duration || media.canSeek === false);
    paintTime();
  }
  function paintTime() {
    const d = media.duration || 0; const pos = position();
    $('#el').textContent = d ? fmt(pos) : '';
    $('#rem').textContent = d ? '-' + fmt(d - pos) : '';
    $('#bar i').style.transform = `scaleX(${d ? Math.max(0, Math.min(1, pos / d)).toFixed(4) : 0})`;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== yt.frame.contentWindow || !e.data || typeof e.data !== 'object') return;
    const d = e.data;
    if (d.type === 'ready') {
      yt.ready = true; yt.rate = 1;
      if (yt.id) { post({ type: 'load', id: yt.id, at: position(), playing: !!media.playing }); yt.cmdAt = Date.now(); }
    } else if (d.type === 'state') {
      if (Number(d.s) !== yt.state) { yt.state = Number(d.s); yt.stateAt = Date.now(); }
    } else if (d.type === 'time') {
      yt.t = Number(d.t) || 0; yt.d = Number(d.d) || 0; yt.tAt = Date.now();
    } else if (d.type === 'error') {
      yt.error = _t('YouTube doesn’t allow this video to play here');
    }
  });

  // every 250 ms: in step with the tab (as Music's video: nudged when a little off, a seek when far off)
  let last = Date.now();
  setInterval(() => {
    const now = Date.now(); const dt = now - last; last = now;
    paintTime();
    if (!yt.id) {
      // (opened before any video was found: it says what it waits for)
      const wait = _t('Waiting for the YouTube video in the tab');
      body.classList.add('msg');
      if ($('#msg').textContent !== wait) $('#msg').textContent = wait;
      return;
    }
    if (!yt.ready) return;
    const m = media;
    const showing = !!m.video && m.video === yt.id;
    const settling = yt.state === 3 || yt.state === -1 || now - yt.seekAt < 1000;
    const r = K.ytSync({ t: yt.t, ageMs: now - yt.tAt, state: yt.state, rate: yt.rate, d: yt.d, target: position(),
      npDur: m.duration || 0, playing: !!m.playing && showing, settling: settling || !showing, nudging: yt.nudge !== 1, lead: yt.lead });
    const c = K.ytCommand({ wantPlay: r.play, state: yt.state, sinceCmdMs: now - yt.cmdAt });
    if (c) { post({ type: c }); yt.cmdAt = now; }
    if (yt.landing && yt.state === 1 && now - yt.stateAt > 700 && now - yt.seekAt > 1000) { yt.lead = K.ytLead(yt.lead, r.drift); yt.landing = false; }
    if (r.seek !== null) { post({ type: 'seek', at: r.seek }); yt.t = r.seek; yt.tAt = now; yt.seekAt = now; yt.landing = !!m.playing; }
    yt.nudge = r.seek === null ? r.nudge : 1;
    const rate = (m.rate || 1) * yt.nudge;
    if (rate !== yt.rate) { post({ type: 'rate', r: rate }); yt.rate = rate; }
    if (yt.state === 1) yt.played += dt;
    body.classList.toggle('cover', !showing || K.ytCover(yt.state, yt.played, now - yt.stateAt));
    // (an ad only when the copy has the tab's video: their lengths then differ because of the ad; while the tab
    // moves to another video the copy still has the last one, which isn't an ad)
    const note = yt.error || (!showing ? _t('Waiting for the YouTube video in the tab') : r.ad ? _t('An ad is playing in the tab') : '');
    body.classList.toggle('msg', !!note);
    if ($('#msg').textContent !== note) $('#msg').textContent = note;
  }, 250);

  // the controls: shown while the pointer is over the window
  let hideAt = 0;
  document.addEventListener('mousemove', () => { body.classList.add('hover'); hideAt = Date.now() + 2500; });
  document.addEventListener('mouseleave', () => body.classList.remove('hover'));
  setInterval(() => { if (hideAt && Date.now() > hideAt) { body.classList.remove('hover'); hideAt = 0; } }, 500);

  const close = () => api.svc('yt', 'float', false).catch(() => window.close());
  $('#close').onclick = close;
  $('#play').onclick = () => { media.playing = !media.playing; media.position = position(); media.positionUpdated = Date.now(); onMedia(media); control('toggle'); };
  $('#prev').onclick = () => control('prev');
  $('#next').onclick = () => control('next');
  const seek = (sec) => {
    const d = media.duration || 0;
    if (!d || media.canSeek === false) return;
    media.position = Math.max(0, Math.min(d, sec)); media.positionUpdated = Date.now();
    paintTime(); control('seek', media.position);
  };
  $('#bar').onclick = (e) => { const r = $('#bar').getBoundingClientRect(); seek(((e.clientX - r.left) / Math.max(1, r.width)) * (media.duration || 0)); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
    else if (e.key === 'ArrowLeft') seek(position() - 5);
    else if (e.key === 'ArrowRight') seek(position() + 5);
  });

  api.onHelper((m) => { if (m && m.type === 'media') onMedia(m); });
  api.helperState().then((s) => { if (s && s.media) onMedia(s.media); }).catch(() => {});
  api.svc('yt', 'url').then((u) => { yt.url = u; yt.frame.src = u; }).catch(() => {});
})();
