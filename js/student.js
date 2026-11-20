/* Student app: sign-in, autosave, signing, lock screen. */
(function () {
  const C = window.CASE, CFG = window.EHR_CONFIG, $ = s => document.querySelector(s);
  const SESSION_KEY = 'ncm110_ehr_session';
  const IDLE_MIN = 15;

  let session = null;   // {section, group, pin}
  let record = null;    // server record meta
  let ehr = null;
  let dirty = false, saving = false, lastSaved = null;
  let user = '';

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

  function onChange(data) {
    dirty = true; setSync('pending', 'Unsaved changes');
    try { localStorage.setItem(backupKey(), JSON.stringify({ at: Date.now(), data })); } catch (e) {}
  }

  async function save(force) {
    if (!ehr || saving || (!dirty && !force) || !record || record.status !== 'draft') return;
    saving = true; setSync('saving', 'Saving…');
    dirty = false;
    try {
      const r = await API.save(Object.assign({}, session, { data: ehr.data, progress: EHR.overall(ehr.data) }));
      lastSaved = r.updatedAt || Date.now(); record.updatedAt = lastSaved;
      setSync('ok', 'Saved ' + hhmm(lastSaved));
    } catch (e) {
      dirty = true; setSync('err', 'Not saved – retrying');
      if (/already signed/i.test(e.message)) { record.status = 'submitted'; ehr.setReadOnly(true, roNote()); }
    } finally { saving = false; }
  }
  const hhmm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

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
    applyCase(res.case);   // the patient your instructor assigned to this section
    let data = record.data;
    // local backup newer than server copy? (e.g., lost connection before sync)
    try {
      const b = JSON.parse(localStorage.getItem(backupKey()) || 'null');
      if (record.status === 'draft' && b && b.data && (!record.updatedAt || b.at > record.updatedAt + 1000)) { data = b.data; dirty = true; if (!silent) toast('Restored unsynced work from this device.', 'info'); }
    } catch (e) {}
    if (!data) { data = EHR.blankData(); data.group.section = session.section; data.group.groupNo = session.group; }
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
      onChange, onAction, onTab: t => { history.replaceState(null, '', '#' + t); }
    });
    cfgP.then(c => ehr.setTask5(!!c.task5Unlocked));
    refreshUsers();
    if (record.status !== 'draft') setSync('ok', record.status === 'graded' ? 'Graded' : 'Submitted');
    else setSync(dirty ? 'pending' : 'ok', dirty ? 'Unsaved changes' : 'Saved');
    if (created) toast('Signed in as ' + record.id + '. Open your assigned patient from the list.', 'ok');
    else toast('Welcome back, ' + record.id + '.', 'ok');
    if (sessionStorage.getItem(VERIFIED_KEY)) showChart(); else showList();
    setInterval(() => save(), (CFG.AUTOSAVE_SECONDS || 20) * 1000);
    setInterval(async () => { try { const c = await API.getConfig(session.section); ehr.setTask5(!!c.task5Unlocked); } catch (e) {} }, (CFG.CONFIG_POLL_SECONDS || 30) * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    window.addEventListener('beforeunload', e => { if (dirty) { save(); e.preventDefault(); e.returnValue = ''; } });
    // refresh user list when names change
    $('#ehr').addEventListener('input', e => { if (e.target.dataset.path && /^group\.members\.\d+\.name$/.test(e.target.dataset.path)) refreshUsers(); });
    resetIdle();
  }

  /* ---------- documenting user ---------- */
  function refreshUsers() {
    const names = ehr.data.group.members.filter(m => m.name.trim()).map(m => m.name.trim());
    const sel = $('#userSelect');
    const prev = sessionStorage.getItem('ncm110_user') || user;
    sel.innerHTML = `<option value="">Group ${esc(session.group)}</option>` + names.map(n => `<option ${n === prev ? 'selected' : ''}>${esc(n)}</option>`).join('');
    user = sel.value; ehr.setUser(user || 'Group ' + session.group);
    $('#sbUser').innerHTML = 'User: <b>' + esc(user || 'Group ' + session.group) + '</b> · ' + esc(record.id);
    $('#userAvatar').textContent = user ? user.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase() : 'G';
  }
  const esc = EHR.esc;
  $('#userSelect').addEventListener('change', e => { sessionStorage.setItem('ncm110_user', e.target.value); refreshUsers(); toast('Now documenting as ' + (e.target.value || 'Group ' + session.group)); });

  /* ---------- actions from the EHR ---------- */
  function onAction(act, arg) {
    if (act === 'openSign') openSign();
    else if (act === 'bpa') showBpa(arg);
    else if (act === 'toast') toast(arg.msg, arg.kind || 'ok');
  }

  /* ---------- patient list (census) ---------- */
  const VERIFIED_KEY = 'ncm110_verified';
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
    if (sessionStorage.getItem(VERIFIED_KEY)) return showChart();
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
    sessionStorage.setItem(VERIFIED_KEY, '1');
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
  function pickSearch(id) { $('#searchModal').hidden = true; if (id && sessionStorage.getItem(VERIFIED_KEY)) { showChart(); ehr.go(id); } else if (id) { showList(); toast('Open the patient chart first.'); } }
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
    const issues = ehr.validate();
    $('#signRecord').textContent = record.id;
    const names = ehr.data.group.members.filter(m => m.name.trim());
    $('#signBy').innerHTML = names.map(m => `<option ${m.role === 'Documenting Nurse' ? 'selected' : ''}>${esc(m.name)}</option>`).join('') || '<option value="">(add names on Patient Summary)</option>';
    const errs = issues.filter(x => x.level === 'err');
    $('#signIssues').innerHTML = issues.length ? `<b>${errs.length ? errs.length + ' required item(s) incomplete' : 'Warnings'}:</b><ul>${issues.slice(0, 6).map(x => `<li class="${x.level}">${esc(x.msg)}</li>`).join('')}${issues.length > 6 ? `<li>…and ${issues.length - 6} more</li>` : ''}</ul>` : '';
    $('#signPin').value = ''; $('#signErr').textContent = '';
    $('#signModal').hidden = false; setTimeout(() => $('#signPin').focus(), 50);
  }
  $('#signModal').addEventListener('click', e => { if (e.target.matches('[data-close]') || e.target.id === 'signModal') $('#signModal').hidden = true; });
  $('#signGo').addEventListener('click', async () => {
    if ($('#signPin').value !== session.pin) { $('#signErr').textContent = 'PIN does not match.'; return; }
    if (!$('#signBy').value) { $('#signErr').textContent = 'Add member names first.'; return; }
    if (!confirm('Submit the record now? You will not be able to edit it afterwards.')) return;
    const btn = $('#signGo'); btn.disabled = true; btn.textContent = 'Submitting…';
    const data = ehr.data;
    data.signed = { by: $('#signBy').value, title: $('#signTitle').value.trim(), at: Date.now() };
    data.trail.push({ t: Date.now(), u: data.signed.by, tab: 'sign', f: 'Record signed and submitted' });
    try {
      const r = await API.submit(Object.assign({}, session, { data, progress: EHR.overall(data) }));
      record.status = 'submitted'; record.submittedAt = r.submittedAt || Date.now(); dirty = false;
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
    await save(true);
    if (dirty && !confirm('Some changes are not yet saved to the server. Sign out anyway?')) return;
    sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem('ncm110_user'); sessionStorage.removeItem(VERIFIED_KEY); location.hash = ''; location.reload();
  });

  let idleT;
  function resetIdle() { clearTimeout(idleT); idleT = setTimeout(lock, IDLE_MIN * 60 * 1000); }
  ['mousemove', 'keydown', 'pointerdown', 'scroll'].forEach(ev => document.addEventListener(ev, () => { if ($('#lockScreen').hidden) resetIdle(); }, { passive: true }));
  function lock() { if (!session) return; save(); $('#lockScreen').hidden = false; $('#unlockPin').value = ''; $('#unlockErr').textContent = ''; setTimeout(() => $('#unlockPin').focus(), 50); }
  $('#lockBtn').addEventListener('click', lock);
  function unlock() { if ($('#unlockPin').value === session.pin) { $('#lockScreen').hidden = true; resetIdle(); } else $('#unlockErr').textContent = 'Incorrect PIN.'; }
  $('#unlockBtn').addEventListener('click', unlock);
  $('#unlockPin').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });

  // keyboard: Ctrl+S saves
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(true).then(() => toast('Saved')); } });

  $('#login').hidden = true;
  init();
})();
