/* ════════════════════════════════════
   REST TIMER — pill above the tab bar, visible on every tab
   State lives in the workout draft as wall-clock times, so the countdown survives
   tab switches, backgrounding and reloads. iOS can't alert while the app is
   suspended; on return it reports how long ago the rest ended.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const STALE_MS = 5 * 60 * 1000;
  let getState = () => null;
  let setState = () => {};
  let timer = null;
  let audio = null;

  const pill = () => document.getElementById('rest-pill');
  const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  function bind(getter, setter) {
    getState = getter;
    setState = setter;
    sync();
  }

  // Must run inside a user gesture: iOS only lets audio start from one
  function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audio = audio || new Ctx();
      if (audio.state === 'suspended') audio.resume();
    } catch { audio = null; }
  }

  function beep() {
    if (!audio || audio.state !== 'running') return;
    const t0 = audio.currentTime;
    [0, 0.22, 0.44].forEach(off => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t0 + off);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + off + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.16);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + off);
      osc.stop(t0 + off + 0.18);
    });
  }

  function alertDone() {
    if (navigator.vibrate) navigator.vibrate([250, 120, 250]);
    beep();
    document.body.classList.add('rest-flash');
    setTimeout(() => document.body.classList.remove('rest-flash'), 1200);
    HL.toast('Rest over — next set', { kind: 'info' });
  }

  function start(sec) {
    unlockAudio();
    const now = Date.now();
    setState({ startedAt: now, endsAt: now + sec * 1000, durationSec: sec, alerted: false });
    sync();
  }

  function adjust(deltaSec) {
    const r = getState();
    if (!r) return;
    const endsAt = Math.max(Date.now(), r.endsAt + deltaSec * 1000);
    setState({ ...r, endsAt, durationSec: Math.max(0, r.durationSec + deltaSec), alerted: endsAt <= Date.now() && r.alerted });
    sync();
  }

  function stop() {
    setState(null);
    sync();
  }

  function sync() {
    const r = getState();
    const el = pill();
    if (!el) return;
    if (!r) {
      el.hidden = true;
      clearInterval(timer);
      timer = null;
      return;
    }
    if (!timer) timer = setInterval(sync, 250);
    const now = Date.now();
    const left = Math.ceil((r.endsAt - now) / 1000);
    if (left <= 0 && !r.alerted) {
      setState({ ...r, alerted: true });
      alertDone();
    }
    if (left <= 0 && now - r.endsAt > STALE_MS) { stop(); return; }

    el.hidden = false;
    el.classList.toggle('over', left <= 0);
    const pct = r.durationSec ? Math.max(0, Math.min(1, (r.endsAt - now) / (r.durationSec * 1000))) : 0;
    const text = left > 0 ? mmss(left) : `Over ${mmss(Math.floor((now - r.endsAt) / 1000))} ago`;
    if (!el.firstElementChild) {
      el.innerHTML = `
        <div class="rest-bar" aria-hidden="true"><div class="rest-fill"></div></div>
        <span class="rest-lbl">Rest</span>
        <span class="rest-time" role="timer" aria-live="off"></span>
        <button type="button" class="rest-btn" data-rest="-15" aria-label="15 seconds less rest">−15</button>
        <button type="button" class="rest-btn" data-rest="15" aria-label="15 seconds more rest">+15</button>
        <button type="button" class="rest-btn" data-rest="stop">Skip</button>`;
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-rest]');
        if (!b) return;
        if (b.dataset.rest === 'stop') stop(); else adjust(Number(b.dataset.rest));
      });
    }
    el.querySelector('.rest-fill').style.width = `${(pct * 100).toFixed(1)}%`;
    el.querySelector('.rest-time').textContent = text;
    el.querySelector('[data-rest="stop"]').textContent = left > 0 ? 'Skip' : 'Dismiss';
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });

  HL.rest = { bind, start, stop, unlockAudio };
})(globalThis.HL = globalThis.HL || {});
