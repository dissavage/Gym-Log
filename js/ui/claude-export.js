/* ════════════════════════════════════
   EXPORT FOR CLAUDE — More → pick a month, preview it, get one .md file for a Claude chat
   Read-only: builds from the repo's getters through monthReport (js/export.js).
   ════════════════════════════════════ */
(function (HL) {
  'use strict';

  const { util, repo, monthReport } = HL;
  const { esc } = util;
  const SECTION_LABELS = {
    workouts: 'Every workout', progress: 'Exercise progress', weekly: 'Weekly sets',
    daily: 'Daily trackers', supplements: 'Supplements', previous: 'vs previous month',
  };

  /* ════════════════════════════════════
     DATA
     ════════════════════════════════════ */
  // The ?v= on this page's app script is the release number
  function appVersion() {
    const src = document.querySelector('script[src*="js/app.js"]')?.getAttribute('src') || '';
    const v = /[?&]v=([^&]+)/.exec(src)?.[1];
    return v ? `v${v}` : null;
  }

  function deps() {
    return {
      entries: repo.entries(),
      trackers: repo.trackers({ archived: true }),
      exercises: repo.all('exercises', { deleted: true }),
      templates: repo.all('templates', { deleted: true }),
      checklistItems: repo.all('checklistItems', { deleted: true }),
      settings: repo.getSettings(),
      today: util.dayKey(),
      appVersion: appVersion(),
      timezone: util.tzName(),
      isDemo: HL.demo.isDemo,
    };
  }

  // Saved choice; anything missing (older settings, older backups) counts as on
  function sectionChoice() {
    const saved = repo.getSettings().exportSections || {};
    return Object.fromEntries(monthReport.SECTIONS.map(k => [k, saved[k] !== false]));
  }

  // Months with at least one of the person's own logs, oldest first, never after this month
  function monthsWithData(entries, current) {
    const set = new Set();
    for (const e of entries) if (!HL.demo.isDemo(e)) set.add(e.dayKey.slice(0, 7));
    return [...set].filter(m => m <= current).sort();
  }

  // Last month when it has logs, otherwise this month
  function defaultMonth(months, current) {
    const prev = monthReport.shiftMonth(current, -1);
    return months.includes(prev) ? prev : current;
  }

  // The file as it would be exported right now. Synchronous, so a tap handler can share it straight away.
  function build(month, d = deps()) {
    const report = monthReport.buildMonthReport(month, d);
    const text = monthReport.renderReportMarkdown(report, { sections: sectionChoice() });
    return { report, text, bytes: monthReport.byteSize(text), filename: `health-log-${month}.md` };
  }

  /* ════════════════════════════════════
     SHEET
     ════════════════════════════════════ */
  function open() {
    const current = util.dayKey().slice(0, 7);
    const months = monthsWithData(repo.entries(), current);
    let month = defaultMonth(months, current);
    let saveGoal = () => {};
    const s = repo.getSettings();
    const sections = sectionChoice();

    const body = `
      <p class="field-hint block-gap">One month of your logs as a Markdown file you can attach to a Claude chat for analysis.</p>
      <div class="week-nav">
        <button type="button" class="icon-btn" data-cx="prev" aria-label="Previous month with data">${util.icon('chev-left', 20)}</button>
        <span class="week-lbl" id="cx-month"></span>
        <button type="button" class="icon-btn" data-cx="next" aria-label="Next month with data">${util.icon('chev-right', 20)}</button>
      </div>
      <p class="cx-preview" id="cx-preview" aria-live="polite"></p>
      <div class="field">
        <label class="field-label" for="cx-goal">My goal (included at the top of the file)</label>
        <textarea class="input" id="cx-goal" name="goal" rows="3" maxlength="2000"
          placeholder="e.g. Lean bulk to 185 lb, bench 275 by March">${esc(s.exportGoal || '')}</textarea>
      </div>
      <fieldset class="cx-sections">
        <legend class="field-label">Include</legend>
        ${monthReport.SECTIONS.map(k => `
          <label class="check-inline"><input type="checkbox" name="section" value="${k}" ${sections[k] ? 'checked' : ''}> ${esc(SECTION_LABELS[k])}</label>`).join('')}
      </fieldset>
      <div class="cx-actions">
        <button type="button" class="btn btn-primary btn-block" data-cx="share">Share to Claude</button>
        <div class="cx-row">
          <button type="button" class="btn btn-ghost" data-cx="download">Download .md</button>
          <button type="button" class="btn btn-ghost" data-cx="copy">Copy</button>
        </div>
      </div>
      <p class="field-hint" id="cx-status" role="status" aria-live="polite"></p>`;

    HL.sheet.open({
      title: 'Export for Claude', icon: util.icon('file', 20), body,
      onMount: api => {
        const $ = sel => api.body.querySelector(sel);
        const goal = $('#cx-goal');

        function refresh() {
          const before = months.filter(m => m < month);
          const after = months.filter(m => m > month);
          $('#cx-month').textContent = monthReport.monthBounds(month).label;
          $('[data-cx="prev"]').disabled = !before.length;
          $('[data-cx="next"]').disabled = !after.length;
          const { report, bytes } = build(month);
          const kb = Math.max(1, Math.round(bytes / 1024));
          const st = report.stats;
          const parts = [
            `${st.workouts} workout${st.workouts === 1 ? '' : 's'}`,
            `${st.workingSets.toLocaleString()} set${st.workingSets === 1 ? '' : 's'}`,
            `${st.daysLogged} day${st.daysLogged === 1 ? '' : 's'} of logs`,
            `~${kb.toLocaleString()} KB`,
          ];
          const big = bytes > monthReport.SIZE_WARN_BYTES;
          $('#cx-preview').innerHTML = report.empty
            ? '<strong>No data for this month</strong>'
            : `${esc(parts.join(' · '))}${big ? `<span class="cx-warn">${util.icon('alert', 16)} That’s a large file — Claude may not read all of it. Turning off “Every workout” makes it much smaller.</span>` : ''}`;
          for (const b of api.body.querySelectorAll('.cx-actions .btn')) b.disabled = report.empty;
          $('#cx-status').textContent = '';
        }

        saveGoal = () => {
          const v = goal.value.trim();
          if (v !== (repo.getSettings().exportGoal || '')) repo.setSettings({ exportGoal: v });
        };
        const typed = util.debounce(() => { saveGoal(); refresh(); }, 400);
        goal.addEventListener('input', typed);
        goal.addEventListener('blur', saveGoal);

        api.body.addEventListener('change', e => {
          if (e.target.name !== 'section') return;
          const next = {};
          for (const box of api.body.querySelectorAll('input[name="section"]')) next[box.value] = box.checked;
          repo.setSettings({ exportSections: next });
          refresh();
        });

        api.body.addEventListener('click', e => {
          const act = e.target.closest('[data-cx]')?.dataset.cx;
          if (act === 'prev') { const m = months.filter(x => x < month); if (m.length) { month = m[m.length - 1]; refresh(); } }
          if (act === 'next') { const m = months.find(x => x > month); if (m) { month = m; refresh(); } }
        });

        refresh();
      },
      // More re-renders behind the sheet when settings change, so put focus back on the new row
      onClose: () => {
        saveGoal();
        document.querySelector('#view-more [data-act="claude-export"]')?.focus({ preventScroll: true });
      },
    });
  }

  /* ════════════════════════════════════
     MORE SECTION
     ════════════════════════════════════ */
  function sectionHtml() {
    return `
      <section class="settings-section" aria-labelledby="cx-h">
        <h2 class="section-label" id="cx-h">Export for Claude</h2>
        <div class="settings-card">
          <button type="button" class="settings-row settings-link" data-act="claude-export">
            <span><span class="settings-lbl">Monthly report</span><span class="settings-sub">One month as a .md file to attach to a Claude chat</span></span>
            <span class="row-ico" aria-hidden="true">${util.icon('chev-right', 18)}</span></button>
        </div>
      </section>`;
  }

  // Returns true when the click was handled here
  function onClick(e) {
    if (!e.target.closest('[data-act="claude-export"]')) return false;
    open();
    return true;
  }

  HL.claudeExport = { sectionHtml, onClick, open, build, monthsWithData, defaultMonth };
})(globalThis.HL = globalThis.HL || {});
