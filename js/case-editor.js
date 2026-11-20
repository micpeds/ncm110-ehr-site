/* Patient case editor (faculty). Schema-driven forms over a case object. */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const getP = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setP = (o, p, v) => { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null) a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = v; };

  const ORDER_STATUS = ['Active', 'Active PRN', 'Completed', 'Discontinued', 'On hold'];
  const FALL = ['Low', 'Mod', 'High'];
  const MAR_KIND = ['Scheduled', 'PRN', 'Continuous'];
  const LAB_FLAG = [{ v: '', l: '—' }, { v: 'H', l: 'H (high)' }, { v: 'L', l: 'L (low)' }, { v: 'C', l: 'C (critical)' }];

  /* ---------- the editor's sections ---------- */
  const SECTIONS = [
    { id: 'patient', label: 'Patient & banner', icon: 'user', help: 'Identifiers, location and flags shown on the patient banner, wristband and Patient List.',
      groups: [
        { title: 'Identity (used for the two-identifier wristband check)', fields: [
          { k: 'patient.name', l: 'Full name', ph: 'LASTNAME, Firstname M.', w: 2, req: true, hint: 'Write as LASTNAME, Firstname M. — two look-alike names are generated for the wristband check.' },
          { k: 'patient.nickname', l: 'Preferred name / nickname', ph: 'e.g., Lola Charing' },
          { k: 'patient.hospNo', l: 'Hospital number', ph: '2026-004517', req: true },
          { k: 'patient.dob', l: 'Date of birth', ph: '14 March 1954', req: true },
          { k: 'patient.age', l: 'Age', ph: '72 y' },
          { k: 'patient.sex', l: 'Sex', opts: ['Female', 'Male'] }
        ]},
        { title: 'Admission', fields: [
          { k: 'patient.ward', l: 'Ward / unit', ph: 'Medical Ward 3' },
          { k: 'patient.bed', l: 'Bed', ph: '12' },
          { k: 'patient.attending', l: 'Attending physician', ph: 'Dr. A. Ramos' },
          { k: 'patient.dx', l: 'Admitting diagnosis', ph: 'Community-acquired pneumonia', w: 2 },
          { k: 'patient.admission', l: 'Admitted', ph: 'Day 1, 0730 H, from the ED' },
          { k: 'patient.weight', l: 'Weight', ph: '52 kg' },
          { k: 'patient.height', l: 'Height', ph: '152 cm' },
          { k: 'patient.context', l: 'Social context', area: true, w: 3, ph: 'Lives with…, occupation, mobility…' }
        ]},
        { title: 'Safety flags', fields: [
          { k: 'patient.allergy', l: 'Allergy', ph: 'NKDA, or e.g., Penicillin – hives', w: 2, hint: 'Type NKDA if none. An allergy shows as a red banner flag and an alert on opening the chart.' },
          { k: 'patient.code', l: 'Code status', opts: ['Full Code', 'DNR', 'DNI', 'Comfort care'] },
          { k: 'patient.isolation', l: 'Isolation', opts: ['', 'Standard', 'Contact', 'Droplet', 'Airborne'] },
          { k: 'patient.fallRisk', l: 'Fall risk', opts: FALL },
          { k: 'patient.ews', l: 'Early warning score', ph: '0–10', num: true }
        ]}
      ] },
    { id: 'orders', label: 'Physician orders', icon: 'orders', help: 'Orders are numbered automatically (Order 1, 2, 3…) in this order. Students link dependent interventions to these numbers.',
      list: { k: 'orders', add: '+ Add order', blank: { cat: '', text: '', status: 'Active' }, cols: [
        { k: 'cat', l: 'Category', ph: 'Medication', w: '150px' },
        { k: 'text', l: 'Order', ph: 'Ceftriaxone 2 g IV once daily…', area: true },
        { k: 'status', l: 'Status', opts: ORDER_STATUS, w: '140px' }
      ] } },
    { id: 'cards', label: 'Data cards (Task 1)', icon: 'cards', help: 'The assessment data students sort and cluster. Start time-stamped items with the time, e.g. "0815 H: Oxygen started…" — the EHR uses this to warn students who chart an action at the wrong time.',
      strings: { k: 'cards', add: '+ Add data card', ph: '0800 H: Temperature 38.6 °C (axillary)', area: true } },
    { id: 'flow', label: 'Flowsheet & alerts', icon: 'vitals', help: 'Rows students complete on the flowsheet (Task 2a) and the automatic clinical alerts.',
      groups: [
        { title: 'Flowsheet column', fields: [{ k: 'flowTime', l: 'Assessment time', ph: '0800 H' }] },
        { title: 'Clinical alerts (leave a field blank to switch that alert off)', fields: [
          { k: 'alerts.allergyKeywords', l: 'Allergy keywords', ph: 'penicillin, amoxicillin, ampicillin', w: 2, hint: 'Comma-separated. If a student types one of these in an intervention, a drug–allergy alert pops up.' },
          { k: 'alerts.allergyAdvice', l: 'Allergy advice on chart open', ph: 'Avoid penicillin-class antibiotics…', w: 3, area: true },
          { k: 'alerts.spo2Min', l: 'Low SpO2 alert below (%)', ph: '92', num: true },
          { k: 'alerts.spo2Text', l: 'Low SpO2 alert message', ph: 'Order 1: Oxygen via nasal cannula…', w: 2 },
          { k: 'alerts.feverMin', l: 'Fever alert at or above (°C)', ph: '38', num: true },
          { k: 'alerts.feverText', l: 'Fever alert message', ph: 'Order 4: Paracetamol 500 mg PO PRN…', w: 2 },
          { k: 'alerts.fallText', l: 'Fall-risk alert on chart open', ph: 'Morse Fall Scale 55 (high risk)…', w: 3, area: true }
        ]}
      ],
      strings: { k: 'flowsheetRows', title: 'Flowsheet rows', add: '+ Add row', ph: 'e.g., Capillary blood glucose', hint: 'Keep the names "SpO2" and "Temperature" if you want the alerts above to work.' } },
    { id: 'results', label: 'Labs & imaging', icon: 'labs', help: 'Shown on the Results Review screen. Rows with the same panel name are grouped together.',
      list: { k: 'labs', title: 'Laboratory results', add: '+ Add lab result', blank: { panel: '', collected: '', status: 'Final', test: '', value: '', unit: '', ref: '', flag: '' }, cols: [
        { k: 'panel', l: 'Panel', ph: 'Complete Blood Count', w: '170px' }, { k: 'collected', l: 'Collected', ph: 'Day 1, 0650 H', w: '130px' },
        { k: 'status', l: 'Status', opts: ['Final', 'Pending', 'Preliminary'], w: '110px' }, { k: 'test', l: 'Test', ph: 'WBC' },
        { k: 'value', l: 'Result', ph: '15.8', w: '90px' }, { k: 'unit', l: 'Units', ph: 'x 10^9/L', w: '100px' },
        { k: 'ref', l: 'Reference', ph: '4.5 – 11.0', w: '110px' }, { k: 'flag', l: 'Flag', opts: LAB_FLAG, w: '100px' }
      ] },
      list2: { k: 'imaging', title: 'Imaging reports', add: '+ Add imaging report', blank: { study: '', done: '', status: 'Final', findings: '', impression: '' }, cols: [
        { k: 'study', l: 'Study', ph: 'Chest X-ray, PA view', w: '170px' }, { k: 'done', l: 'Done', ph: 'Day 1, 0700 H', w: '130px' },
        { k: 'status', l: 'Status', opts: ['Final', 'Preliminary', 'Pending'], w: '110px' },
        { k: 'findings', l: 'Findings', area: true }, { k: 'impression', l: 'Impression', area: true }
      ] } },
    { id: 'mar', label: 'MAR', icon: 'mar', help: 'Medication schedule shown on the MAR (0800–1500 H). For scheduled drugs list due times, e.g. "0900, 1300".',
      list: { k: 'mar', add: '+ Add medication', blank: { med: '', dose: '', route: '', freq: '', kind: 'Scheduled', due: '', order: '' }, cols: [
        { k: 'med', l: 'Medication', ph: 'Ceftriaxone', w: '150px' }, { k: 'dose', l: 'Dose', ph: '2 g', w: '80px' }, { k: 'route', l: 'Route', ph: 'IV', w: '70px' },
        { k: 'freq', l: 'Frequency / instructions', ph: 'Once daily' }, { k: 'kind', l: 'Type', opts: MAR_KIND, w: '120px' },
        { k: 'due', l: 'Due times', ph: '0900', w: '110px' }, { k: 'order', l: 'Order no.', ph: '2', w: '80px' }
      ] } },
    { id: 'census', label: 'Unit census', icon: 'building', help: 'Other patients on the Patient List. Students cannot open them — trying is logged as a privacy breach. Your case patient is added automatically at their bed number.',
      list: { k: 'census', add: '+ Add patient', blank: { bed: '', name: '', age: '', md: '', dx: '', allergy: 'NKDA', fall: 'Low', iso: '', ews: '' }, cols: [
        { k: 'bed', l: 'Bed', ph: '08', w: '60px' }, { k: 'name', l: 'Name', ph: 'DELA CRUZ, Ernesto P.' }, { k: 'age', l: 'Age/Sex', ph: '68 y M', w: '90px' },
        { k: 'md', l: 'Attending', ph: 'Dr. L. Santos', w: '130px' }, { k: 'dx', l: 'Diagnosis', ph: 'Heart failure' }, { k: 'allergy', l: 'Allergy', ph: 'NKDA', w: '110px' },
        { k: 'fall', l: 'Fall', opts: FALL, w: '80px' }, { k: 'iso', l: 'Isolation', opts: ['', 'Standard', 'Contact', 'Droplet', 'Airborne'], w: '110px' }, { k: 'ews', l: 'EWS', ph: '0', w: '60px' }
      ] } },
    { id: 'audit', label: 'Chart audit (Task 5)', icon: 'audit', help: 'The colleague\'s flawed record students audit. Plant at least 10 errors. Entries are lettered A, B, C… automatically.',
      groups: [{ title: '', fields: [{ k: 'auditNurse', l: 'Colleague who documented it', ph: 'J. Reyes, RN' }] }],
      list: { k: 'auditRecord', add: '+ Add record entry', blank: { section: '', entry: '' }, letters: true, cols: [
        { k: 'section', l: 'Record section', ph: 'Flowsheet 0800', w: '200px' }, { k: 'entry', l: 'Entry as charted (with errors)', ph: 'T 38.6 | RR 16 | SpO2 98% RA…', area: true }
      ] } },
    { id: 'exit', label: 'Exit ticket', icon: 'pen', help: 'Individual reflection questions every member answers.',
      strings: { k: 'exitQuestions', add: '+ Add question', ph: 'Which error in Task 5 was the most dangerous for the client? Why?', area: true } },
    { id: 'key', label: 'Answer key', icon: 'key', private: true, help: 'Only you see this — it appears beside the rubric while you grade. Students never receive it.',
      list: { k: 'key.audit', title: 'Expected Task 5 findings', add: '+ Add expected finding', blank: { loc: '', error: '', type: '', harm: '', fix: '' }, cols: [
        { k: 'loc', l: 'Location', ph: 'A – Banner', w: '130px' }, { k: 'error', l: 'What is wrong', area: true }, { k: 'type', l: 'Type', optsFrom: 'auditErrorTypes', w: '170px' },
        { k: 'harm', l: 'Possible harm', area: true }, { k: 'fix', l: 'Correct entry / action', area: true }
      ] },
      strings: { k: 'key.notes', title: 'Grading notes for Tasks 1–4', add: '+ Add note', ph: 'Suggested priorities: (1) Impaired gas exchange – cards 1, 4, 6…', area: true } }
  ];

  /* ---------- editor ---------- */
  let active = null;
  document.addEventListener('keydown', e => {
    if (!active || active.host.hidden || !document.body.contains(active.host)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); active.save(); }
  });
  function open(host, caseObj, opts) {
    const st = { c: JSON.parse(JSON.stringify(caseObj)), sec: 'patient', dirty: false, saving: false };
    ['orders', 'cards', 'flowsheetRows', 'labs', 'imaging', 'mar', 'census', 'auditRecord', 'exitQuestions'].forEach(k => { if (!Array.isArray(st.c[k])) st.c[k] = []; });
    st.c.patient = st.c.patient || {}; st.c.alerts = st.c.alerts || {}; st.c.key = st.c.key || {};
    if (!Array.isArray(st.c.key.audit)) st.c.key.audit = []; if (!Array.isArray(st.c.key.notes)) st.c.key.notes = [];

    function count(s) {
      const pick = k => (getP(st.c, k) || []).length;
      if (s.list && !s.list2 && !s.strings) return pick(s.list.k);
      if (s.strings && !s.list) return pick(s.strings.k);
      if (s.id === 'results') return pick('labs') + pick('imaging');
      if (s.id === 'key') return pick('key.audit');
      return null;
    }
    function shell() {
      host.innerHTML = `
        <div class="ce-top">
          <button class="btn ghost sm" data-ce="close">${EHR.icon('left', 'sm')} Cases</button>
          <input class="f ce-title" data-k="title" value="${esc(st.c.title)}" placeholder="Case title, e.g. Mang Ben – Heart failure">
          <span class="ce-state" id="ceState"></span>
          <button class="btn sm" data-ce="preview">Preview as student</button>
          <button class="btn sm primary" data-ce="save" id="ceSave">Save case</button>
        </div>
        ${opts.usedBy && opts.usedBy.length ? `<div class="ce-warn">${EHR.icon('warn', 'sm')} Assigned to <b>${opts.usedBy.map(esc).join(', ')}</b>. Students already charting this case will see your changes the next time they open their chart.</div>` : ''}
        <div class="ce-body">
          <nav class="ce-nav" id="ceNav"></nav>
          <div class="ce-main" id="ceMain"></div>
        </div>`;
      renderNav(); renderMain(); setState();
    }
    function renderNav() {
      host.querySelector('#ceNav').innerHTML = SECTIONS.map(s => { const n = count(s); return `<button class="${s.id === st.sec ? 'on' : ''}" data-sec="${s.id}"><span class="ce-ico">${EHR.icon(s.icon)}</span><span>${esc(s.label)}</span>${n != null ? `<em>${n}</em>` : ''}${s.private ? '<small class="pill grey">private</small>' : ''}</button>`; }).join('');
    }
    function field(f, base) {
      const k = base ? base + '.' + f.k : f.k;
      const v = getP(st.c, k); const val = v == null ? '' : v;
      const opts = f.optsFrom ? (window.CASE_BASE[f.optsFrom] || []) : f.opts;
      if (opts) return `<select class="f" data-k="${k}">${opts.map(o => { const ov = typeof o === 'object' ? o.v : o, ol = typeof o === 'object' ? o.l : (o || '—'); return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}${!opts.some(o => String(typeof o === 'object' ? o.v : o) === String(val)) && val ? `<option selected>${esc(val)}</option>` : ''}</select>`;
      if (f.area) return `<textarea class="f" data-k="${k}" rows="2" placeholder="${esc(f.ph || '')}">${esc(val)}</textarea>`;
      return `<input class="f" data-k="${k}" value="${esc(val)}" placeholder="${esc(f.ph || '')}" ${f.num ? 'inputmode="decimal"' : ''}>`;
    }
    function groupsHtml(groups) {
      return groups.map(g => `<section class="card"><h2>${esc(g.title || 'Details')}</h2><div class="ce-grid">${g.fields.map(f => `<label class="ce-f w${f.w || 1}"><span>${esc(f.l)}${f.req ? ' <span class="req">*</span>' : ''}</span>${field(f)}${f.hint ? `<small class="muted">${esc(f.hint)}</small>` : ''}</label>`).join('')}</div></section>`).join('');
    }
    function listHtml(L) {
      const rows = getP(st.c, L.k) || [];
      return `<section class="card flush ce-list"><div class="sec-bar"><b>${esc(L.title || 'Entries')}</b><span>${rows.length} item${rows.length === 1 ? '' : 's'}</span><button class="btn sm" data-ce="add" data-k="${L.k}" style="margin-left:auto">${esc(L.add)}</button></div>
        ${rows.length ? `<div class="tbl-wrap"><table class="tbl ce-tbl"><thead><tr><th style="width:40px">#</th>${L.cols.map(c => `<th style="${c.w ? 'width:' + c.w : ''}">${esc(c.l)}</th>`).join('')}<th style="width:96px"></th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td class="num">${L.letters ? ('ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i] || i + 1) : i + 1}</td>${L.cols.map(c => `<td>${field(c, L.k + '.' + i)}</td>`).join('')}<td class="row-tools">${tools(L.k, i, rows.length)}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">Nothing here yet. <button class="link" data-ce="add" data-k="${L.k}">${esc(L.add.replace('+ ', ''))}</button></div>`}</section>`;
    }
    function stringsHtml(S) {
      const rows = getP(st.c, S.k) || [];
      return `<section class="card flush ce-list"><div class="sec-bar"><b>${esc(S.title || 'Items')}</b><span>${rows.length} item${rows.length === 1 ? '' : 's'}</span><button class="btn sm" data-ce="add" data-k="${S.k}" style="margin-left:auto">${esc(S.add)}</button></div>
        ${S.hint ? `<p class="hint ce-hint">${esc(S.hint)}</p>` : ''}
        ${rows.length ? `<ol class="ce-strings">${rows.map((r, i) => `<li><span class="num">${i + 1}</span>${S.area ? `<textarea class="f" data-k="${S.k}.${i}" rows="1" placeholder="${esc(S.ph || '')}">${esc(r)}</textarea>` : `<input class="f" data-k="${S.k}.${i}" value="${esc(r)}" placeholder="${esc(S.ph || '')}">`}<span class="row-tools">${tools(S.k, i, rows.length)}</span></li>`).join('')}</ol>`
          : `<div class="empty">Nothing here yet. <button class="link" data-ce="add" data-k="${S.k}">${esc(S.add.replace('+ ', ''))}</button></div>`}</section>`;
    }
    const tools = (k, i, n) => `<button type="button" class="icon-btn mv" data-ce="up" data-k="${k}" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Move up" aria-label="Move up">${EHR.icon('up', 'sm')}</button><button type="button" class="icon-btn mv" data-ce="down" data-k="${k}" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} title="Move down" aria-label="Move down">${EHR.icon('down', 'sm')}</button><button type="button" class="icon-btn" data-ce="del" data-k="${k}" data-i="${i}" title="Remove" aria-label="Remove">${EHR.icon('x', 'sm')}</button>`;

    function renderMain(keepScroll) {
      const s = SECTIONS.find(x => x.id === st.sec);
      const main = host.querySelector('#ceMain'); const top = keepScroll ? main.scrollTop : 0;
      main.innerHTML = `<div class="ce-head"><h1><span class="ce-h-ico">${EHR.icon(s.icon)}</span>${esc(s.label)}</h1><p class="pg-desc">${esc(s.help)}</p></div>` +
        (s.groups ? groupsHtml(s.groups) : '') + (s.list ? listHtml(s.list) : '') + (s.list2 ? listHtml(s.list2) : '') + (s.strings ? stringsHtml(s.strings) : '') +
        pager();
      main.scrollTop = top;
      main.querySelectorAll('textarea').forEach(grow);
    }
    function pager() {
      const i = SECTIONS.findIndex(x => x.id === st.sec);
      const p = SECTIONS[i - 1], n = SECTIONS[i + 1];
      return `<nav class="pager">${p ? `<button class="pg-btn" data-sec="${p.id}"><small>${EHR.icon('left', 'sm')} Previous</small><b>${esc(p.label)}</b></button>` : '<span></span>'}${n ? `<button class="pg-btn next" data-sec="${n.id}"><small>Next ${EHR.icon('right', 'sm')}</small><b>${esc(n.label)}</b></button>` : ''}</nav>`;
    }
    const grow = t => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 260) + 'px'; };
    function setState() {
      const el = host.querySelector('#ceState'); const b = host.querySelector('#ceSave');
      el.textContent = st.saving ? 'Saving…' : st.dirty ? 'Unsaved changes' : (st.c.updatedAt ? 'All changes saved' : 'Not saved yet');
      el.className = 'ce-state ' + (st.dirty ? 'dirty' : 'ok');
      b.disabled = st.saving;
    }
    const markDirty = () => { st.dirty = true; setState(); opts.onDirty && opts.onDirty(true); };

    host.oninput = e => {
      const k = e.target.dataset.k; if (!k) return;
      setP(st.c, k, e.target.value); markDirty();
      if (e.target.tagName === 'TEXTAREA') grow(e.target);
    };
    host.onchange = e => { if (e.target.tagName === 'SELECT' && e.target.dataset.k) { setP(st.c, e.target.dataset.k, e.target.value); markDirty(); } };
    host.onclick = async e => {
      const sb = e.target.closest('[data-sec]'); if (sb) { st.sec = sb.dataset.sec; renderNav(); renderMain(); return; }
      const b = e.target.closest('[data-ce]'); if (!b) return;
      const act = b.dataset.ce, k = b.dataset.k, i = +b.dataset.i;
      const arr = k ? getP(st.c, k) : null;
      if (act === 'add') {
        const s = SECTIONS.find(x => [x.list, x.list2, x.strings].some(L => L && L.k === k));
        const L = [s.list, s.list2].find(x => x && x.k === k);
        arr.push(L ? JSON.parse(JSON.stringify(L.blank)) : '');
        markDirty(); renderNav(); renderMain(true);
        const inputs = host.querySelectorAll(`[data-k^="${k}.${arr.length - 1}"]`); if (inputs[0]) { inputs[0].focus(); inputs[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      } else if (act === 'del') {
        const r = arr[i]; const empty = typeof r === 'string' ? !r.trim() : !Object.values(r).some(v => String(v).trim());
        if (!empty && !confirm('Remove this item?')) return;
        arr.splice(i, 1); markDirty(); renderNav(); renderMain(true);
      } else if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1; [arr[i], arr[j]] = [arr[j], arr[i]]; markDirty(); renderMain(true);
      } else if (act === 'preview') opts.onPreview(JSON.parse(JSON.stringify(st.c)));
      else if (act === 'close') { if (st.dirty && !confirm('You have unsaved changes to this case. Leave without saving?')) return; opts.onDirty && opts.onDirty(false); opts.onClose(); }
      else if (act === 'save') save();
    };
    async function save() {
      const problems = [];
      if (!String(st.c.title || '').trim()) problems.push('a case title');
      if (!String(st.c.patient.name || '').trim()) problems.push('the patient\'s name');
      if (problems.length) { opts.toast('Add ' + problems.join(' and ') + ' before saving.', 'err'); return; }
      st.saving = true; setState();
      try {
        const r = await opts.onSave(JSON.parse(JSON.stringify(st.c)));
        st.c.id = r.id; st.c.updatedAt = r.updatedAt; st.dirty = false; opts.onDirty && opts.onDirty(false);
        const warn = [];
        if (!st.c.cards.length) warn.push('no data cards');
        if (st.c.auditRecord.length < 10) warn.push(`${st.c.auditRecord.length} audit entries (10+ recommended)`);
        opts.toast(warn.length ? 'Saved. Note: ' + warn.join(', ') + '.' : 'Case saved', warn.length ? 'info' : 'ok');
      } catch (err) { opts.toast(err.message, 'err'); }
      finally { st.saving = false; setState(); }
    }
    active = { host, save };
    shell();
    return { get dirty() { return st.dirty; } };
  }

  window.CaseEditor = { open, SECTIONS };
})();
