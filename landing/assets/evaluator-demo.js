
(() => {
  'use strict';
  let reports;
  try {
    reports = JSON.parse(document.getElementById('landing-samples').textContent);
    if (!Array.isArray(reports) || reports.length !== 3 || reports.some(r => !r.activity || !Array.isArray(r.candidates) || r.candidates.length !== 3)) throw new Error('Invalid demo fixture');
  } catch {
    document.getElementById('sample-stage').innerHTML = '<h3>Demo could not load.</h3><p>The sample data is unavailable. Reload the page or read the evaluator guide linked below. No report was submitted.</p><a class="text-link" href="https://github.com/dinamsingh/Setu/blob/feat/sih-evaluator-demo/docs/EVALUATOR_GUIDE.md">Read the text walkthrough</a>';
    document.querySelectorAll('[data-stage],#previous-stage,#next-stage,#reset-sample,#sample-report').forEach(control => { control.disabled = true; });
    return;
  }
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let reportIndex = 0;
  let stage = 0;
  const stageButtons = Array.from(document.querySelectorAll('[data-stage]'));
  function decision(report) {
    return reportIndex === 2
      ? {action:'Reject suggested link', reason:'The report identifies Section B KP 16–30, but the top candidate is Line D. Similar test terminology cannot establish the correct asset. Its baseline also starts after the reported work.', outcome:'Suggested link rejected in this example. Keep the observation for investigation and a supported remap; exclude it from approved export.'}
      : {action:'Request clarification', reason:`The observation reports completion on ${report.date}, before the candidate starts on ${report.activity.planned_start_date}. ${reportIndex === 0 ? 'Candidates A and D differ by only 0.0006 in stored score.' : 'Nearby sections have similar wording.'} Confirm the actual work date, asset and supporting completion evidence before approving.`, outcome:'On hold for clarification in this example. No approved schedule update or export row is produced.'};
  }
  function panel(report) {
    const E = escape;
    const d = decision(report);
    const evidenceId = `DEMO-EVIDENCE-00${reportIndex + 1}`;
    const source = 'https://github.com/dinamsingh/Setu/blob/main/';
    const interpretations = [
      ['spool erection + field fit-up', 'Finished / reported completion', 'Manifold A', 'No quantity or attachment supplied'],
      ['ROW → right of way; clearing, grubbing and grading', 'Completed / reported completion', 'Section B pipeline route', 'No quantity or attachment supplied'],
      ['NDT → non-destructive testing; radiography', '100% testing reported; acceptance results unknown', 'Section B, KP 16–30', '12 weld joints; no test certificate supplied']
    ][reportIndex];
    if (stage === 0) return `<p class="kicker">01 / Example Supervisor observation</p><h3>Start with what the field reported.</h3><p>This is a synthetic text observation, not a real user submission. “Today” is anchored to the fixture date, never your device clock.</p><dl class="mapping-list"><div class="od-field"><dt>Evidence reference</dt><dd><code>${evidenceId}</code> → ${E(report.id)}</dd></div><div class="od-field"><dt>Reported evidence</dt><dd>${E(report.text)}</dd></div><div class="od-field"><dt>Attachments</dt><dd>None in this fixture. No photograph, geolocation or completion certificate has been verified.</dd></div></dl><p class="stage-note">The original observation stays visible at every stage. Nothing is uploaded.</p>`;
    if (stage === 1) return `<p class="kicker">02 / Illustrative interpretation</p><h3>Translate the words; retain uncertainty.</h3><dl class="mapping-list">${['Work terms','Reported progress','Location phrase','Quantity and evidence'].map((label,i)=>`<div class="od-field"><dt>${label}</dt><dd>${E(interpretations[i])}</dd></div>`).join('')}</dl><p>Report date: <strong>${E(report.date)}</strong>. A claim of completion does not prove quality acceptance or authorize schedule progress.</p><p class="stage-note">Authored interpretation for this walkthrough. No NLP model runs here. The repository implements terminology expansion and matching; this panel is not a live extraction result.</p>`;
    if (stage === 2) return `<p class="kicker">03 / Stored candidate evidence</p><h3>Compare the possible connections.</h3><p class="small muted">Historical synthetic fixture scores, shown on a 0–1 scale. They are ranking signals, not probabilities or current model results.</p><ol class="candidate-list">${report.candidates.map((candidate,index) => `<li><div class="od-field"><span class="mono small">${index + 1}. ${E(candidate.activity_id)}</span><strong>${E(candidate.activity_name)}</strong><span class="small muted">WBS ${E(candidate.wbs_code)} · semantic ${candidate.semantic_score.toFixed(4)} · fuzzy ${candidate.fuzzy_score.toFixed(4)} · discipline ${candidate.discipline_boost.toFixed(1)}</span></div><span class="score">${candidate.final_score.toFixed(4)}</span></li>`).join('')}</ol><p>Location evidence: <strong>${E(report.location)}</strong>. Compare the asset name as well as similar words. Stored scores do not establish physical identity.</p><a class="text-link" href="${source}engine/ensemble_matcher.py">Inspect matching implementation →</a>`;
    if (stage === 3) return `<p class="kicker">04 / Illustrative validation findings</p><h3>A strong score still needs scrutiny.</h3><ul class="check-list"><li><strong>Date · Conflict in example</strong><span>Reported ${E(report.date)}; candidate baseline ${E(report.activity.planned_start_date)} to ${E(report.activity.planned_finish_date)}. Completion precedes the planned start.</span></li><li><strong>Scope / location · ${reportIndex === 2 ? 'Conflict in example' : 'Review required'}</strong><span>${reportIndex === 2 ? 'Section B KP 16–30 does not establish Line D. Do not approve based on terminology alone.' : 'The named section is evidence to inspect; similar candidates require asset confirmation.'}</span></li><li><strong>Candidate ambiguity · Review required</strong><span>Top stored scores are close. Confidence does not resolve conflicting evidence.</span></li><li><strong>Duplicate · Not evaluated</strong><span>No protected report history is accessed.</span></li><li><strong>Reporter / discipline · Not verified</strong><span>No real identity or role is attached to this synthetic observation.</span></li><li><strong>Sequence · Not evaluated</strong><span>No predecessor completion records are supplied.</span></li></ul><p class="stage-note">Authored sample findings, not outputs from the live six-check validator. Missing evidence is never displayed as a pass. Supporting completion evidence is also absent.</p>`;
    if (stage === 4) return `<p class="kicker">05 / Sample planner review</p><h3>${E(d.action)}.</h3><div class="audit-result"><p><strong>Example planner rationale</strong></p><p>${E(d.reason)}</p></div><p>${E(d.outcome)}</p><details class="link-help"><summary>Why not accept or remap immediately?</summary><p>Accept requires current evidence and validation. Reject refuses an unsupported link. Remap requires a defensible alternative and fresh validation. Request clarification keeps uncertainty visible while seeking better evidence. This example does not invent evidence to force an approval.</p></details><p class="stage-note">Predetermined simulation, not an approval control. You cannot change a real report, planner decision or schedule here. Next opens the resulting sample audit record.</p>`;
    return `<p class="kicker">06 / Sample audit &amp; schedule context</p><h3>The reason stays with the result.</h3><dl class="mapping-list"><div class="od-field"><dt>Sample audit ID / actor</dt><dd><code>DEMO-AUDIT-00${reportIndex + 1}</code> · Example Planner (fictional role)</dd></div><div class="od-field"><dt>Fixed example timestamp</dt><dd>2026-04-20T10:00:00Z · authored fixture time</dd></div><div class="od-field"><dt>Trace</dt><dd>${E(report.id)} → ${evidenceId} → ${E(report.activity.activity_id)} → ${E(d.action)}</dd></div><div class="od-field"><dt>Decision reason</dt><dd>${E(d.reason)}</dd></div><div class="od-field"><dt>Schedule context</dt><dd>WBS ${E(report.activity.wbs_code)} · ${E(report.activity.wbs_name)}<br>Baseline remains ${E(report.activity.planned_start_date)} to ${E(report.activity.planned_finish_date)}.</dd></div><div class="od-field"><dt>Result / export eligibility</dt><dd>${E(d.outcome)} No actual start, actual finish or percent-complete change is asserted.</dd></div></dl><p class="stage-note">Walkthrough complete. This sample record exists only in this page; it was not saved to a database. A real planner decision is authenticated and audited by the protected application.</p><a class="text-link" href="${source}frontend/src/pages/planner/AuditExport.tsx">Inspect real audit/export source →</a><p>Use Restart to return to the first example, or choose another observation. <a class="text-link" href="#implementation">What is implemented today? →</a></p>`;
  }
  function draw(moveFocus = false) {
    const report = reports[reportIndex];
    $('report-id').textContent = report.id;
    $('report-text').textContent = '“' + report.text + '”';
    $('report-location').textContent = report.location;
    $('report-date').textContent = report.date;
    $('sample-report').value = String(reportIndex);
    $('sample-stage').innerHTML = panel(report);
    $('previous-stage').disabled = stage === 0;
    $('next-stage').disabled = stage === 5;
    $('report-status').textContent = stage === 5 ? 'Example · ' + decision(report).action : 'Example · Pending review';
    if (moveFocus) $('sample-stage').focus({preventScroll:true});
    $('stage-progress').textContent = `Step ${stage + 1} of 6`;
    stageButtons.forEach(button => {
      if (Number(button.dataset.stage) === stage) button.setAttribute('aria-current','step');
      else button.removeAttribute('aria-current');
    });
  }
  $('sample-report').addEventListener('change', event => { reportIndex = Number(event.target.value); stage = 0; draw(true); });
  stageButtons.forEach(button => button.addEventListener('click', () => { stage = Number(button.dataset.stage); draw(true); }));
  $('previous-stage').addEventListener('click', () => { stage = Math.max(0,stage - 1); draw(true); });
  $('next-stage').addEventListener('click', () => { stage = Math.min(5,stage + 1); draw(true); });
  $('reset-sample').addEventListener('click', () => { reportIndex = 0; stage = 0; draw(true); });
  const menu = $('mobile-navigation');
  const toggle = $('menu-toggle');
  function setMenu(open, focusReturn = false) {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    toggle.innerHTML = open ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>' : '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    if (focusReturn) toggle.focus();
  }
  toggle.addEventListener('click', () => setMenu(menu.hidden));
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) setMenu(false,true); });
  window.addEventListener('resize', () => { if (window.innerWidth >= 768) setMenu(false); });
  document.querySelectorAll('.nav-links a,.mobile-nav a').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.nav-links a,.mobile-nav a').forEach(other => {
      if (other.getAttribute('href') === link.getAttribute('href')) other.setAttribute('aria-current','location');
      else other.removeAttribute('aria-current');
    });
  }));

  // Direct scrolling remains usable when a preview host owns the URL fragment.
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    if (!link) return;
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    const focus = target.querySelector('h1,h2') || target;
    focus.setAttribute('tabindex','-1'); focus.focus({preventScroll:true});
    document.querySelectorAll('.nav-links a,.mobile-nav a').forEach(other => {
      if (other.getAttribute('href') === link.getAttribute('href')) other.setAttribute('aria-current','location');
      else other.removeAttribute('aria-current');
    });
    if (!menu.hidden) setMenu(false);
  });
  document.querySelectorAll('[data-address]').forEach(input => {
    input.value = new URL(input.value,window.location.href).href;
    input.addEventListener('focus', () => input.select());
  });
  document.addEventListener('click', async event => {
    const button = event.target instanceof Element ? event.target.closest('[data-open-url],[data-copy-url]') : null;
    if (!button) return;
    const status = button.closest('.link-help').querySelector('.feedback');
    const url = button.dataset.openUrl || button.dataset.copyUrl;
    if (button.dataset.copyUrl) {
      try { await navigator.clipboard.writeText(new URL(url,window.location.href).href); status.textContent='Link copied. Paste it into your browser.'; }
      catch { status.textContent='Clipboard access is unavailable. Select and copy the address above.'; }
      return;
    }
    try {
      const tab = window.open('about:blank','_blank');
      if (!tab) { status.textContent='Your browser blocked the new tab. Use a direct link or copy the address above.'; return; }
      tab.opener=null; tab.location.replace(new URL(url,window.location.href).href);
      status.textContent='Opened in a new tab. If the destination is unavailable, use a direct page entry or continue with the sample.';
    } catch { status.textContent='This browser could not open a new tab. Use a direct link or copy the address above.'; }
  });
  draw();
})();
