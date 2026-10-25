/* ════════════════════════════════════
   TEMPORARY layout readout for the tab-bar position on iPhone (?debug=1 on, ?debug=0 off).
   Loaded by app.js only when the flag is set. Delete this file once the layout is confirmed.
   ════════════════════════════════════ */
(function () {
  'use strict';

  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:4px;right:4px;top:calc(env(safe-area-inset-top) + 4px);z-index:1000;pointer-events:none;'
    + 'font:11px/1.35 ui-monospace,Menlo,monospace;color:#7CFC00;background:rgba(0,0,0,.82);padding:6px 8px;border-radius:8px;white-space:pre';
  // Elements whose computed size tells us what env() and the viewport units really are
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  const unit = u => { const d = document.createElement('div'); d.style.cssText = `position:fixed;left:-9999px;top:0;width:1px;height:100${u}`; document.body.appendChild(d); return d; };
  const units = ['vh', 'dvh', 'svh', 'lvh'].map(u => [u, unit(u)]);
  document.body.append(probe, box);

  const px = v => `${Math.round(parseFloat(v) * 10) / 10}`;
  const sizeOf = el => { const s = getComputedStyle(el); return `h ${px(s.height)}  pad ${px(s.paddingTop)}/${px(s.paddingBottom)}  mar ${px(s.marginTop)}/${px(s.marginBottom)}`; };

  function update() {
    const ps = getComputedStyle(probe);
    const nav = document.querySelector('.tabbar');
    const r = nav.getBoundingClientRect();
    const vv = window.visualViewport;
    box.textContent = [
      `safe-area top ${px(ps.paddingTop)}  bottom ${px(ps.paddingBottom)}`,
      `innerH ${innerHeight}  clientH ${document.documentElement.clientHeight}  screenH ${screen.height}  vv ${vv ? `${px(vv.height)} @${px(vv.offsetTop)}` : '-'}`,
      `standalone ${matchMedia('(display-mode: standalone)').matches || navigator.standalone === true}  dpr ${devicePixelRatio}`,
      `units ${units.map(([u, d]) => `${u} ${px(d.getBoundingClientRect().height)}`).join('  ')}`,
      `nav top ${px(r.top)}  bottom ${px(r.bottom)}  h ${px(r.height)}  gap below ${px(innerHeight - r.bottom)}`,
      `html  ${sizeOf(document.documentElement)}`,
      `body  ${sizeOf(document.body)}`,
      `main  ${sizeOf(document.getElementById('main'))}`,
      `nav   ${sizeOf(nav)}`,
    ].join('\n');
  }
  update();
  setInterval(update, 500);
  addEventListener('resize', update);
})();
