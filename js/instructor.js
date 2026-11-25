/* Faculty console: multi-instructor accounts, sections, case library, grading. */
(function () {
  const C = window.CASE, $ = s => document.querySelector(s), esc = EHR.esc;
  let me = null;                       // signed-in instructor
  let records = [], sections = [], filter = { q: '', section: '', status: '' };
  let current = null, viewer = null, currentCase = null;
  let order = [], gradeDirty = false, editorDirty = false, lastLoad = null, view = '';

  /* ---------- helpers ---------- */
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    $('#toasts').appendChild(t); requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 3800);
  }
  const fmt = t => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const ago = t => { if (!t) return '—'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : fmt(t); };
  const statusPill = s => ({ draft: '<span class="pill blue">In progress</span>', submitted: '<span class="pill amber">Submitted</span>', graded: '<span class="pill green">Graded</span>' }[s] || esc(s));
  const S = (action, payload) => API.staff(action, payload).catch(e => {
    if (/session has expired|account disabled/i.test(e.message)) {
      API.token.set(''); sessionStorage.setItem('ncm110_fac_notice', /disabled/i.test(e.message) ? 'Your account has been disabled. Contact your administrator.' : 'Your session expired. Please sign in again.');
      gradeDirty = editorDirty = false; location.reload();
    }
    throw e;
  });
  const confirmLeave = () => (!gradeDirty || confirm('You have unsaved grading changes. Leave without saving?')) && (!editorDirty || confirm('You have unsaved changes to this case. Leave without saving?'));
  window.addEventListener('beforeunload', e => { if (gradeDirty || editorDirty) { e.preventDefault(); e.returnValue = ''; } });
  const initials = n => String(n || '?').replace(/^(prof|dr|mr|ms|mrs)\.?\s+/i, '').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();

  function bannerHtml(p, extra) {
    return `<div class="pt-photo"><span>${esc(p.initials)}</span></div><div class="pt-main"><div class="pt-name">${esc(p.name)} ${p.nickname ? `<span class="nick">"${esc(p.nickname)}"</span>` : ''}</div><div class="pt-ids"><span>${esc(p.sex)}${p.age ? ', ' + esc(p.age) : ''}</span><span>DOB <b>${esc(p.dob)}</b></span><span>Hosp No. <b>${esc(p.hospNo)}</b></span></div></div>
      <div class="pt-cols"><div><small>Location</small><b>${esc(p.location)}</b></div><div class="wide"><small>Admitting Dx</small><b>${esc(p.dx)}</b></div></div>
      <div class="pt-flags">${/^\s*(nkda|none)?\s*$/i.test(p.allergy) ? '<span class="flag-chip">NKDA</span>' : `<span class="flag-allergy" title="Allergy: ${esc(p.allergy)}">${EHR.icon('warn', 'sm')} ALLERGY: ${esc(p.allergy)}</span>`}${extra || ''}</div>`;
  }

  /* ---------- generic form modal ---------- */
  function formModal({ title, fields, submit, onSubmit }) {
    $('#fmTitle').textContent = title; $('#fmErr').textContent = ''; $('#fmSubmit').textContent = submit || 'Save';
    $('#fmBody').innerHTML = fields.map(f => `<label>${esc(f.label)}${f.type === 'select'
      ? `<select class="f" name="${f.name}">${f.options.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`
      : `<input class="f" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.ro ? 'readonly' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}>`}${f.hint ? `<small class="muted">${esc(f.hint)}</small>` : ''}</label>`).join('');
    $('#formModal').hidden = false;
    const first = $('#fmBody').querySelector('input:not([readonly]),select'); if (first) setTimeout(() => first.focus(), 30);
    $('#fmForm').onsubmit = async e => {
      e.preventDefault();
      const vals = Object.fromEntries(new FormData($('#fmForm')));
      $('#fmSubmit').disabled = true;
      try { await onSubmit(vals); $('#formModal').hidden = true; }
      catch (err) { $('#fmErr').textContent = err.message; }
      finally { $('#fmSubmit').disabled = false; }
    };
  }
  $('#formModal').addEventListener('click', e => { if (e.target.matches('[data-close]') || e.target.id === 'formModal') $('#formModal').hidden = true; });

  /* ---------- sign in / account ---------- */
  const USER_KEY = 'ncm110_fac_user', NOTICE_KEY = 'ncm110_fac_notice';
  if (API.DEMO) $('#iDemo').hidden = false;
  function showLogin() {
    $('#iLogin').hidden = false;
    let u = ''; try { u = localStorage.getItem(USER_KEY) || ''; } catch (e) {}
    $('#iUser').value = u;
    const n = sessionStorage.getItem(NOTICE_KEY);
    if (n) { $('#iNotice').textContent = n; $('#iNotice').hidden = false; sessionStorage.removeItem(NOTICE_KEY); }
    setTimeout(() => (u ? $('#iPw') : $('#iUser')).focus(), 60);
  }
  function setBusy(b) { const btn = $('#iLoginBtn'); btn.disabled = b; btn.classList.toggle('busy', b); btn.querySelector('.btn-lbl').textContent = b ? 'Signing in…' : 'Sign in'; }
  function fieldErr(el, msg) { $('#iErr').textContent = msg; el.classList.add('bad'); el.focus(); }
  ['#iUser', '#iPw'].forEach(s => $(s).addEventListener('input', () => { $(s).classList.remove('bad'); $('#iErr').textContent = ''; }));
  $('#iPwToggle').addEventListener('click', () => {
    const show = $('#iPw').type === 'password';
    $('#iPw').type = show ? 'text' : 'password';
    $('#iPwToggle').textContent = show ? 'Hide' : 'Show';
    $('#iPwToggle').setAttribute('aria-pressed', show); $('#iPwToggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    $('#iPw').focus();
  });
  ['keydown', 'keyup'].forEach(ev => $('#iPw').addEventListener(ev, e => { if (e.getModifierState) $('#iCaps').hidden = !e.getModifierState('CapsLock'); }));
  $('#iDemo').addEventListener('click', e => {
    const b = e.target.closest('[data-u]'); if (!b) return;
    $('#iUser').value = b.dataset.u; $('#iPw').value = b.dataset.p;
    $('#iDemo').querySelectorAll('[data-u]').forEach(x => x.classList.toggle('on', x === b));
    $('#iLoginBtn').focus();
  });
  $('#iLoginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#iErr').textContent = ''; $('#iNotice').hidden = true;
    const u = $('#iUser').value.trim(), p = $('#iPw').value;
    if (!u) return fieldErr($('#iUser'), 'Enter your username.');
    if (!p) return fieldErr($('#iPw'), 'Enter your password.');
    setBusy(true);
    try {
      const r = await API.call('staffLogin', { username: u, password: p });
      API.token.set(r.token); $('#iPw').value = '';
      try { localStorage.setItem(USER_KEY, u.toLowerCase()); } catch (err) {}
      start(r.user, r.mustChange);
      toast('Welcome, ' + r.user.name, 'ok');
    } catch (err) {
      $('#iErr').textContent = /wrong username or password/i.test(err.message) ? 'That username and password don\'t match. Check Caps Lock and try again.' : err.message;
      $('#iPw').select();
    } finally { setBusy(false); }
  });
  $('#iLogout').addEventListener('click', async () => { if (!confirmLeave()) return; try { await S('logout'); } catch (e) {} API.token.set(''); location.hash = ''; location.reload(); });
  $('#acctBtn').addEventListener('click', e => { e.stopPropagation(); $('#acctMenu').hidden = !$('#acctMenu').hidden; });
  document.addEventListener('click', () => { $('#acctMenu').hidden = true; });
  $('#pwBtn').addEventListener('click', () => changePassword(false));
  function changePassword(forced) {
    formModal({
      title: forced ? 'Set your own password' : 'Change password', submit: 'Update password',
      fields: [
        { name: 'old', label: forced ? 'Temporary password (from your admin)' : 'Current password', type: 'password', autocomplete: 'current-password' },
        { name: 'nw', label: 'New password', type: 'password', hint: 'At least 6 characters.', autocomplete: 'new-password' },
        { name: 'nw2', label: 'Repeat new password', type: 'password', autocomplete: 'new-password' }
      ],
      onSubmit: async v => { if (v.nw !== v.nw2) throw new Error('The new passwords do not match.'); await S('changePassword', { oldPassword: v.old, newPassword: v.nw }); toast('Password updated', 'ok'); }
    });
  }

  function start(user, mustChange) {
    me = user;
    $('#iLogin').hidden = true; $('#iApp').hidden = false;
    $('#acctName').textContent = me.name; $('#acctFull').textContent = me.name; $('#acctAv').textContent = initials(me.name);
    $('#acctRole').textContent = (me.role === 'admin' ? 'Administrator' : 'Instructor') + ' · ' + me.id;
    $('#navAdmin').hidden = me.role !== 'admin';
    if (mustChange) setTimeout(() => changePassword(true), 300);
    route();
  }

  /* ---------- routing ---------- */
  const VIEWS = ['subs', 'sections', 'cases', 'editor', 'admin'];
  $('#mainNav').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });
  function go(v, arg) {
    if (!confirmLeave()) return false;
    gradeDirty = false; editorDirty = false;
    history.replaceState(null, '', '#' + v + (arg ? '=' + encodeURIComponent(arg) : ''));
    route(); return true;
  }
  function route() {
    const m = /^#(\w+)(?:=(.+))?$/.exec(location.hash) || [];
    let v = m[1] || 'subs'; const arg = m[2] ? decodeURIComponent(m[2]) : '';
    if (v === 'admin' && me.role !== 'admin') v = 'subs';
    if (v === 'review' && arg) return openReview(arg);
    if (v === 'case' && arg) return openEditor(arg);
    show(VIEWS.includes(v) && v !== 'editor' ? v : 'subs');
  }
  function show(v) {
    view = v;
    VIEWS.forEach(x => { $('#view-' + x).hidden = x !== v; });
    $('#reviewView').hidden = true; $('#backBtn').hidden = true;
    current = null; viewer = null;
    document.querySelectorAll('#mainNav [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    $('#crumbs').textContent = '';
    if (v === 'subs') loadSubs();
    if (v === 'sections') loadSections();
    if (v === 'cases') loadCases();
    if (v === 'admin') loadAdmin();
  }

  /* =================== SUBMISSIONS =================== */
  async function loadSubs(silent) {
    try {
      const [r, secs] = await Promise.all([S('list'), S('mySections')]);
      records = r.records || []; sections = secs; lastLoad = Date.now(); renderSubs();
    } catch (e) { if (!silent) toast(e.message, 'err'); }
  }
  $('#refreshBtn').addEventListener('click', () => loadSubs().then(() => toast('Updated')));
  setInterval(() => { if (me && view === 'subs' && document.visibilityState === 'visible') loadSubs(true); }, 30000);
  setInterval(() => { if (lastLoad) $('#liveTxt').textContent = 'Live · updated ' + ago(lastLoad); }, 10000);
  $('#q').addEventListener('input', e => { filter.q = e.target.value.toLowerCase(); renderSubs(); });
  $('#fSection').addEventListener('change', e => { filter.section = e.target.value; renderSubs(); });
  $('#fStatus').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; filter.status = b.dataset.v; [...$('#fStatus').children].forEach(x => x.classList.toggle('on', x === b)); renderSubs(); });

  function renderSubs() {
    $('#fSection').innerHTML = '<option value="">All my sections</option>' + sections.map(s => `<option value="${esc(s.code)}" ${s.code === filter.section ? 'selected' : ''}>${esc(s.code)} — ${esc(s.caseTitle || 'no case')}</option>`).join('');
    const inScope = records.filter(r => !filter.section || r.section === filter.section);
    const n = s => inScope.filter(r => r.status === s).length;
    const graded = inScope.filter(r => r.total != null);
    const avg = graded.length ? Math.round(graded.reduce((a, r) => a + +r.total, 0) / graded.length) : '—';
    $('#stats').innerHTML = [['Charts', inScope.length, ''], ['In progress', n('draft'), 'blue'], ['Awaiting grading', n('submitted'), 'amber'], ['Graded', n('graded'), 'green'], ['Average score', avg, '']].map(([l, v, c]) => `<div class="stat ${c}"><small>${l}</small><b>${v}</b></div>`).join('');
    renderAnalytics(inScope);
    if (lastLoad) $('#liveTxt').textContent = 'Live · updated ' + ago(lastLoad);
    const rows = inScope
      .filter(r => (!filter.status || r.status === filter.status) && (!filter.q || (r.id + ' group ' + r.group + ' ' + (r.members || []).join(' ')).toLowerCase().includes(filter.q)))
      .sort((a, b) => ({ submitted: 0, draft: 1, graded: 2 }[a.status] - { submitted: 0, draft: 1, graded: 2 }[b.status]) || String(a.section).localeCompare(b.section) || (+a.group - +b.group));
    order = rows.map(r => r.id);
    $('#subRows').innerHTML = rows.length ? rows.map(r => {
      const pct = Math.max(0, Math.min(100, +r.progress || 0));
      const active = r.status === 'draft' && r.updatedAt && Date.now() - r.updatedAt < 3 * 60000;
      const mem = r.members || [];
      return `<tr class="click" data-id="${esc(r.id)}" tabindex="0">
        <td><b>Group ${esc(r.group)}</b> <span class="muted">· ${esc(r.section)}</span><br><small class="muted members" title="${esc(mem.join(', '))}">${mem.length ? esc(mem.slice(0, 3).join(', ')) + (mem.length > 3 ? ' +' + (mem.length - 3) : '') : 'No members entered yet'}</small></td>
        <td>${statusPill(r.status)}${r.submittedAt ? `<br><small class="muted">${fmt(r.submittedAt)}</small>` : ''}<br>${r.practiceDone ? `<small class="pr-done">${EHR.icon('check', 'sm')} Practice ${r.practiceWaivedBy ? 'skipped' : 'done'}</small>` : '<small class="pr-todo">Practice not finished</small>'}</td>
        <td><div class="prog"><div class="bar sm"><i style="width:${pct}%"></i></div><span>${pct}%</span></div></td>
        <td>${active ? '<span class="live-dot" title="Editing now"></span>' : ''}${ago(r.updatedAt)}</td>
        <td class="num">${r.total != null ? `<b>${r.total}</b><small class="muted"> /100</small><br>${r.released ? '<span class="pill green">Released</span>' : '<span class="pill grey">Not released</span>'}` : '<span class="muted">—</span>'}</td>
        <td><button class="btn sm ${r.status === 'submitted' ? 'primary' : ''}">${r.status === 'submitted' ? 'Grade' : r.status === 'graded' ? 'Review' : 'View'}</button></td></tr>`;
    }).join('')
      : `<tr><td colspan="6" class="empty">${!sections.length ? 'You have no sections yet. Ask your administrator to assign one to you.' : records.length ? 'No charts match the filter.' : 'No groups have signed in yet. Charts appear here as soon as a group signs in.'}</td></tr>`;
  }
  /* class analytics: one series per chart, bars labelled with their value */
  function renderAnalytics(list) {
    const VZ = window.EHRViz;
    const tasks = EHR.TABS.filter(t => t.id && !["summary", "orders", "vitals", "labs", "results"].includes(t.id));
    const withTp = list.filter(r => r.taskProgress);
    const taskRows = withTp.length ? tasks.map(t => { const vals = withTp.map(r => +r.taskProgress[t.id] || 0); const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length); const done = vals.filter(v => v >= 100).length; return { label: (t.sub.startsWith("Task") ? t.sub + " " : "") + t.label, value: avg, tip: avg + "% average · " + done + " of " + vals.length + " groups finished" }; }) : [];
    const graded = list.filter(r => r.scores);
    const items = C.rubric.flatMap(sec => sec.items);
    const rubricRows = graded.length ? items.map(it => { const v = graded.map(r => parseFloat(r.scores[it.id])).filter(x => !isNaN(x)); if (!v.length) return null; const avg = v.reduce((a, b) => a + b, 0) / v.length; return { label: it.label, value: Math.round(avg / it.max * 100), text: (Math.round(avg * 10) / 10) + " / " + it.max, tip: "Average " + (Math.round(avg * 10) / 10) + " of " + it.max + " (" + v.length + " graded)" }; }).filter(Boolean) : [];
    $("#analytics").innerHTML = `<section class="card an-card"><h2>Average completion by task</h2><p class="hint">${withTp.length ? "Across " + withTp.length + " group chart" + (withTp.length === 1 ? "" : "s") + " in view. Hover a bar for details." : ""}</p>${VZ.hbars(taskRows, { empty: "Appears once groups start charting." })}</section>
      <section class="card an-card"><h2>Rubric averages</h2><p class="hint">${graded.length ? graded.length + " graded chart" + (graded.length === 1 ? "" : "s") + ". Bar = average as % of the criterion maximum." : ""}</p>${VZ.hbars(rubricRows, { empty: "Appears once you grade a chart." })}</section>`;
  }
  $('#subRows').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) go('review', tr.dataset.id); });
  $('#subRows').addEventListener('keydown', e => { const tr = e.target.closest('tr[data-id]'); if (tr && e.key === 'Enter') go('review', tr.dataset.id); });

  $('#exportBtn').addEventListener('click', async () => {
    const items = C.rubric.flatMap(s => s.items);
    const list = records.filter(r => !filter.section || r.section === filter.section);
    const lines = [['Chart', 'Section', 'Group', 'Status', 'Submitted', ...items.map(i => `${i.label} (/${i.max})`), 'Total', 'Graded by', 'Members']];
    for (const r of list) {
      let full = null; try { full = (await S('get', { id: r.id })).record; } catch (e) {}
      const g = (full && full.grades) || {}; const sc = g.scores || {};
      const members = full && full.data ? full.data.group.members.filter(m => m.name).map(m => `${m.name} (${m.role})`).join('; ') : '';
      lines.push([r.id, r.section, r.group, r.status, r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '', ...items.map(i => sc[i.id] ?? ''), g.total ?? '', g.by || '', members]);
    }
    const csv = lines.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `NCM110-EHR-grades${filter.section ? '-' + filter.section : ''}.csv`; a.click(); toast('CSV downloaded');
  });

  /* =================== MY SECTIONS =================== */
  let caseList = [];
  async function loadSections() {
    $('#secGrid').innerHTML = '<p class="muted">Loading…</p>';
    try { [sections, caseList] = await Promise.all([S('mySections'), S('listCases')]); renderSections(); }
    catch (e) { toast(e.message, 'err'); }
  }
  function renderSections() {
    if (!sections.length) { $('#secGrid').innerHTML = '<section class="card empty">You don\'t handle any sections yet. Your administrator assigns sections to instructors.</section>'; return; }
    const popts = sel => '<option value="">— None (graded task only) —</option>' + caseList.map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.title)}${c.builtin ? ' (built-in)' : ''}</option>`).join('');
    const opts = sel => '<option value="">— No case (students cannot sign in) —</option>' + caseList.filter(c => c.id !== EHRCore.SAMPLE_ID || c.id === sel).map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.title)}${c.builtin ? ' (built-in sample)' : ''}</option>`).join('');
    $('#secGrid').innerHTML = sections.map(s => `
      <section class="card sec-card ${s.caseId ? '' : 'nocase'}" data-code="${esc(s.code)}">
        <div class="sc-head"><div><h2>${esc(s.code)}</h2><small class="muted">${s.groups ? s.groups + ' groups' : 'Groups not set'}${me.role === 'admin' && s.instructor !== me.id ? ' · ' + esc(s.instructor) : ''}</small></div>
          <div class="sc-stats"><span><b>${s.charts}</b> started</span><span><b>${s.submitted}</b> submitted</span></div></div>
        ${!s.groups || !s.caseId ? `<div class="sc-setup">${EHR.icon('warn', 'sm')}<span>Students can't sign in yet: ${[!s.groups ? 'set the number of groups' : '', !s.caseId ? 'assign a patient case' : ''].filter(Boolean).join(' and ')}.</span></div>` : ''}
        <div class="sc-groups">
          <div><b>Number of groups</b><small>Students pick Group 1 to ${s.groups || 'N'} when they sign in.</small></div>
          <div class="stepper" data-min="${Math.max(1, s.maxGroupUsed || 0)}">
            <button type="button" class="step" data-step="-1" aria-label="Fewer groups">${EHR.icon('x', 'sm').replace(/d="[^"]*"/, 'd="M6 12h12"')}</button>
            <input class="f" type="number" min="1" max="50" step="1" data-patch="groups" value="${s.groups || ''}" placeholder="—" aria-label="Number of groups for ${esc(s.code)}">
            <button type="button" class="step" data-step="1" aria-label="More groups">${EHR.icon('x', 'sm').replace(/d="[^"]*"/, 'd="M12 6v12M6 12h12"')}</button>
          </div>
        </div>
        <div class="sc-practice"><span class="sc-badge practice">Practice</span><div><b>${esc(s.practiceCaseTitle)}</b><small>Required first · not graded · saved on each student's device${s.charts ? ` · <b>${s.practiceDone} of ${s.charts}</b> group${s.charts === 1 ? '' : 's'} finished` : ''}</small></div><button type="button" class="btn sm" data-act="previewPractice">Preview</button></div>
        ${s.gradedIsPractice ? '<small class="warn-txt">Lola Charing is the practice case. Choose a different graded case below, otherwise groups skip practice.</small>' : ''}
        <label class="sc-case"><span class="sc-lbl"><span class="sc-badge task">Graded</span> Graded task case</span>
          <div class="sc-case-row"><select class="f" data-patch="caseId" ${s.charts ? 'data-started="1"' : ''}>${opts(s.caseId)}</select><button type="button" class="btn sm" data-act="previewCase" ${s.caseId ? '' : 'disabled'}>Preview</button></div>
          ${s.caseId ? '' : '<small class="warn-txt">Assign a case so students in this section can sign in.</small>'}
          ${s.charts ? '<small class="muted">Groups that already started keep the case they began with.</small>' : ''}
        </label>
        <div class="sc-toggles">
          <div class="ctl"><div><b>Task 5 – Chart Audit</b><small>Unlock during class</small></div><label class="switch"><input type="checkbox" data-patch="task5Unlocked" ${s.task5Unlocked ? 'checked' : ''}><span></span></label></div>
          <div class="ctl"><div><b>Accepting submissions</b><small>Turn off after the deadline</small></div><label class="switch"><input type="checkbox" data-patch="acceptingSubmissions" ${s.acceptingSubmissions ? 'checked' : ''}><span></span></label></div>
        </div>
        <button type="button" class="btn sm block" data-act="viewSubs">View submissions ${EHR.icon('right', 'sm')}</button>
      </section>`).join('');
  }
  $('#secGrid').addEventListener('change', async e => {
    const el = e.target.closest('[data-patch]'); if (!el) return;
    const code = el.closest('[data-code]').dataset.code;
    const k = el.dataset.patch; let v = el.type === 'checkbox' ? el.checked : el.value;
    const sx = sections.find(x => x.code === code);
    if ((k === 'practiceCaseId' && v && v === sx.caseId) || (k === 'caseId' && v && v === sx.practiceCaseId)) { toast('Use different cases for practice and the graded task, otherwise students practise on the patient they will be graded on.', 'err'); renderSections(); return; }
    if (k === 'groups') {
      v = +v; clearTimeout(groupTimers[code]);
      groupTimers[code] = setTimeout(() => saveGroups(code, v, el), 450);
      return;
    }
    if (k === 'caseId' && el.dataset.started && !confirm('Some groups in ' + code + ' already started. They keep their current case; only groups signing in for the first time get the new one. Continue?')) { renderSections(); return; }
    try {
      await S('updateSection', { code, patch: { [k]: v } });
      const s = sections.find(x => x.code === code); s[k] = v;
      if (k === 'caseId') { s.caseTitle = (caseList.find(c => c.id === v) || {}).title || ''; renderSections(); }
      if (k === 'practiceCaseId') { s.practiceCaseTitle = (caseList.find(c => c.id === v) || {}).title || ''; renderSections(); }
      toast(k === 'practiceCaseId' ? (v ? `${code} students can practice on "${s.practiceCaseTitle}"` : `${code} has no practice case now`) : k === 'caseId' ? (v ? `${code} will chart "${s.caseTitle}" for the graded task` : `${code} has no graded case now`) : k === 'task5Unlocked' ? (v ? `Task 5 unlocked for ${code}` : `Task 5 locked for ${code}`) : (v ? `${code} is accepting submissions` : `Submissions closed for ${code}`), 'ok');
    } catch (err) { toast(err.message, 'err'); loadSections(); }
  });
  $('#secGrid').addEventListener('click', async e => {
    const st = e.target.closest('[data-step]');
    if (st) {
      const inp = st.parentElement.querySelector('input');
      const v = Math.min(50, Math.max(1, (+inp.value || 0) + +st.dataset.step));
      if (String(v) !== inp.value) { inp.value = v; inp.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const code = b.closest('[data-code]').dataset.code; const s = sections.find(x => x.code === code);
    if (b.dataset.act === 'viewSubs') { filter.section = code; go('subs'); }
    if (b.dataset.act === 'previewPractice') { try { openPreview((await S('getCaseFull', { id: EHRCore.SAMPLE_ID })).case); } catch (err) { toast(err.message, 'err'); } }
    if (b.dataset.act === 'previewCase' && s.caseId) { try { openPreview((await S('getCaseFull', { id: s.caseId })).case); } catch (err) { toast(err.message, 'err'); } }
  });

  const groupTimers = {};
  async function saveGroups(code, v, el) {
    const s = sections.find(x => x.code === code);
    if (v === s.groups) return;
    try {
      await S('updateSection', { code, patch: { groups: v } });
      s.groups = v; toast(`${code} now has ${v} group${v === 1 ? '' : 's'}`, 'ok'); renderSections();
    } catch (err) { toast(err.message, 'err'); el.value = s.groups || ''; }
  }

  /* =================== PATIENT CASES =================== */
  async function loadCases() {
    $('#caseGrid').innerHTML = '<p class="muted">Loading…</p>';
    try { caseList = await S('listCases'); renderCases(); } catch (e) { toast(e.message, 'err'); }
  }
  function renderCases() {
    const mine = caseList.filter(c => !c.builtin), sample = caseList.filter(c => c.builtin);
    const card = c => `<article class="case-card ${c.builtin ? 'builtin' : ''}" data-id="${esc(c.id)}">
        <div class="cc-top">${c.builtin ? '<span class="pill blue">Built-in sample</span>' : '<span class="pill grey">My case</span>'}${c.usedBy.length ? `<span class="pill green">In use: ${c.usedBy.map(esc).join(', ')}</span>` : ''}</div>
        <h3>${esc(c.title)}</h3>
        <p class="cc-pt"><b>${esc(c.patient)}</b><br><span class="muted">${esc(c.dx || 'No diagnosis yet')}</span></p>
        <p class="cc-meta">${c.cards} data cards${c.updatedAt ? ' · edited ' + ago(c.updatedAt) : ''}${me.role === 'admin' && c.owner && c.owner !== me.id ? ' · owner ' + esc(c.owner) : ''}</p>
        <div class="cc-actions">
          ${c.builtin ? '' : '<button class="btn sm primary" data-act="edit">Edit</button>'}
          <button class="btn sm" data-act="preview">Preview</button>
          <button class="btn sm" data-act="dup">Duplicate</button>
          ${c.builtin ? '' : '<button class="btn sm danger" data-act="del">Delete</button>'}
        </div></article>`;
    $('#caseGrid').innerHTML = `
      <h3 class="grid-title">My cases <span class="muted">(${mine.length})</span></h3>
      ${mine.length ? `<div class="cards-grid">${mine.map(card).join('')}</div>` : '<section class="card empty">You have no cases yet. Click <b>New from sample</b> to copy the built-in case and change the patient and problems, or start from a <b>blank case</b>.</section>'}
      <h3 class="grid-title">Built-in</h3><div class="cards-grid">${sample.map(card).join('')}</div>`;
  }
  $('#newFromSample').addEventListener('click', () => newCase(EHRCore.SAMPLE_ID));
  $('#newBlank').addEventListener('click', () => newCase('blank'));
  async function newCase(src) {
    try { const r = await S('duplicateCase', { id: src }); toast('Case created — now make it your own', 'ok'); go('case', r.id); }
    catch (e) { toast(e.message, 'err'); }
  }
  $('#caseGrid').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('[data-id]').dataset.id; const c = caseList.find(x => x.id === id);
    try {
      if (b.dataset.act === 'edit') go('case', id);
      if (b.dataset.act === 'preview') openPreview((await S('getCaseFull', { id })).case);
      if (b.dataset.act === 'dup') { const r = await S('duplicateCase', { id }); toast('Copy created', 'ok'); go('case', r.id); }
      if (b.dataset.act === 'del') { if (!confirm(`Delete "${c.title}"? This cannot be undone.`)) return; await S('deleteCase', { id }); toast('Case deleted'); loadCases(); }
    } catch (err) { toast(err.message, 'err'); }
  });

  async function openEditor(id) {
    VIEWS.forEach(x => { $('#view-' + x).hidden = x !== 'editor'; }); view = 'editor';
    $('#reviewView').hidden = true; $('#backBtn').hidden = true;
    document.querySelectorAll('#mainNav [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === 'cases'));
    const host = $('#view-editor'); host.innerHTML = '<p class="muted" style="padding:24px">Loading case…</p>';
    let c, list;
    try { [c, list] = await Promise.all([S('getCaseFull', { id }).then(r => r.case), S('listCases')]); }
    catch (e) { toast(e.message, 'err'); go('cases'); return; }
    if (c.builtin) { toast('The built-in sample is read-only — duplicate it to edit.', 'info'); go('cases'); return; }
    $('#crumbs').innerHTML = `Patient Cases <span class="sep">›</span> <b>${esc(c.title)}</b>`;
    CaseEditor.open(host, c, {
      usedBy: (list.find(x => x.id === id) || {}).usedBy || [],
      toast,
      onSave: async cs => { const r = await S('saveCase', { case: cs }); $('#crumbs').innerHTML = `Patient Cases <span class="sep">›</span> <b>${esc(cs.title)}</b>`; return r; },
      onPreview: cs => openPreview(cs),
      onClose: () => { editorDirty = false; go('cases'); },
      onDirty: d => { editorDirty = d; }
    });
  }

  /* ---------- preview a case as a student would see it ---------- */
  function openPreview(cs) {
    applyCase(cs);
    $('#pvTitle').textContent = cs.title || 'Untitled case';
    $('#pvBanner').innerHTML = bannerHtml(C.patient, C.patient.code ? `<span class="flag-chip">${esc(C.patient.code)}</span>` : '');
    const el = $('#pvEhr'); const fresh = el.cloneNode(false); fresh.innerHTML = '<nav class="ehr-nav"></nav><main class="ehr-main"></main>'; el.replaceWith(fresh);
    const d = EHR.blankData(); d.group.members[0].name = 'Preview Student';
    EHR.create(fresh, { data: d, task5Unlocked: true, user: 'Preview Student', tab: 'summary', onChange: () => {}, onAction: (a, arg) => { if (a === 'bpa') toast('Alert: ' + arg.title, 'info'); } });
    $('#preview').hidden = false;
  }
  $('#pvClose').addEventListener('click', () => { $('#preview').hidden = true; if (currentCase && current) applyCase(currentCase); });

  /* =================== ADMIN =================== */
  let adm = { instructors: [], sections: [] };
  async function loadAdmin() {
    try { adm = await S('adminData'); renderAdmin(); } catch (e) { toast(e.message, 'err'); }
  }
  function renderAdmin() {
    const name = id => (adm.instructors.find(u => u.id === id) || {}).name || id;
    $('#instCount').textContent = adm.instructors.length + ' accounts';
    $('#secCount').textContent = adm.sections.length + ' sections';
    $('#instRows').innerHTML = adm.instructors.sort((a, b) => a.name.localeCompare(b.name)).map(u => `<tr data-u="${esc(u.id)}">
      <td><b>${esc(u.name)}</b>${u.id === me.id ? ' <span class="pill blue">You</span>' : ''}</td><td><code>${esc(u.id)}</code></td>
      <td>${u.role === 'admin' ? '<span class="pill amber">Admin</span>' : 'Instructor'}</td>
      <td>${u.sections.length ? u.sections.map(s => `<span class="tag">${esc(s)}</span>`).join(' ') : '<span class="muted">—</span>'}</td>
      <td>${u.active ? '<span class="pill green">Active</span>' : '<span class="pill grey">Disabled</span>'}</td>
      <td class="row-actions"><button class="btn sm" data-a="editU">Edit</button><button class="btn sm" data-a="pwU">Reset password</button>${u.id === me.id ? '' : `<button class="btn sm" data-a="toggleU">${u.active ? 'Disable' : 'Enable'}</button><button class="btn sm danger" data-a="delU">Delete</button>`}</td></tr>`).join('');
    $('#secRows').innerHTML = adm.sections.length ? adm.sections.sort((a, b) => a.code.localeCompare(b.code)).map(s => `<tr data-s="${esc(s.code)}">
      <td><b>${esc(s.code)}</b></td><td>${esc(name(s.instructor))}</td><td>${s.groups || '<span class="warn-txt">Not set</span>'}</td>
      <td>${s.caseTitle ? esc(s.caseTitle) : '<span class="warn-txt">Not assigned</span>'}${s.practiceCaseTitle ? `<br><small class="muted">Practice: ${esc(s.practiceCaseTitle)}</small>` : ''}</td><td>${s.charts}</td>
      <td class="row-actions"><button class="btn sm" data-a="editS">Edit</button><button class="btn sm danger" data-a="delS" ${s.charts ? 'disabled title="Has student charts"' : ''}>Delete</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No sections yet. Add one and choose its instructor.</td></tr>';
  }
  const instOpts = () => adm.instructors.filter(u => u.active).map(u => ({ v: u.id, l: `${u.name} (${u.id})` }));
  function tempPw() { const w = ['nurse', 'chart', 'vital', 'ward', 'care', 'pulse']; return w[Math.floor(Math.random() * w.length)] + '-' + Math.floor(1000 + Math.random() * 9000); }
  $('#addInst').addEventListener('click', () => formModal({
    title: 'Add instructor', submit: 'Create account',
    fields: [{ name: 'name', label: 'Full name', placeholder: 'Prof. Ana Santos' }, { name: 'username', label: 'Username', placeholder: 'asantos', hint: 'Lowercase letters, numbers, dots or dashes.' },
      { name: 'role', label: 'Role', type: 'select', value: 'instructor', options: [{ v: 'instructor', l: 'Instructor' }, { v: 'admin', l: 'Administrator' }] },
      { name: 'password', label: 'Temporary password', type: 'text', hint: 'Give this to the instructor. They must change it the first time they sign in.', value: tempPw() }],
    onSubmit: async v => { await S('saveInstructor', Object.assign(v, { isNew: true, active: true })); toast('Account created for ' + v.name, 'ok'); loadAdmin(); }
  }));
  $('#addSec').addEventListener('click', () => {
    if (!adm.instructors.some(u => u.active)) { toast('Create an instructor account first.', 'err'); return; }
    formModal({
      title: 'Add section', submit: 'Create section',
      fields: [{ name: 'code', label: 'Section code', placeholder: 'BSN3A', hint: 'Students pick this from a list when they sign in.' },
        { name: 'instructor', label: 'Instructor', type: 'select', options: instOpts(), hint: 'The instructor sets the number of groups and the patient case under My Sections.' }],
      onSubmit: async v => { await S('saveSection', Object.assign(v, { isNew: true })); toast('Section ' + v.code.toUpperCase() + ' created. Its instructor now sets the number of groups.', 'ok'); loadAdmin(); }
    });
  });
  $('#instRows').addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const u = adm.instructors.find(x => x.id === b.closest('[data-u]').dataset.u);
    try {
      if (b.dataset.a === 'editU') formModal({ title: 'Edit ' + u.name, fields: [{ name: 'username', label: 'Username', value: u.id, ro: true }, { name: 'name', label: 'Full name', value: u.name },
        { name: 'role', label: 'Role', type: 'select', value: u.role, options: [{ v: 'instructor', l: 'Instructor' }, { v: 'admin', l: 'Administrator' }] }],
        onSubmit: async v => { await S('saveInstructor', v); toast('Saved', 'ok'); loadAdmin(); } });
      if (b.dataset.a === 'pwU') formModal({ title: 'Reset password – ' + u.name, submit: 'Reset password', fields: [{ name: 'username', label: 'Username', value: u.id, ro: true }, { name: 'password', label: 'New temporary password', value: tempPw(), hint: 'They will be asked to change it at next sign-in.' }],
        onSubmit: async v => { await S('saveInstructor', v); toast('Password reset. Give the new temporary password to ' + u.name + '.', 'ok'); } });
      if (b.dataset.a === 'toggleU') { await S('saveInstructor', { username: u.id, active: !u.active }); toast(u.active ? 'Account disabled' : 'Account enabled', 'ok'); loadAdmin(); }
      if (b.dataset.a === 'delU') { if (!confirm(`Delete ${u.name}'s account? This cannot be undone.`)) return; await S('deleteInstructor', { username: u.id }); toast('Account deleted'); loadAdmin(); }
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#secRows').addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const s = adm.sections.find(x => x.code === b.closest('[data-s]').dataset.s);
    try {
      if (b.dataset.a === 'editS') formModal({ title: 'Edit section ' + s.code, fields: [{ name: 'code', label: 'Section code', value: s.code, ro: true },
        { name: 'instructor', label: 'Instructor', type: 'select', value: s.instructor, options: instOpts() }],
        onSubmit: async v => { await S('saveSection', v); toast('Section updated', 'ok'); loadAdmin(); } });
      if (b.dataset.a === 'delS') { if (!confirm(`Delete section ${s.code}?`)) return; await S('deleteSection', { code: s.code }); toast('Section deleted'); loadAdmin(); }
    } catch (err) { toast(err.message, 'err'); }
  });

  /* =================== REVIEW & GRADING =================== */
  async function openReview(id) {
    gradeDirty = false;
    let res;
    try { res = await S('get', { id }); } catch (e) { toast(e.message, 'err'); go('subs'); return; }
    const rec = res.record;
    if (!order.includes(rec.id)) { try { const r = await S('list'); records = r.records; order = records.filter(x => x.section === rec.section).sort((a, b) => +a.group - +b.group).map(x => x.id); } catch (e) {} }
    current = rec; currentCase = res.case;
    applyCase(res.case || {});
    VIEWS.forEach(x => { $('#view-' + x).hidden = true; }); view = 'review';
    $('#reviewView').hidden = false; $('#backBtn').hidden = false;
    document.querySelectorAll('#mainNav [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === 'subs'));
    $('#crumbs').innerHTML = `<b>${esc(rec.id)}</b> <span class="sep">·</span> ${esc(C.caseTitle || '')}`;
    $('#rBanner').innerHTML = bannerHtml(C.patient, statusPill(rec.status));
    const ehrEl = $('#rEhr');
    const fresh = ehrEl.cloneNode(false); fresh.innerHTML = '<nav class="ehr-nav"></nav><main class="ehr-main"></main>'; ehrEl.replaceWith(fresh);
    viewer = EHR.create(fresh, { data: rec.data || EHR.blankData(), readOnly: true, task5Unlocked: true, grades: rec.grades, tab: (viewer && viewer.tab) || 'summary' });
    renderGrade();
  }
  $('#backBtn').addEventListener('click', () => go('subs'));

  function metrics(d) {
    const pr = EHR.progress(d);
    const lintN = viewer.validate().filter(x => x.level === 'warn').length;
    return [
      ['cards', 'Cards sorted', `${pr.cards.done}/${pr.cards.of}`], ['flowsheet', 'Flowsheet rows', `${pr.flowsheet.done}/${pr.flowsheet.of}`],
      ['note', 'Note words', EHR.wordCount(d.note.text)], ['dx', 'Diagnoses', d.dx.filter(x => x.p.trim()).length],
      ['careplan', 'Interventions', d.plans.reduce((a, p) => a + p.ints.filter(x => x.text.trim()).length, 0)],
      ['impl', 'Log entries', d.impl.filter(x => x.action.trim()).length], ['eval', 'Evaluations', d.evals.filter(x => x.value.trim()).length],
      ['audit', 'Audit errors', d.audit.filter(x => x.wrong.trim()).length],
      ['mar', 'MAR correct', C.mar.length ? `${C.mar.filter((m, i) => EHR.marRowState(m, (d.marSched || {})[i], (d.marNone || {})[i]).complete).length}/${C.mar.length}` : '—'],
      ['mar', 'MAR wrong clicks', (d.marLog && d.marLog.wrong) || 0], ['sign', 'Checklist', `${pr.sign.done}/${pr.sign.of}`], ['sign', 'EHR warnings', lintN]
    ];
  }

  function renderGrade() {
    const rec = current; const d = viewer.data; const g = rec.grades || { scores: {}, feedback: {}, general: '' };
    const idx = order.indexOf(rec.id);
    const members = d.group.members.filter(m => m.name.trim());
    $('#gradePanel').innerHTML = `
      <div class="gp-nav"><button type="button" class="btn sm" id="gpPrev" ${idx > 0 ? '' : 'disabled'}>‹ Prev</button><span>${idx >= 0 ? (idx + 1) + ' of ' + order.length : ''}</span><button type="button" class="btn sm" id="gpNext" ${idx >= 0 && idx < order.length - 1 ? '' : 'disabled'}>Next ›</button></div>
      <div class="gp-head"><div><small class="muted">Grading</small><h2>Group ${esc(rec.group)} <span class="muted">· ${esc(rec.section)}</span></h2></div>${statusPill(rec.status)}</div>
      ${rec.status === 'draft' ? '<div class="callout warn gp-note"><div>This group has <b>not submitted yet</b>. You are viewing their live draft; they may still be editing.</div></div>' : ''}
      <div class="gp-meta">
        <div><small>Submitted</small><b>${fmt(rec.submittedAt)}</b></div>
        <div><small>Signed by</small><b>${d.signed ? esc(d.signed.by) : '—'}</b></div>
        <div class="full"><small>Patient case</small><b>${esc(C.caseTitle || '—')}</b></div>
        <div class="full"><small>Care team</small><b>${members.map(m => `${esc(m.name)} <span class="muted">(${esc(m.role)})</span>`).join(', ') || '—'}</b></div>
        ${g.by ? `<div class="full"><small>Last graded by</small><b>${esc(g.by)} · ${fmt(g.gradedAt)}</b></div>` : ''}
      </div>
      <div class="gp-sec-title">At a glance <button class="link small" id="trailBtn">Audit trail (${d.trail.length})</button></div>
      <div class="metrics">${metrics(d).map(([t, l, v]) => `<button class="metric" data-tab="${t}"><small>${l}</small><b>${v}</b></button>`).join('')}</div>
      <form id="gradeForm">
      ${C.rubric.map(sec => `<div class="gp-sec-title">${esc(sec.group)}</div>` + sec.items.map(it => `
        <div class="rb-item">
          <div class="rb-top"><button type="button" class="link rb-label" data-tab="${it.tab}" title="Show this part of the chart">${esc(it.label)}</button>
            <div class="rb-score"><input class="f" type="number" min="0" max="${it.max}" step="0.5" name="s_${it.id}" value="${esc((g.scores || {})[it.id] ?? '')}" placeholder="–"><span>/ ${it.max}</span></div></div>
          <textarea class="f" rows="1" name="f_${it.id}" placeholder="Feedback (optional)">${esc((g.feedback || {})[it.id] || '')}</textarea>
        </div>`).join('')).join('')}
        <div class="gp-total"><span>Total</span><b id="gTotal">0</b><span>/ 100</span></div>
        <label class="blk">General comments<textarea class="f" rows="3" name="general">${esc(g.general || '')}</textarea></label>
        <label class="chk release"><input type="checkbox" name="release" ${rec.released ? 'checked' : ''}><span class="box"></span><span>Release score and feedback to the group</span></label>
        <div class="gp-actions"><button class="btn primary" type="submit" id="gSave">Save grade</button><small class="muted">Ctrl+S</small></div>
      </form>
      ${rec.practiceDone ? '' : '<div class="callout warn gp-note"><div>This group has <b>not finished the practice chart</b>, so its graded task is still locked. <button type="button" class="link" id="waiveBtn">Unlock graded task now</button></div></div>'}
      <div class="gp-more">
        ${rec.status !== 'draft' ? '<button class="btn sm" id="reopenBtn">Return for revision</button>' : ''}
        <button class="btn sm danger" id="deleteBtn">Delete chart</button>
      </div>
      <details class="key" open><summary>Answer key for this case (only you see this)</summary><div>${keyHtml(currentCase)}</div></details>`;
    const form = $('#gradeForm');
    const calc = () => { let t = 0; C.rubric.forEach(s => s.items.forEach(it => { const v = parseFloat(form['s_' + it.id].value); if (!isNaN(v)) t += Math.min(Math.max(v, 0), it.max); })); t = Math.round(t * 10) / 10; $('#gTotal').textContent = t; return t; };
    function setDirty(v) { gradeDirty = v; const b = $('#gSave'); b.innerHTML = v || !rec.grades ? 'Save grade' : EHR.icon('check', 'sm') + ' Saved'; b.classList.toggle('clean', !v && !!rec.grades); }
    calc(); setDirty(false);
    form.addEventListener('input', e => {
      if (e.target.type === 'number') { const max = +e.target.max; if (+e.target.value > max) e.target.value = max; if (+e.target.value < 0) e.target.value = 0; }
      if (e.target.tagName === 'TEXTAREA') autoGrow(e.target);
      calc(); setDirty(true);
    });
    form.addEventListener('change', e => { if (e.target.name === 'release') setDirty(true); });
    form.querySelectorAll('textarea').forEach(autoGrow);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const scores = {}, feedback = {};
      C.rubric.forEach(s => s.items.forEach(it => { scores[it.id] = form['s_' + it.id].value; feedback[it.id] = form['f_' + it.id].value.trim(); }));
      const grades = { scores, feedback, general: form.general.value.trim(), total: calc() };
      const btn = $('#gSave'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await S('grade', { id: rec.id, grades, release: form.release.checked });
        rec.grades = Object.assign(grades, { by: me.name, gradedAt: Date.now() }); rec.released = form.release.checked; if (rec.status === 'submitted') rec.status = 'graded';
        setDirty(false);
        toast(form.release.checked ? 'Grade saved and released to the group' : 'Grade saved (not yet released)', 'ok');
      } catch (err) { toast(err.message, 'err'); }
      finally { btn.disabled = false; setDirty(gradeDirty); }
    });
    const wb = $('#waiveBtn');
    if (wb) wb.addEventListener('click', async () => {
      if (!confirm('Unlock the graded task for this group without finishing practice?')) return;
      try { await S('waivePractice', { id: rec.id }); rec.practiceDone = true; rec.practiceWaivedBy = me.name; toast('Graded task unlocked for ' + rec.id, 'ok'); renderGrade(); } catch (e) { toast(e.message, 'err'); }
    });
    $('#gpPrev').addEventListener('click', () => go('review', order[idx - 1]));
    $('#gpNext').addEventListener('click', () => go('review', order[idx + 1]));
    $('#gradePanel').querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => viewer.go(b.dataset.tab)));
    $('#trailBtn').addEventListener('click', () => showTrail(d));
    const ro = $('#reopenBtn');
    if (ro) ro.addEventListener('click', async () => {
      if (!confirm('Return this chart to the group for revision? They will be able to edit and sign it again.')) return;
      try { await S('setStatus', { id: rec.id, status: 'draft' }); rec.status = 'draft'; toast('Chart returned for revision', 'ok'); renderGrade(); } catch (e) { toast(e.message, 'err'); }
    });
    $('#deleteBtn').addEventListener('click', async () => {
      if (prompt(`This permanently deletes ${rec.id} and cannot be undone. Type the chart ID to confirm:`) !== rec.id) return;
      try { await S('remove', { id: rec.id }); toast('Chart deleted'); gradeDirty = false; go('subs'); } catch (e) { toast(e.message, 'err'); }
    });
  }
  function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 220) + 'px'; }
  function keyHtml(cs) {
    const k = (cs && cs.key) || {};
    const audit = (k.audit || []).filter(a => a.error || a.loc), notes = (k.notes || []).filter(Boolean);
    if (!audit.length && !notes.length) return `<p class="muted small">No answer key yet for this case.${cs && !cs.builtin ? ' Add one in <b>Patient Cases</b>: open the case, then <b>Answer key</b>.' : ' Duplicate the sample into your own case to write one.'}</p>`;
    return `${audit.length ? `<h4>Task 5 – expected audit findings</h4><ol class="key-list">${audit.map(a => `<li><b>${esc(a.loc)}</b> — ${esc(a.error)} ${a.type ? `<span class="tag">${esc(a.type)}</span>` : ''}${a.harm || a.fix ? `<br><small>${a.harm ? '<i>Harm:</i> ' + esc(a.harm) + '<br>' : ''}${a.fix ? '<i>Fix:</i> ' + esc(a.fix) : ''}</small>` : ''}</li>`).join('')}</ol>` : ''}
      ${notes.length ? `<h4>Grading notes for Tasks 1–4</h4><ul class="key-list">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  }
  function showTrail(d) {
    const tabLabel = id => (EHR.TABS.find(t => t.id === id) || {}).label || id;
    $('#trailRows').innerHTML = d.trail.length ? d.trail.slice().reverse().map(t => `<tr><td>${new Date(t.t).toLocaleString()}</td><td>${esc(t.u)}</td><td>${esc(tabLabel(t.tab))}</td><td><code>${esc(t.f)}</code></td></tr>`).join('') : '<tr><td colspan="4" class="empty">No entries.</td></tr>';
    $('#trailModal').hidden = false;
  }
  $('#trailModal').addEventListener('click', e => { if (e.target.matches('[data-close]') || e.target.id === 'trailModal') $('#trailModal').hidden = true; });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#preview').hidden) { $('#pvClose').click(); return; }
    if ($('#reviewView').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); const f = $('#gradeForm'); if (f) f.requestSubmit(); }
    else if (e.key === 'Escape' && $('#trailModal').hidden && $('#formModal').hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) go('subs');
  });

  /* ---------- boot ---------- */
  (async function boot() {
    if (API.token.get()) {
      try { const r = await API.staff('me'); start(r.user, r.mustChange); return; }
      catch (e) { API.token.set(''); if (!sessionStorage.getItem('ncm110_fac_notice')) sessionStorage.setItem('ncm110_fac_notice', 'Your session expired. Please sign in again.'); }
    }
    showLogin();
  })();
})();
