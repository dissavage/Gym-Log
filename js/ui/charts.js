/* ════════════════════════════════════
   CHARTS — Chart.js, loaded only when a chart is first shown
   Thin 2px lines, solid hairline grid, text in text colors; every chart also gets
   a data-table twin so no value is tooltip-only.
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util } = HL;
  const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
  const SRI = 'sha384-bs/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW+S3zjqSKR5ZEaD';
  let loading = null;
  const live = new Set();

  function load() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SRC;
        s.integrity = SRI;
        s.crossOrigin = 'anonymous';
        s.onload = () => resolve(window.Chart);
        s.onerror = () => { loading = null; s.remove(); reject(new Error('Charts couldn’t load. Check your connection and try again.')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const xOf = dayKey => util.parseDayKey(dayKey).getTime();
  const fmtX = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  /**
   * line(canvas, { series, formatY, xMin, xMax })
   * series: [{ label, points: [{ dayKey, value }], color, dots, fill }]
   * dots: true draws points only (raw readings under a trend line).
   * xMin/xMax (day keys) pin the axis to the chosen range instead of "nice" rounded bounds.
   */
  async function line(canvas, { series, formatY = v => String(v), xMin = null, xMax = null }) {
    const Chart = await load();
    destroy(canvas);
    if (!canvas.isConnected) return null;
    const surface = token('--surf');
    const grid = token('--border');
    const muted = token('--muted');
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: series.map(s => ({
          label: s.label,
          order: s.dots ? 2 : 1,   // lines draw above raw dots

          data: s.points.map(p => ({ x: xOf(p.dayKey), y: p.value })),
          borderColor: s.color,
          backgroundColor: s.fill ? `${s.color}1a` : s.color,
          fill: !!s.fill,
          showLine: !s.dots,
          borderWidth: 2,
          borderJoinStyle: 'round',
          borderCapStyle: 'round',
          tension: 0.25,
          pointRadius: s.dots ? 4 : (s.points.length === 1 ? 4 : 0),
          pointHoverRadius: 6,
          pointBackgroundColor: s.color,
          pointBorderColor: surface,
          pointBorderWidth: 2,
          pointHitRadius: 14,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion() ? false : { duration: 300 },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        layout: { padding: { top: 6, right: 6 } },
        scales: {
          x: {
            type: 'linear',
            min: xMin ? xOf(xMin) : undefined,
            max: xMax ? xOf(xMax) : undefined,
            bounds: 'data',
            grid: { display: false },
            border: { color: grid },
            ticks: { color: muted, maxTicksLimit: 5, maxRotation: 0, callback: v => fmtX(v), font: { size: 11 } },
          },
          y: {
            grid: { color: grid, lineWidth: 1 },
            border: { display: false },
            ticks: { color: muted, maxTicksLimit: 5, callback: v => formatY(v), font: { size: 11 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: token('--surf3'),
            titleColor: muted,
            bodyColor: token('--text'),
            borderColor: grid,
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            boxWidth: 10,
            boxHeight: 2,
            callbacks: {
              title: items => (items[0] ? fmtX(items[0].parsed.x) : ''),
              label: item => ` ${formatY(item.parsed.y)}  ${item.dataset.label}`,
            },
          },
        },
      },
    });
    live.add(chart);
    return chart;
  }

  function destroy(canvas) {
    for (const c of live) if (c.canvas === canvas) { c.destroy(); live.delete(c); }
  }

  // Destroy every chart inside an element before it's re-rendered or removed
  function destroyIn(el) {
    for (const c of live) if (el.contains(c.canvas)) { c.destroy(); live.delete(c); }
  }

  // HTML legend: line keys beside text-colored labels
  const legendHtml = series => series.length < 2 ? '' : `
    <ul class="legend">${series.map(s => `
      <li><span class="legend-key${s.dots ? ' dot' : ''}" style="--key:${s.color}" aria-hidden="true"></span>${util.esc(s.label)}</li>`).join('')}
    </ul>`;

  // Table twin for a chart; newest first
  function tableHtml(headers, rows, caption) {
    if (!rows.length) return '';
    return `
      <details class="fold data-table">
        <summary>Show data table</summary>
        <div class="fold-body table-wrap">
          <table>
            <caption class="sr-only">${util.esc(caption)}</caption>
            <thead><tr>${headers.map(h => `<th scope="col">${util.esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${util.esc(c)}</td>` : `<th scope="row">${util.esc(c)}</th>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      </details>`;
  }

  // Draw into a .chart-box, showing a retry message if Chart.js can't load (e.g. first use offline)
  async function draw(box, opts) {
    const canvas = box.querySelector('canvas');
    try {
      await line(canvas, opts);
      box.classList.remove('chart-error');
    } catch (err) {
      box.classList.add('chart-error');
      box.querySelector('.chart-msg').innerHTML = `${util.esc(err.message)} <button type="button" class="link-btn" data-chart-retry>Retry</button>`;
    }
  }

  HL.charts = { draw, destroyIn, legendHtml, tableHtml, token };
})(globalThis.HL = globalThis.HL || {});
