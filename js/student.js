/* Student app: sign-in, autosave, signing, lock screen. */
(function () {
  const C = window.CASE, CFG = window.EHR_CONFIG, $ = s => document.querySelector(s);
  const SESSION_KEY = 'ncm110_ehr_session';
  const IDLE_MIN = 15;

  let session = null;   // {section, group, pin}
  let record = null;    // server record meta
  let ehr = null;
  let me = null;         // { name, role } of the student using THIS device
  let mode = 'task';     // 'task' = graded chart (shared, synced) · 'practice' = practice chart (this device only)
  let practiceCase = null;
  let practiceDone = true;   // false until the group finishes (signs) the practice chart
  const PRACTICE_MIN = (window.EHRCore && EHRCore.PRACTICE_MIN) || 60;

  /* ---------- toasts ---------- */
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    $('#toasts').appendChild(t); requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 3800);
  }
  window.toast = toast;

  /* ---------- banner ---------- */
  function renderBanner() {
    const p = C.patient;
    $('#banner').innerHTML = `
      <div class="pt-photo"><span>${esc(p.initials)}</span></div>
      <div class="pt-main"><div class="pt-name">${esc(p.name)} ${p.nickname ? `<span class="nick">"${esc(p.nickname)}"</span>` : ''}</div>
        <div class="pt-ids"><span>${esc(p.sex)}${p.age ? ', ' + esc(p.age) : ''}</span><span>DOB <b>${esc(p.dob)}</b></span><span>Hosp No. <b>${esc(p.hospNo)}</b></span></div></div>
      <div class="pt-cols">
        <div><small>Location</small><b>${esc(p.location)}</b></div>
        <div><small>Attending</small><b>${esc(p.attending)}</b></div>
        <div class="wide"><small>Admitting Dx</small><b>${esc(p.dx)}</b></div>
        ${p.weight || p.height ? `<div><small>Wt / Ht</small><b>${esc(p.weight)} / ${esc(p.height)}</b></div>` : ''}
      </div>
      <div class="pt-flags">
        ${/^\s*(nkda|none)?\s*$/i.test(p.allergy) ? '<span class="flag-chip">NKDA</span>' : `<span class="flag-allergy" title="Allergy">${EHR.icon('warn', 'sm')} ALLERGY: ${esc(p.allergy)}</span>`}
        ${p.code ? `<span class="flag-chip">${esc(p.code)}</span>` : ''}
        ${p.isolation ? `<span class="flag-chip iso-chip">${esc(p.isolation)}</span>` : ''}
        ${/high/i.test(p.fallRisk) ? '<span class="flag-chip fall">Fall risk</span>' : ''}
      </div>`;
    const last = p.name.split(',')[0] || p.name;
    $('#tabChart').innerHTML = `${esc(last)}${p.bed ? ` <small>Bed ${esc(p.bed)}</small>` : ''}`;
    $('#unitTitle') && ($('#unitTitle').textContent = p.ward || 'Unit');
  }

  /* ---------- clock ---------- */
  function tick() {
    const d = new Date();
    $('#cenTime').textContent = 'Day 1 · ' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + ' H';
  }

  /* ---------- sync status ---------- */
  function setSync(state, text) {
    const el = $('#syncStatus'); el.className = 'sync ' + state; el.querySelector('span').textContent = text;
    $('#sbSaved').textContent = text;
  }
  function backupKey() { return 'ncm110_backup_' + API.idOf(session.section, session.group); }
  const hhmm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const getP = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setP = (o, p, v) => { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = v; };
  const clone = x => x === undefined ? null : JSON.parse(JSON.stringify(x));

  /* ---------- live group sync ----------
     Each device sends only the fields it changed and pulls everyone else's
     changes every few seconds, so groupmates see each other's work live. */
  let version = 0, pending = new Set(), trailSent = 0, needBaseline = false;
  let syncing = false, lastSync = 0, lastEdit = 0, online = [], legacy = false;
  let caseLoadedVer = 0, reloading = false;   // when the case shown on this device was last edited
  function onChange(data, paths) {
    (paths || []).forEach(p => pending.add(p));
    lastEdit = Date.now();
    if (record.status === 'draft' && (pending.size || data.trail.length > trailSent)) setSync('pending', 'Saving…');
    try { localStorage.setItem(backupKey(), JSON.stringify({ at: Date.now(), version, pending: [...pending], data })); } catch (e) {}
  }
  function buildPatches() {
    const keys = [...pending].sort((a, b) => a.length - b.length);
    return keys.filter(k => !keys.some(o => o !== k && k.startsWith(o + '.'))).map(k => ({ p: k, v: clone(getP(ehr.data, k)) }));
  }
  function taskProgress(d) { const pr = EHR.progress(d); const o = {}; Object.keys(pr).forEach(k => { o[k] = Math.round(Math.min(pr[k].done / pr[k].of, 1) * 100); }); return o; }
  async function sync(force) {
    if (!ehr || !record || syncing || mode === 'practice') return;   // practice charts never touch the server
    const draft = record.status === 'draft';
    const patches = draft ? (needBaseline ? [{ p: '', v: clone(ehr.data) }] : buildPatches()) : [];
    const trailCount = ehr.data.trail.length;
    const trail = draft ? ehr.data.trail.slice(trailSent) : [];
    const writing = patches.length || trail.length;
    if (!force && !writing && Date.now() - lastSync < pollEvery()) return;
    const sentKeys = needBaseline ? [...pending] : [...pending];
    const sentVals = new Map(sentKeys.map(k => [k, JSON.stringify(getP(ehr.data, k))]));
    syncing = true; if (writing) setSync('saving', 'Saving…');
    try {
      if (legacy) {
        // older Apps Script without live sync: save the whole chart like before (no live merging)
        if (writing && draft) { await API.save(Object.assign({}, session, { data: ehr.data, progress: EHR.overall(ehr.data) })); pending.clear(); trailSent = trailCount; }
        lastSync = Date.now(); setSync(draft ? 'ok' : 'ok', draft ? 'Saved ' + hhmm(lastSync) : 'Submitted');
        return;
      }
      const r = await API.sync(Object.assign({}, session, { version, patches, trail, me, tab: ehr.tab, progress: EHR.overall(ehr.data), taskProgress: taskProgress(ehr.data) }));
      needBaseline = false;
      sentKeys.forEach(k => { if (JSON.stringify(getP(ehr.data, k)) === sentVals.get(k)) pending.delete(k); });
      if (r.data && r.version !== version) mergeRemote(r.data, ehr.data.trail.slice(trailCount));
      else trailSent = trailCount;
      version = r.version;
      showPresence(r.presence || []);
      if (r.caseVer && r.caseVer > caseLoadedVer) $('#caseUpd').hidden = false;
      if (r.status && r.status !== record.status) {
        const wasDraft = record.status === 'draft';
        record.status = r.status;
        if (r.grades) { record.grades = r.grades; ehr.setGrades(r.grades); }
        if (wasDraft && r.status !== 'draft') {
          record.submittedAt = (r.data && r.data.signed && r.data.signed.at) || Date.now();
          pending.clear(); ehr.setReadOnly(true, roNote());
          toast((r.data && r.data.signed ? r.data.signed.by : 'A groupmate') + ' signed and submitted the chart.', 'info');
        } else if (r.status === 'draft') { ehr.setReadOnly(false, ''); toast('Your instructor returned the chart for revision.', 'info'); }
      } else if (r.grades) { record.grades = r.grades; ehr.setGrades(r.grades); }
      lastSync = Date.now();
      if (record.status !== 'draft') setSync('ok', record.status === 'graded' ? 'Graded' : 'Submitted');
      else setSync(pending.size ? 'pending' : 'ok', pending.size ? 'Saving…' : 'Saved ' + hhmm(lastSync));
      try { localStorage.setItem(backupKey(), JSON.stringify({ at: Date.now(), version, pending: [...pending], data: ehr.data })); } catch (e) {}
    } catch (e) {
      if (/Unknown action/i.test(e.message) && !legacy) { legacy = true; console.warn('Backend has no live sync yet – using whole-chart saves. Update Code.gs and Core.gs in Apps Script.'); syncing = false; return sync(true); }
      setSync('err', /expired/i.test(e.message) ? 'Signed out' : 'Offline – will retry');
      if (/Session expired/i.test(e.message)) { sessionStorage.removeItem(SESSION_KEY); toast('Your group PIN changed or the chart was reset. Please sign in again.', 'err'); }
    } finally { syncing = false; }
  }
  // put a groupmate's version on screen, keeping this device's not-yet-saved edits on top
  function mergeRemote(serverData, localNewTrail) {
    const merged = clone(serverData);
    [...pending].sort((a, b) => a.length - b.length).forEach(k => setP(merged, k, clone(getP(ehr.data, k))));
    merged.trail = (Array.isArray(merged.trail) ? merged.trail : []).concat(localNewTrail);
    trailSent = (serverData.trail || []).length;
    ehr.applyRemote(merged);
    refreshMe();
  }
  const pollEvery = () => document.visibilityState === 'hidden' ? 45000 : record && record.status !== 'draft' ? 30000 : online.length > 1 ? 5000 : 12000;
  function syncLoop() {
    if (!ehr) return;
    const dirty = pending.size || ehr.data.trail.length > trailSent;
    if (dirty) {
      // save ~1 s after typing pauses, or at least every 6 s while someone keeps typing
      if (Date.now() - lastEdit > 900 || Date.now() - lastSync > 6000) sync();
      return;
    }
    sync();   // nothing to save: pull groupmates' changes when due
  }
  const flush = () => sync(true);

  /* ---------- the instructor edited the patient case ---------- */
  $('#caseUpdBtn').addEventListener('click', async () => {
    $('#caseUpdBtn').disabled = true; $('#caseUpdBtn').textContent = 'Saving your work…';
    // wait until this device's edits are saved (a save may already be in progress)
    for (let i = 0; i < 20 && (syncing || pending.size || ehr.data.trail.length > trailSent); i++) { try { await sync(true); } catch (e) {} await new Promise(r => setTimeout(r, 250)); }
    reloading = true; location.reload();
  });
  $('#caseUpdLater').addEventListener('click', () => { $('#caseUpd').hidden = true; caseLoadedVer = Date.now(); });

  /* ---------- who is online in this group ---------- */
  const TAB_NAME = id => ((EHR.TABS.find(t => t.id === id) || {}).label || '');
  function showPresence(list) {
    online = list;
    const others = list.filter(p => !me || p.name.toLowerCase() !== me.name.toLowerCase());
    $('#presence').innerHTML = others.slice(0, 5).map(p => `<span class="pres" title="${esc(p.name)}${p.role ? ' · ' + esc(p.role) : ''}${p.tab ? ' — on ' + esc(TAB_NAME(p.tab)) : ''}"><span class="avatar sm">${esc(initials(p.name))}</span><i></i></span>`).join('') +
      (others.length > 5 ? `<span class="pres more">+${others.length - 5}</span>` : '') +
      (others.length ? `<span class="pres-lbl">${others.length} groupmate${others.length === 1 ? '' : 's'} online</span>` : '');
  }
  const initials = n => String(n || '?').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();

  /* ---------- login ---------- */
  let sections = [];
  async function init() {
    if (API.DEMO) $('#demoNote').hidden = false;
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) { try { await doLogin(JSON.parse(saved), true); return; } catch (e) { sessionStorage.removeItem(SESSION_KEY); } }
    $('#login').hidden = false;
    loadSections();
  }
  async function loadSections() {
    const f = $('#loginForm');
    try { sections = await API.getSections(); }
    catch (e) { $('#loginErr').textContent = 'Cannot reach the EHR server. Check your internet connection.'; return; }
    const last = localStorage.getItem('ncm110_last_section') || '';
    f.section.innerHTML = sections.length
      ? '<option value="">Choose your section…</option>' + sections.map(s => `<option ${s.code === last ? 'selected' : ''}>${esc(s.code)}</option>`).join('')
      : '<option value="">No sections are open yet</option>';
    fillGroups();
  }
  function fillGroups() {
    const f = $('#loginForm'); const s = sections.find(x => x.code === f.section.value);
    const lastG = localStorage.getItem('ncm110_last_group') || '';
    f.group.disabled = !s;
    f.group.innerHTML = s ? '<option value="">Choose…</option>' + Array.from({ length: s.groups }, (_, i) => `<option value="${i + 1}" ${String(i + 1) === lastG ? 'selected' : ''}>Group ${i + 1}</option>`).join('') : '<option value="">—</option>';
  }
  $('#loginForm').section.addEventListener('change', e => { localStorage.setItem('ncm110_last_section', e.target.value); fillGroups(); $('#createBox').hidden = true; $('#loginErr').textContent = ''; });
  $('#loginForm').group.addEventListener('change', e => { localStorage.setItem('ncm110_last_group', e.target.value); $('#createBox').hidden = true; $('#loginErr').textContent = ''; });
  $('#loginForm').pin.addEventListener('input', () => { $('#loginErr').textContent = ''; });
  $('#pinToggle').addEventListener('click', () => {
    const p = $('#loginForm').pin, show = p.type === 'password';
    p.type = show ? 'text' : 'password'; $('#pinToggle').textContent = show ? 'Hide' : 'Show';
    $('#pinToggle').setAttribute('aria-pressed', show); $('#pinToggle').setAttribute('aria-label', show ? 'Hide PIN' : 'Show PIN'); p.focus();
  });

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const s = { section: f.get('section'), group: f.get('group'), pin: f.get('pin').trim() };
    if (!s.section || !s.group) { $('#loginErr').textContent = 'Choose your section and group.'; return; }
    if (!/^\d{4,6}$/.test(s.pin)) { $('#loginErr').textContent = 'PIN must be 4–6 digits.'; return; }
    $('#loginBtn').disabled = true; $('#loginBtn').textContent = 'Signing in…'; $('#loginErr').textContent = ''; $('#createBox').hidden = true;
    try { await doLogin(s, false); }
    catch (err) {
      $('#loginErr').textContent = /wrong group pin/i.test(err.message)
        ? err.message + ' Check with your groupmates. If nobody remembers it, ask your instructor to reset your group\'s chart.'
        : err.message;
      $('#loginForm').pin.select();
    }
    finally { $('#loginBtn').disabled = false; $('#loginBtn').textContent = 'Sign in'; }
  });

  // A chart that doesn't exist yet must be confirmed — catches typos in section/group
  let pendingCreate = null;
  $('#createYes').addEventListener('click', async () => {
    const s = pendingCreate; if (!s) return;
    $('#createYes').disabled = true;
    try { await doLogin(Object.assign({}, s, { create: true }), false); }
    catch (err) { $('#loginErr').textContent = err.message; $('#createBox').hidden = true; }
    finally { $('#createYes').disabled = false; }
  });
  $('#createNo').addEventListener('click', () => { $('#createBox').hidden = true; pendingCreate = null; $('#loginForm').section.focus(); });

  function roNote() {
    const at = record.submittedAt ? new Date(record.submittedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `<b>Signed and submitted${at ? ' ' + at : ''}.</b> This chart is now read-only. ${record.status === 'graded' && record.grades ? 'Your results are in the <a href="#results" data-goto="results">Results</a> tab.' : 'Your instructor will review it.'}`;
  }

  async function doLogin(s, silent) {
    const res = await API.login(s);
    if (res.notFound) {
      pendingCreate = s;
      $('#createId').textContent = res.id;
      $('#createBox').hidden = false;
      return;
    }
    session = { section: res.record.section, group: res.record.group, pin: s.pin };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    record = res.record;
    practiceCase = res.practiceCase || null;
    practiceDone = !practiceCase || res.practiceDone !== false;
    let chosen = practiceCase ? sessionStorage.getItem(modeKey()) : 'task';
    if (chosen === 'task' && !practiceDone) chosen = 'practice';   // graded task is locked until practice is finished
    if (!chosen) { showModeChooser(res, silent); return; }
    if (chosen === 'practice') { startPractice(); return; }
    enterTask(res, silent);
  }
  const modeKey = () => 'ncm110_mode_' + record.id;
  function showModeChooser(res, silent) {
    const t = res.case, p = practiceCase;
    $('#modeCards').innerHTML = `
      <button type="button" class="mode-card practice" data-mode="practice"><span class="mc-tag">Practice · not graded</span><b>${esc(p.patient.name)}${p.patient.nickname ? ' ("' + esc(p.patient.nickname) + '")' : ''}</b><small>${esc(p.patient.dx)}</small><span class="mc-note">Explore every screen and try each task. Saved only on this device; your instructor does not see it.</span></button>
      <button type="button" class="mode-card task ${practiceDone ? '' : 'locked'}" data-mode="task" ${practiceDone ? '' : 'disabled'}><span class="mc-tag">${practiceDone ? 'Graded task' : 'Graded task · locked'}</span><b>${esc(t.patient.name)}${t.patient.nickname ? ' ("' + esc(t.patient.nickname) + '")' : ''}</b><small>${esc(t.patient.dx)}</small><span class="mc-note">${practiceDone ? 'Your group\'s real chart. Shared live with groupmates and submitted to your instructor.' : 'Unlocks after your group finishes the practice chart: complete at least ' + PRACTICE_MIN + '% of it, tick the checklist, and sign it.'}</span></button>`;
    $('#modeModal').hidden = false; $('#login').hidden = true;
    $('#modeCards').onclick = e => {
      const b = e.target.closest('[data-mode]'); if (!b || b.disabled) return;
      sessionStorage.setItem(modeKey(), b.dataset.mode);
      $('#modeModal').hidden = true;
      if (b.dataset.mode === 'practice') startPractice(); else enterTask(res, silent);
    };
  }
  function switchMode(to) {
    if (to === 'task' && !practiceDone) { toast('Finish the practice chart first: complete at least ' + PRACTICE_MIN + '% of it, tick the checklist and sign it.', 'info'); return; }
    const go = () => { sessionStorage.setItem(modeKey(), to); sessionStorage.removeItem(VK()); reloading = true; location.hash = ''; location.reload(); };
    if (mode === 'task') flush().then(go, go); else go();
  }

  /* ---------- practice chart: this device only, never graded ---------- */
  function practiceKey() { return 'ncm110_practice_' + record.id + '_' + practiceCase.id; }
  function startPractice() {
    mode = 'practice';
    applyCase(practiceCase);
    let data = null; try { data = JSON.parse(localStorage.getItem(practiceKey()) || 'null'); } catch (e) {}
    if (!data) { data = EHR.blankData(); data.group.section = session.section; data.group.groupNo = session.group; }
    $('#login').hidden = true; $('#app').hidden = false; document.body.classList.add('is-practice');
    renderBanner(); renderCensus(); tick(); setInterval(tick, 15000);
    $('#envLbl').textContent = 'PRACTICE';
    ehr = EHR.create($('#ehr'), {
      data, readOnly: false, task5Unlocked: true, tab: location.hash.slice(1) || 'summary',
      onChange: d => { try { localStorage.setItem(practiceKey(), JSON.stringify(d)); } catch (e) {} setSync('ok', 'Practice · saved on this device'); updatePracticeMeter(); },
      onAction, onTab: t => { history.replaceState(null, '', '#' + t); }
    });
    try { me = JSON.parse(localStorage.getItem(meKey()) || 'null'); } catch (e) { me = null; }
    if (me) ehr.setMe(me.name);
    $('#meName').innerHTML = me ? `<b>${esc(me.name)}</b><small>${esc(me.role)}</small>` : '<b>Practice</b>';
    $('#userAvatar').textContent = me ? initials(me.name) : 'P';
    $('#sbUser').innerHTML = 'Practice chart · ' + esc(record.id);
    $('#modeBar').innerHTML = `<svg class="ico sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5l8 4 8-4v14l-8-4z"/></svg><span><b>PRACTICE CHART</b> · ${esc(practiceCase.patient.name)} — not graded, saved only on this device. ${practiceDone ? 'Practice finished: your graded task is open.' : 'Do every task, then sign it to unlock your graded task.'}</span>${practiceDone ? '' : '<span class="pr-meter" id="prMeter"></span>'}<button type="button" class="btn sm ghost" id="practiceReset">Start over</button>${practiceDone ? '<button type="button" class="btn sm primary" id="goTask">Go to graded task</button>' : '<button type="button" class="btn sm primary" id="finishPractice">Finish practice</button>'}`;
    $('#modeBar').hidden = false;
    if ($('#goTask')) $('#goTask').onclick = () => switchMode('task');
    if ($('#finishPractice')) $('#finishPractice').onclick = () => { ehr.go('sign'); openSign(); };
    updatePracticeMeter();
    $('#practiceReset').onclick = () => { if (!confirm('Clear your practice chart and start over?')) return; try { localStorage.removeItem(practiceKey()); } catch (e) {} reloading = true; location.reload(); };
    $('#modeBtn').hidden = true;
    setSync('ok', 'Practice · not graded');
    if (sessionStorage.getItem(VK())) showChart(); else showList();
    resetIdle();
  }

  function updatePracticeMeter() {
    const m = $('#prMeter'); if (!m || !ehr) return;
    const pct = EHR.overall(ehr.data);
    m.innerHTML = `<i style="width:${pct}%"></i><b>${pct}%</b>`; m.classList.toggle('ok', pct >= PRACTICE_MIN);
    m.title = pct >= PRACTICE_MIN ? 'Enough done. Tick the checklist and sign to finish practice.' : 'Complete at least ' + PRACTICE_MIN + '% to finish practice';
  }

  function enterTask(res, silent) {
    mode = 'task';
    applyCase(res.case);   // the patient your instructor assigned to this section
    caseLoadedVer = +(res.case && res.case.updatedAt) || 0;
    let data = record.data;
    version = record.version || 0; pending = new Set(); needBaseline = !data;
    if (!data) { data = EHR.blankData(); data.group.section = session.section; data.group.groupNo = session.group; }
    trailSent = (data.trail || []).length;
    // edits made on this device that never reached the server (e.g., Wi-Fi dropped)
    try {
      const b = JSON.parse(localStorage.getItem(backupKey()) || 'null');
      if (record.status === 'draft' && b && b.data && Array.isArray(b.pending) && b.pending.length) {
        data = clone(data);
        b.pending.forEach(k => { setP(data, k, clone(getP(b.data, k))); pending.add(k); });
        if (!silent) toast('Restored unsaved work from this device.', 'info');
      }
    } catch (e) {}
    startApp(data, res.created);
  }

  function startApp(data, created) {
    $('#login').hidden = true; $('#app').hidden = false;
    renderBanner(); renderCensus(); tick(); setInterval(tick, 15000);
    $('#envLbl').textContent = API.DEMO ? 'TRAIN (demo)' : 'TRAIN';
    const cfgP = API.getConfig(session.section).catch(() => ({}));
    ehr = EHR.create($('#ehr'), {
      data, readOnly: record.status !== 'draft', roNote: record.status !== 'draft' ? roNote() : '', grades: record.grades,
      tab: location.hash.slice(1) || 'summary',
      onChange, onAction, onTab: t => { history.replaceState(null, '', '#' + t); sync(true); }
    });
    cfgP.then(c => ehr.setTask5(!!c.task5Unlocked));
    if (record.status !== 'draft') setSync('ok', record.status === 'graded' ? 'Graded' : 'Submitted');
    else setSync(pending.size ? 'pending' : 'ok', pending.size ? 'Saving…' : 'Saved');
    if (sessionStorage.getItem(VK())) showChart(); else showList();
    loadMe();
    if (practiceCase) { $('#modeBtn').hidden = false; $('#modeBtn').onclick = () => switchMode('practice'); }
    if (!me) openWho(true);   // every student says who they are before charting
    else toast('Welcome back, ' + me.name + '.', 'ok');
    sync(true);
    setInterval(syncLoop, 1000);
    setInterval(async () => { try { const c = await API.getConfig(session.section); ehr.setTask5(!!c.task5Unlocked); } catch (e) {} }, (CFG.CONFIG_POLL_SECONDS || 30) * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else sync(true); });
    window.addEventListener('beforeunload', e => { if (pending.size && !reloading) { flush(); e.preventDefault(); e.returnValue = ''; } });
    resetIdle();
  }

  /* ---------- who am I (one student per device) ---------- */
  const esc = EHR.esc;
  const meKey = () => 'ncm110_me_' + record.id;
  function loadMe() {
    try { me = JSON.parse(localStorage.getItem(meKey()) || 'null'); } catch (e) { me = null; }
    if (me && !ehr.data.group.members.some(m => m.name.trim().toLowerCase() === me.name.toLowerCase())) me = null;
    refreshMe();
  }
  function refreshMe() {
    if (me) {
      const m = ehr.data.group.members.find(x => x.name.trim().toLowerCase() === me.name.toLowerCase());
      if (m) me = { name: m.name.trim(), role: m.role };
    }
    $('#meName').innerHTML = me ? `<b>${esc(me.name)}</b><small>${esc(me.role)}</small>` : '<b>Who are you?</b>';
    $('#userAvatar').textContent = me ? initials(me.name) : '?';
    $('#sbUser').innerHTML = 'User: <b>' + esc(me ? me.name : '—') + '</b> · ' + esc(record.id);
    ehr.setMe(me ? me.name : '');
  }
  function openWho(required) {
    const ms = ehr.data.group.members;
    const named = ms.map((m, i) => ({ m, i })).filter(x => x.m.name.trim());
    const taken = new Set(named.filter(x => x.m.role !== 'Other member').map(x => x.m.role));
    $('#whoList').innerHTML = named.length ? named.map(({ m }) => `<button type="button" class="who-btn" data-name="${esc(m.name.trim())}"><span class="avatar">${esc(initials(m.name))}</span><span><b>${esc(m.name)}</b><small>${esc(m.role)}</small></span></button>`).join('')
      : '<p class="muted small">No one from your group has signed in yet. Add yourself below.</p>';
    $('#whoRole').innerHTML = C.roles.map(r => `<option ${taken.has(r) ? 'disabled' : ''}>${esc(r)}${taken.has(r) ? ' – taken' : ''}</option>`).join('');
    const firstFree = C.roles.find(r => !taken.has(r)); $('#whoRole').value = firstFree || 'Other member';
    $('#whoName').value = ''; $('#whoErr').textContent = '';
    $('#whoClose').hidden = !!required;
    $('#whoTitle').textContent = required ? 'Who are you?' : 'Switch user';
    $('#whoModal').hidden = false;
  }
  function setMe(name, role) {
    me = { name, role };
    try { localStorage.setItem(meKey(), JSON.stringify(me)); } catch (e) {}
    $('#whoModal').hidden = true;
    refreshMe(); ehr.render();
    ehr.log('Signed in on this device as ' + name + ' (' + role + ')');
    toast('You are charting as ' + name + ' · ' + role, 'ok');
    sync(true);
  }
  $('#whoList').addEventListener('click', e => {
    const b = e.target.closest('[data-name]'); if (!b) return;
    const m = ehr.data.group.members.find(x => x.name.trim() === b.dataset.name);
    if (m) setMe(m.name.trim(), m.role);
  });
  $('#whoForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#whoName').value.trim().replace(/\s+/g, ' '); const role = $('#whoRole').value.replace(/ – taken$/, '');
    if (name.length < 3) { $('#whoErr').textContent = 'Type your full name.'; return; }
    const ms = ehr.data.group.members;
    if (ms.some(m => m.name.trim().toLowerCase() === name.toLowerCase())) { $('#whoErr').textContent = 'That name is already on your team. Pick it from the list above.'; return; }
    if (record.status !== 'draft') { $('#whoErr').textContent = 'This chart is already submitted.'; return; }
    const slot = ms.find(m => m.role === role && !m.name.trim());
    if (slot) slot.name = name; else ms.push({ role, name, exit: ['', '', '', ''] });
    onChange(ehr.data, ['group.members']);
    setMe(name, role);
  });
  $('#meChip').addEventListener('click', () => openWho(false));
  $('#whoClose').addEventListener('click', () => { $('#whoModal').hidden = true; });

  /* ---------- actions from the EHR ---------- */
  function onAction(act, arg) {
    if (act === 'openSign') openSign();
    else if (act === 'bpa') showBpa(arg);
    else if (act === 'toast') toast(arg.msg, arg.kind || 'ok');
  }

  /* ---------- patient list (census) ---------- */
  const VK = () => 'ncm110_verified_' + mode;
  function renderCensus() {
    $('#cenCount').textContent = C.census.filter(p => !p.empty).length;
    $('#cenRows').innerHTML = C.census.map(p => p.empty
      ? `<tr class="cen-empty"><td class="bed">${p.bed}</td><td colspan="9" class="muted">${esc(p.name)}</td></tr>`
      : `<tr class="${p.mine ? 'mine' : 'other'}" data-bed="${p.bed}" tabindex="0">
        <td class="bed">${p.bed}</td>
        <td><b>${esc(p.name)}</b>${p.mine ? ' <span class="pill blue">Assigned</span>' : ''}</td>
        <td>${esc(p.age)}</td><td>${esc(p.md)}</td><td>${esc(p.dx)}</td>
        <td>${!p.allergy || /^nkda$/i.test(p.allergy) ? '<span class="muted">NKDA</span>' : `<span class="al-chip">${EHR.icon('warn', 'sm')} ${esc(p.allergy)}</span>`}</td>
        <td>${/high/i.test(p.fall || '') ? '<span class="fall-hi">High</span>' : esc(p.fall)}</td>
        <td>${p.iso ? `<span class="iso">${esc(p.iso)}</span>` : ''}</td>
        <td>${p.ews === '' ? '' : `<span class="ews ews-${p.ews >= 5 ? 'hi' : p.ews >= 3 ? 'md' : 'lo'}">${p.ews}</span>`}</td>
        <td>${p.mine ? 'Your group' : '<span class="muted">Other RN</span>'}</td></tr>`).join('');
  }
  function openCensusRow(tr) {
    if (!tr || !tr.dataset.bed) return;
    const p = C.census.find(x => x.bed === tr.dataset.bed);
    if (p.mine) return openVerify();
    showBpa({ id: 'btg', level: 'high', title: 'Restricted record – no care relationship', body: `You are not assigned to <b>${esc(p.name)}</b> (Bed ${p.bed}). Under RA 10173 (Data Privacy Act), opening a record without a legitimate care purpose is a privacy breach. This attempt has been <b>logged</b> in the audit trail.`, actions: ['Cancel – I do not need this record'] });
    ehr.log(`Attempted access to non-assigned patient, Bed ${p.bed} (blocked)`);
  }
  $('#cenRows').addEventListener('click', e => openCensusRow(e.target.closest('tr')));
  $('#cenRows').addEventListener('keydown', e => { if (e.key === 'Enter') openCensusRow(e.target.closest('tr')); });

  function showList() { $('#census').hidden = false; $('#chart').hidden = true; $('#tabList').classList.add('on'); $('#tabChart').classList.remove('on'); }
  function showChart() { $('#census').hidden = true; $('#chart').hidden = false; $('#tabChart').disabled = false; $('#tabChart').classList.add('on'); $('#tabList').classList.remove('on'); }
  $('#tabList').addEventListener('click', showList);
  $('#tabChart').addEventListener('click', showChart);

  function decoys(name) {
    // two near-miss names so students must read the wristband carefully
    const m = /^(.*?),\s*(\S+)(.*)$/.exec(name) || [name, name, '', ''];
    const first = m[2] || '', rest = m[3] || '';
    const a = `${m[1]}, ${first}${rest.replace(/([A-Z])\./, (x, l) => String.fromCharCode(((l.charCodeAt(0) - 64) % 26) + 65) + '.')}`;
    const b = `${m[1]}, ${first.length > 4 ? first.slice(0, -1) + (first.endsWith('a') ? 'o' : 'a') : first + 'a'}${rest}`;
    return [...new Set([a, b])].filter(x => x !== name);
  }
  function renderVerify() {
    const p = C.patient;
    $('#wristband').innerHTML = `<div class="wb-strip ${/^\s*(nkda|none)?\s*$/i.test(p.allergy) ? 'nkda' : ''}"></div><div class="wb-body"><b>${esc(p.name.toUpperCase())}</b><span>DOB ${esc(p.dob)} · ${esc((p.sex || '')[0] || '')}</span><span>HOSP NO ${esc(p.hospNo)}</span>${/^\s*(nkda|none)?\s*$/i.test(p.allergy) ? '<span>NKDA</span>' : `<span class="wb-allergy">ALLERGY: ${esc(p.allergy.split(/[(–]/)[0].trim().toUpperCase())}</span>`}</div><div class="wb-barcode"></div>`;
    const opts = [p.name].concat(decoys(p.name)).sort();
    $('#vName').innerHTML = '<option value="">Select…</option>' + opts.map(n => `<option>${esc(n)}</option>`).join('');
  }
  function sameDate(a, b) {
    const norm = x => String(x || '').toLowerCase().replace(/(\d)(st|nd|rd|th)/g, '$1').replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
    if (norm(a) && norm(a) === norm(b)) return true;
    const da = new Date(norm(a)), db = new Date(norm(b));
    return !isNaN(da) && !isNaN(db) && da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
  }
  function openVerify() {
    if (sessionStorage.getItem(VK())) return showChart();
    renderVerify();
    $('#vName').value = ''; $('#vId').value = ''; $('#vErr').textContent = '';
    $('#verifyModal').hidden = false;
  }
  $('#verifyModal').addEventListener('click', e => { if (e.target.matches('[data-close]')) $('#verifyModal').hidden = true; });
  $('#vGo').addEventListener('click', () => {
    const name = $('#vName').value, id = $('#vId').value.trim().toLowerCase().replace(/\s+/g, ' ');
    const okName = name === C.patient.name;
    const hosp = C.patient.hospNo.replace(/\D/g, '');
    const okId = (hosp && id.replace(/[^0-9]/g, '') === hosp) || sameDate(id, C.patient.dob);
    if (!okName || !okId) {
      $('#vErr').textContent = !name ? 'Select the patient\'s name.' : !okName ? 'Name does not match the wristband. Stop and re-check.' : 'Second identifier does not match the wristband.';
      ehr.log('Patient identification failed (' + (!okName ? 'name' : 'second identifier') + ' mismatch)');
      return;
    }
    $('#verifyModal').hidden = true;
    sessionStorage.setItem(VK(), '1');
    ehr.log('Patient identity verified with two identifiers; chart opened');
    showChart();
    const AL = C.alerts || {};
    if (!/^\s*(nkda|none)?\s*$/i.test(C.patient.allergy)) showBpa({ id: 'open-allergy', level: 'high', title: 'Allergy on file', body: `<b>${esc(C.patient.allergy)}</b>${AL.allergyAdvice ? '<br>' + esc(AL.allergyAdvice) : ''}`, actions: ['Allergy reviewed with client', 'Will review at next contact'] });
    if (AL.fallText) showBpa({ id: 'open-fall', level: 'med', title: 'Fall risk', body: esc(AL.fallText), actions: ['Fall precautions in place / will implement', 'Will reassess'] });
  });

  /* ---------- Best Practice Advisory queue ---------- */
  const bpaQueue = [];
  function showBpa(b) { bpaQueue.push(b); if ($('#bpaModal').hidden) nextBpa(); }
  function nextBpa() {
    const b = bpaQueue.shift(); if (!b) { $('#bpaModal').hidden = true; return; }
    $('#bpaModal').dataset.id = b.id;
    $('#bpaModal').querySelector('.bpa').className = 'modal-box bpa ' + (b.level || '');
    $('#bpaTitle').textContent = b.title; $('#bpaBody').innerHTML = b.body;
    $('#bpaActions').innerHTML = b.actions.map((a, i) => `<label class="bpa-opt"><input type="radio" name="bpaAck" value="${esc(a)}" ${b.actions.length === 1 ? 'checked' : ''}><span>${esc(a)}</span></label>`).join('');
    $('#bpaOk').disabled = b.actions.length !== 1;
    $('#bpaModal').hidden = false;
  }
  $('#bpaActions').addEventListener('change', () => { $('#bpaOk').disabled = false; });
  $('#bpaOk').addEventListener('click', () => {
    const v = (document.querySelector('input[name="bpaAck"]:checked') || {}).value;
    if (v && $('#bpaModal').dataset.id !== 'btg') ehr.log(`Advisory "${$('#bpaTitle').textContent}" acknowledged: ${v}`);
    nextBpa();
  });

  /* ---------- chart search (Ctrl+K) ---------- */
  const SEARCH = [
    ['summary', 'Patient Summary', 'care team group roles members progress'],
    ['orders', 'Orders (CPOE)', 'physician orders oxygen ceftriaxone azithromycin paracetamol pnss cbc diet fall precautions demographics banner allergy'],
    ['labs', 'Results Review', 'labs cbc wbc neutrophils sputum culture gram stain chest x-ray xray imaging radiology'],
    ['mar', 'MAR', 'medication administration record schedule due prn ceftriaxone azithromycin paracetamol allergy'],
    ['cards', 'Data Review (Task 1)', 'data cards sort cluster category justification'],
    ['flowsheet', 'Flowsheet (Task 2a)', 'vital signs temperature heart rate respiratory blood pressure spo2 oxygen pain lung sounds morse braden allergy intake mucous'],
    ['note', 'Nursing Notes (Task 2b)', 'admission note narrative smarttext signature'],
    ['dx', 'Nursing Diagnoses (Task 3a)', 'nanda pes problem etiology signs priority'],
    ['careplan', 'Care Plan (Task 3b)', 'smart outcome interventions rationale'],
    ['impl', 'Intervention Log (Task 4a)', 'implementation actions done time'],
    ['eval', 'Evaluation (Task 4b)', 'goal met judgment evaluation data'],
    ['audit', 'Chart Audit (Task 5)', 'audit reyes errors correction'],
    ['sign', 'Sign & Submit', 'checklist pre-sign signature validation'],
    ['exit', 'Exit Ticket', 'individual reflection questions'],
    ['results', 'Results (Rubric)', 'score grade feedback rubric']
  ];
  let sIdx = 0, sItems = [];
  function openSearch() { $('#searchModal').hidden = false; $('#searchInput').value = ''; renderSearch(); setTimeout(() => $('#searchInput').focus(), 20); }
  function renderSearch() {
    const q = $('#searchInput').value.toLowerCase().trim();
    sItems = SEARCH.filter(([, l, k]) => !q || (l + ' ' + k).toLowerCase().includes(q));
    sIdx = Math.min(sIdx, Math.max(sItems.length - 1, 0));
    $('#searchList').innerHTML = sItems.map(([id, l, k], i) => `<li class="${i === sIdx ? 'on' : ''}" data-id="${id}"><b>${esc(l)}</b><small>${esc(k.split(' ').slice(0, 6).join(' · '))}</small></li>`).join('') || '<li class="muted">No matches</li>';
  }
  function pickSearch(id) { $('#searchModal').hidden = true; if (id && sessionStorage.getItem(VK())) { showChart(); ehr.go(id); } else if (id) { showList(); toast('Open the patient chart first.'); } }
  $('#searchBtn').addEventListener('click', openSearch);
  $('#searchInput').addEventListener('input', () => { sIdx = 0; renderSearch(); });
  $('#searchInput').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sIdx = Math.min(sIdx + 1, sItems.length - 1); renderSearch(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sIdx = Math.max(sIdx - 1, 0); renderSearch(); e.preventDefault(); }
    else if (e.key === 'Enter') pickSearch(sItems[sIdx] && sItems[sIdx][0]);
    else if (e.key === 'Escape') $('#searchModal').hidden = true;
  });
  $('#searchList').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) pickSearch(li.dataset.id); });
  $('#searchModal').addEventListener('click', e => { if (e.target.id === 'searchModal') $('#searchModal').hidden = true; });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && session) { e.preventDefault(); openSearch(); } });

  function openSign() {
    $('#signModal h2').textContent = mode === 'practice' ? 'Finish practice' : 'Electronic signature';
    $('#signGo').textContent = mode === 'practice' ? 'Finish practice & unlock graded task' : 'Sign & submit';
    if (mode === 'practice') {
      if (practiceDone) { toast('Practice is already finished. Your graded task is open from the top bar.', 'info'); return; }
      const pct = EHR.overall(ehr.data);
      if (pct < PRACTICE_MIN) { toast(`Your practice chart is ${pct}% complete. Complete at least ${PRACTICE_MIN}% (see Patient Summary), then sign.`, 'info'); return; }
      if (ehr.data.checklist.some(c => !c.done)) { ehr.go('sign'); toast('Tick every item in the pre-sign checklist first.', 'info'); return; }
    }
    const issues = ehr.validate();
    $('#signDesc').innerHTML = mode === 'practice'
      ? 'Signing the <b>practice chart</b> tells your instructor your group finished practice and <b>unlocks the graded task</b> for every groupmate. Nothing from the practice chart is graded.'
      : 'You are signing the record for <b id="signRecord"></b>. After signing, the chart is submitted to your instructor and locked.';
    if ($('#signRecord')) $('#signRecord').textContent = record.id;
    const names = ehr.data.group.members.filter(m => m.name.trim());
    $('#signBy').innerHTML = names.map(m => `<option ${me ? (m.name.trim() === me.name ? 'selected' : '') : (m.role === 'Documenting Nurse' ? 'selected' : '')}>${esc(m.name)}</option>`).join('') || '<option value="">(add names on Patient Summary)</option>';
    const errs = issues.filter(x => x.level === 'err');
    $('#signIssues').innerHTML = issues.length ? `<b>${errs.length ? errs.length + ' required item(s) incomplete' : 'Warnings'}:</b><ul>${issues.slice(0, 6).map(x => `<li class="${x.level}">${esc(x.msg)}</li>`).join('')}${issues.length > 6 ? `<li>…and ${issues.length - 6} more</li>` : ''}</ul>` : '';
    $('#signPin').value = ''; $('#signErr').textContent = '';
    $('#signModal').hidden = false; setTimeout(() => $('#signPin').focus(), 50);
  }
  $('#signModal').addEventListener('click', e => { if (e.target.matches('[data-close]') || e.target.id === 'signModal') $('#signModal').hidden = true; });
  $('#signGo').addEventListener('click', async () => {
    if ($('#signPin').value !== session.pin) { $('#signErr').textContent = 'PIN does not match.'; return; }
    if (mode === 'practice') {
      const btn = $('#signGo'); btn.disabled = true; btn.textContent = 'Finishing…';
      try {
        await API.call('practiceDone', Object.assign({}, session, { by: $('#signBy').value || (me && me.name) || '', progress: EHR.overall(ehr.data) }));
        practiceDone = true; $('#signModal').hidden = true;
        toast('Practice finished! Your group\'s graded task is now open.', 'ok');
        setTimeout(() => switchMode('task'), 900);
      } catch (e) { $('#signErr').textContent = /Unknown action/i.test(e.message) ? 'The server needs the latest update. Tell your instructor.' : e.message; }
      finally { btn.disabled = false; btn.textContent = 'Sign & submit'; }
      return;
    }
    if (!$('#signBy').value) { $('#signErr').textContent = 'Add member names first.'; return; }
    if (!confirm('Submit the record now? You will not be able to edit it afterwards.')) return;
    const btn = $('#signGo'); btn.disabled = true; btn.textContent = 'Submitting…';
    await flush();            // save this device's last edits and pull groupmates' latest first
    await sync(true);
    const data = ehr.data;
    data.signed = { by: $('#signBy').value, title: $('#signTitle').value.trim(), at: Date.now() };
    data.trail.push({ t: Date.now(), u: data.signed.by, tab: 'sign', f: 'Record signed and submitted' });
    try {
      const r = await API.submit(Object.assign({}, session, { data, progress: EHR.overall(data) }));
      record.status = 'submitted'; record.submittedAt = r.submittedAt || Date.now(); pending.clear(); if (r.version) version = r.version; trailSent = data.trail.length;
      try { localStorage.removeItem(backupKey()); } catch (e) {}
      $('#signModal').hidden = true; ehr.setReadOnly(true, roNote()); ehr.go('sign');
      setSync('ok', 'Submitted'); toast('Record signed and submitted. Great work!', 'ok');
    } catch (e) { data.signed = null; $('#signErr').textContent = e.message; }
    finally { btn.disabled = false; btn.textContent = 'Sign & submit'; }
  });

  /* ---------- nav / logout / lock ---------- */
  $('#menuBtn').addEventListener('click', () => $('#ehr').classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => $('#ehr').classList.remove('nav-open'));
  $('#ehr').addEventListener('click', e => { if (e.target.closest('[data-goto]')) $('#ehr').classList.remove('nav-open'); });
  $('#logoutBtn').addEventListener('click', async () => {
    await flush();
    if (pending.size && !confirm('Some changes are not yet saved to the server. Sign out anyway?')) return;
    sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem('ncm110_user'); Object.keys(sessionStorage).filter(k => /^ncm110_(mode_|verified_)/.test(k)).forEach(k => sessionStorage.removeItem(k)); sessionStorage.removeItem(VK()); location.hash = ''; location.reload();
  });

  let idleT;
  function resetIdle() { clearTimeout(idleT); idleT = setTimeout(lock, IDLE_MIN * 60 * 1000); }
  ['mousemove', 'keydown', 'pointerdown', 'scroll'].forEach(ev => document.addEventListener(ev, () => { if ($('#lockScreen').hidden) resetIdle(); }, { passive: true }));
  function lock() { if (!session) return; flush(); $('#lockScreen').hidden = false; $('#unlockPin').value = ''; $('#unlockErr').textContent = ''; setTimeout(() => $('#unlockPin').focus(), 50); }
  $('#lockBtn').addEventListener('click', lock);
  function unlock() { if ($('#unlockPin').value === session.pin) { $('#lockScreen').hidden = true; resetIdle(); } else $('#unlockErr').textContent = 'Incorrect PIN.'; }
  $('#unlockBtn').addEventListener('click', unlock);
  $('#unlockPin').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });

  // keyboard: Ctrl+S saves
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flush().then(() => toast('Saved')); } });

  $('#login').hidden = true;
  init();
})();
