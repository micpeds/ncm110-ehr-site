/* Shared EHR renderer used by the student app (editable) and the
   instructor review screen (read-only). */
(function () {
  const C = window.CASE;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ---------------- data model ---------------- */
  function blankData() {
    const plan = () => ({ outcome: '', smart: { S: false, M: false, A: false, R: false, T: false }, ints: Array.from({ length: 6 }, () => ({ text: '', type: '', rat: '', order: '' })) });
    const flow = {};
    C.flowsheetRows.forEach(r => flow[r] = { value: '', unit: '', site: '', flag: '', card: '' });
    return {
      v: 1,
      group: { groupNo: '', section: '', date: 'Day 1', members: C.roles.map(role => ({ role, name: '', exit: ['', '', '', ''] })) },
      cards: C.cards.map(() => ({ cat: '', cluster: '', just: '' })),
      clusterProblems: Object.fromEntries(C.clusters.map(k => [k, ''])),
      flow,
      flowFiled: null,
      note: { datetime: '', text: '', signature: '' },
      dx: Array.from({ length: 7 }, () => ({ type: '', p: '', e: '', s: '', cards: '', why: '' })),
      plans: [plan(), plan(), plan(), plan()],
      impl: [blankImpl(), blankImpl(), blankImpl()],
      evals: [blankEval(), blankEval()],
      audit: Array.from({ length: 15 }, () => ({ loc: '', wrong: '', type: '', harm: '', correct: '' })),
      checklist: C.checklist.map(() => ({ done: false, initials: '' })),
      signed: null,
      trail: []
    };
  }
  function blankImpl() { return { time: '', action: '', dx: '', response: '', card: '', initials: '' }; }
  function blankEval() { return { dx: '', outcome: '', time: '', value: '', judgment: '', plan: '', revision: '' }; }

  // Fill any missing keys (forward compatibility with saved drafts)
  function normalize(d) {
    const b = blankData();
    if (!d || typeof d !== 'object') return b;
    const merge = (t, s) => {
      if (Array.isArray(t)) { if (!Array.isArray(s)) return t; return s.map((x, i) => { const tt = t[i] !== undefined ? t[i] : t[0]; return tt === undefined ? x : merge(tt, x); }); }
      if (t && typeof t === 'object') { const o = Object.assign({}, t); if (s && typeof s === 'object') Object.keys(s).forEach(k => { o[k] = k in t ? merge(t[k], s[k]) : s[k]; }); return o; }
      return s === undefined ? t : s;
    };
    const out = merge(b, d);
    // fixed-length arrays must keep their length
    if (out.cards.length < C.cards.length) out.cards = out.cards.concat(b.cards.slice(out.cards.length));
    if (out.checklist.length < C.checklist.length) out.checklist = out.checklist.concat(b.checklist.slice(out.checklist.length));
    out.trail = Array.isArray(d.trail) ? d.trail : [];
    out.signed = d.signed || null;
    return out;
  }

  /* ---------------- path helpers ---------------- */
  function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, path, val) {
    const ks = path.split('.'); let a = o;
    for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null) a[ks[i]] = {}; a = a[ks[i]]; }
    a[ks[ks.length - 1]] = val;
  }

  /* ---------------- lint rules ---------------- */
  const TIME_RE = /^([01]\d|2[0-3])[0-5]\d\s?H$/;
  function cardTime(n) { const m = /^(\d{4}) H/.exec(C.cards[n - 1] || ''); return m ? m[1] : null; }
  function lintText(s, kind) {
    const w = [];
    if (!s) return w;
    if (/\bQO?D\b/.test(s)) w.push('"QD/QOD" is a do-not-use abbreviation — write "once daily" / "every other day".');
    if (/\d\s*(U|IU)\b/.test(s)) w.push('"U/IU" is a do-not-use abbreviation — write "units".');
    if (/\b\d+\.0\b(?!\.)/.test(s)) w.push('Trailing zero found (e.g., 500.0) — write 500.');
    if (/(^|[\s(])\.\d/.test(s)) w.push('Leading decimal without zero (e.g., .5) — write 0.5.');
    if (/\b(demanding|uncooperative|difficult|lazy|stubborn|rude|non-?compliant|manipulative|attention[- ]seeking|complain(s|ing|er))\b/i.test(s)) w.push('Judgmental language — describe behaviour objectively.');
    if (kind === 'E' && /\b(pneumonia|cap\b|infection|sepsis|copd|diabetes|hypertension|consolidation)\b/i.test(s)) w.push('E looks like a medical diagnosis — use a nurse-treatable cause.');
    return w;
  }
  function lintTime(s) {
    if (!s) return [];
    return TIME_RE.test(s.trim()) ? [] : ['Use 24-hour time with H, e.g., 0815 H.'];
  }
  function wordCount(s) { return (s || '').trim().split(/\s+/).filter(Boolean).length; }

  function dxStatement(d) {
    if (!d || !d.p) return '';
    const P = d.p.trim();
    if (/^risk/i.test(d.type || '')) {
      const p2 = /^risk for/i.test(P) ? P : 'Risk for ' + P.charAt(0).toLowerCase() + P.slice(1);
      return p2 + (d.s ? ' as evidenced by risk factors: ' + d.s.trim() : '');
    }
    let st = P;
    if (d.e) st += ' related to ' + d.e.trim();
    if (d.s) st += ' as evidenced by ' + d.s.trim();
    return st;
  }

  /* ---------------- progress ---------------- */
  function progress(d) {
    const filledFlow = C.flowsheetRows.filter(r => d.flow[r] && d.flow[r].value.trim()).length;
    const dxN = d.dx.filter(x => x.p.trim()).length;
    const planOk = i => { const p = d.plans[i]; return p.outcome.trim() && p.ints.filter(x => x.text.trim()).length >= 4; };
    const membersNamed = d.group.members.filter(m => m.name.trim());
    const exitDone = membersNamed.filter(m => m.exit.every(a => a.trim())).length;
    return {
      summary: { done: (d.group.groupNo && membersNamed.length) ? 1 : 0, of: 1 },
      cards: { done: d.cards.filter(c => c.cat && c.cluster).length, of: C.cards.length },
      flowsheet: { done: filledFlow, of: C.flowsheetRows.length },
      note: { done: Math.min(wordCount(d.note.text), 80), of: 80 },
      dx: { done: Math.min(dxN, 4), of: 4 },
      careplan: { done: (planOk(0) ? 1 : 0) + (planOk(1) ? 1 : 0), of: 2 },
      impl: { done: Math.min(d.impl.filter(x => x.action.trim()).length, 1), of: 1 },
      eval: { done: Math.min(d.evals.filter(x => x.value.trim()).length, 1), of: 1 },
      audit: { done: Math.min(d.audit.filter(x => x.wrong.trim()).length, 10), of: 10 },
      sign: { done: d.checklist.filter(x => x.done).length, of: C.checklist.length },
      exit: { done: exitDone, of: Math.max(membersNamed.length, 1) }
    };
  }

  /* ---------------- tabs ---------------- */
  const TABS = [
    { id: 'summary', label: 'Patient Summary', icon: 'home', sub: 'Start here' },
    { section: 'Chart Review' },
    { id: 'orders', label: 'Orders (CPOE)', icon: 'orders', sub: 'Reference' },
    { id: 'labs', label: 'Results Review', icon: 'labs', sub: 'Labs & imaging' },
    { id: 'mar', label: 'MAR', icon: 'mar', sub: 'Medication schedule' },
    { section: 'Assessment' },
    { id: 'cards', label: 'Data Review', icon: 'cards', sub: 'Task 1' },
    { id: 'flowsheet', label: 'Flowsheet', icon: 'vitals', sub: 'Task 2a' },
    { id: 'note', label: 'Nursing Notes', icon: 'note', sub: 'Task 2b' },
    { section: 'Planning' },
    { id: 'dx', label: 'Nursing Diagnoses', icon: 'dx', sub: 'Task 3a' },
    { id: 'careplan', label: 'Care Plan', icon: 'plan', sub: 'Task 3b' },
    { section: 'Implementation' },
    { id: 'impl', label: 'Intervention Log', icon: 'impl', sub: 'Task 4a' },
    { id: 'eval', label: 'Evaluation', icon: 'eval', sub: 'Task 4b' },
    { section: 'Quality' },
    { id: 'audit', label: 'Chart Audit', icon: 'audit', sub: 'Task 5' },
    { id: 'sign', label: 'Sign & Submit', icon: 'sign', sub: 'Checklist' },
    { id: 'exit', label: 'Exit Ticket', icon: 'exit', sub: 'Individual' },
    { id: 'results', label: 'Results', icon: 'results', sub: 'Rubric' }
  ];

  const ICONS = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    orders: 'M9 3h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2V4a1 1 0 0 1 1-1zm0 2v2h6V5zM8 11h8M8 15h6',
    cards: 'M4 5h11v14H4zM15 8h5v11h-5M7 9h5M7 12h5M7 15h3',
    vitals: 'M3 12h4l2-5 4 10 2-5h6',
    note: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6',
    dx: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v4l3 2',
    plan: 'M4 6h16M4 12h10M4 18h7M17 15l2 2 3-4',
    impl: 'M14 4l6 6-9 9H5v-6zM12 6l6 6',
    eval: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
    audit: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4-4M8 11l2 2 4-4',
    sign: 'M3 17c3 0 4-6 6-6s1 5 3 5 3-3 4-3 2 2 5 2M3 21h18',
    exit: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
    results: 'M8 21h8M12 17v4M6 3h12v5a6 6 0 0 1-12 0zM6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    x: 'M6 6l12 12M18 6L6 18', check: 'M5 12.5l4.5 4.5L19 7', menu: 'M4 7h16M4 12h16M4 17h16', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    left: 'M19 12H5M11 6l-6 6 6 6', right: 'M5 12h14M13 6l6 6-6 6', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    building: 'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3',
    pen: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
    key: 'M14.5 4a5.5 5.5 0 1 1-4.6 8.5L4 18.5V21h3v-2h2v-2h2l1.4-1.4A5.5 5.5 0 0 1 14.5 4zM16 8h.01',
    caps: 'M12 4l7 8h-4v5H9v-5H5zM9 20h6',
    labs: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7 15h10',
    mar: 'M4 14l6-6a3.5 3.5 0 0 1 5 5l-6 6a3.5 3.5 0 0 1-5-5zM7 11l5 5',
    warn: 'M12 3l10 18H2zM12 10v5M12 18v.5'
  };
  const icon = (n, cls) => `<svg class="ico ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n] || ''}"/></svg>`;

  /* ================================================================ */
  function create(root, opts) {
    const st = {
      data: normalize(opts.data),
      ro: !!opts.readOnly,
      roNote: opts.roNote || '',
      tab: opts.tab || 'summary',
      cpPriority: 0,
      task5Unlocked: !!opts.task5Unlocked,
      grades: opts.grades || null,
      user: opts.user || '',
      onChange: opts.onChange || (() => {}),
      onAction: opts.onAction || (() => {})
    };

    const D = () => st.data;
    const val = p => { const v = getPath(D(), p); return v == null ? '' : v; };
    const dis = () => st.ro ? 'disabled' : '';

    /* ---- field builders ---- */
    // Read-only charts render values as plain text (easier to read and grade)
    const roVal = (v, o = {}, multi) => `<div class="ro-val ${multi ? 'multi' : ''} ${o.cls || ''}">${String(v).trim() ? esc(v) : '<span class="ro-empty">—</span>'}</div>`;
    const inp = (p, o = {}) => st.ro ? roVal(val(p), o) + (o.lint ? lintBox(p, o.lint) : '') : `<input class="f ${o.cls || ''}" data-path="${p}" value="${esc(val(p))}" placeholder="${esc(o.ph || '')}" ${o.lint ? `data-lint="${o.lint}"` : ''} ${o.attrs || ''}>${o.lint ? lintBox(p, o.lint) : ''}`;
    const ta = (p, o = {}) => st.ro ? roVal(val(p), o, true) + (o.lint ? lintBox(p, o.lint) : '') : `<textarea class="f ${o.cls || ''}" data-path="${p}" rows="${o.rows || 2}" placeholder="${esc(o.ph || '')}" ${o.lint ? `data-lint="${o.lint}"` : ''}>${esc(val(p))}</textarea>${o.lint ? lintBox(p, o.lint) : ''}`;
    const sel = (p, options, o = {}) => {
      const v = val(p);
      if (st.ro) { const hit = options.find(x => String(typeof x === 'object' ? x.v : x) === String(v)); return roVal(hit ? (typeof hit === 'object' ? hit.l : hit) : '', o) + (o.lint ? lintBox(p, o.lint) : ''); }
      return `<select class="f ${o.cls || ''}" data-path="${p}" ${o.lint ? `data-lint="${o.lint}"` : ''} ${dis()}><option value="">${esc(o.ph || '—')}</option>${options.map(x => { const ov = typeof x === 'object' ? x.v : x; const ol = typeof x === 'object' ? x.l : x; return `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>${o.lint ? lintBox(p, o.lint) : ''}`;
    };
    const chk = (p, label) => `<label class="chk"><input type="checkbox" data-path="${p}" ${val(p) ? 'checked' : ''} ${dis()}><span class="box"></span>${label ? `<span>${label}</span>` : ''}</label>`;
    const lintBox = (p, kind) => `<div class="lint" data-lint-for="${p}">${lintHtml(p, kind)}</div>`;
    function lintHtml(p, kind) {
      const v = val(p);
      let w = [];
      if (kind === 'time') w = lintTime(v);
      else if (kind === 'text' || kind === 'E') w = lintText(v, kind);
      else if (kind === 'impl-time') {
        w = lintTime(v);
        const i = +p.split('.')[1]; const row = D().impl[i];
        const ct = row && row.card ? cardTime(+row.card) : null;
        if (!w.length && v && ct && v.replace(/\D/g, '') !== ct) w.push(`Card ${row.card} shows ${ct} H — chart the time the care was actually done.`);
      }
      return w.map(x => `<span>${icon('warn')}${esc(x)}</span>`).join('');
    }
    const cardOpts = C.cards.map((_, i) => ({ v: i + 1, l: '#' + (i + 1) }));

    /* ---- header pieces ---- */
    function head(title, task, desc, extra) {
      return `<div class="pg-head"><div><div class="crumb">${esc(task)}</div><h1>${esc(title)}</h1>${desc ? `<p class="pg-desc">${desc}</p>` : ''}</div>${extra || ''}</div>`;
    }
    function meter(done, of, label) {
      const pct = of ? Math.round(done / of * 100) : 0;
      return `<div class="meter" title="${done} of ${of}"><div class="meter-top"><span>${esc(label)}</span><b>${done} / ${of}</b></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
    }

    /* ================= VIEWS ================= */
    const V = {};

    V.summary = () => {
      const g = D().group; const pr = progress(D());
      const tiles = TABS.filter(t => t.id && pr[t.id]).map(t => {
        const p = pr[t.id]; const pct = Math.round(p.done / p.of * 100);
        return `<button class="tile" data-goto="${t.id}"><div class="tile-ico">${icon(t.icon)}</div><div class="tile-body"><b>${esc(t.label)}</b><small>${esc(t.sub)}</small><div class="bar sm"><i style="width:${pct}%"></i></div></div><span class="pct ${pct === 100 ? 'ok' : ''}">${pct}%</span></button>`;
      }).join('');
      const named = g.members.filter(m => m.name.trim()).length;
      const steps = st.ro ? '' : `<section class="card onboard ${named ? 'compact' : ''}">
        <ol class="ob-steps">
          <li class="${named ? 'done' : 'now'}"><b>Enter your care team</b><span>Type each member's name below.</span></li>
          <li class="${named && st.user && !/^Group/.test(st.user) ? 'done' : named ? 'now' : ''}"><b>Choose who is documenting</b><span>Top bar, beside <i>Lock</i>. Every change is logged under that name.</span></li>
          <li class="${named ? 'now-soft' : ''}"><b>Work through the chart</b><span>Use the menu on the left or the <i>Next</i> button at the bottom of each page.</span></li>
          <li><b>Sign &amp; submit</b><span>Finish the checklist, then sign with your group PIN.</span></li>
        </ol></section>`;
      return head('Patient Summary', 'Start here', `Simulated EHR documentation lab. Client: <b>${esc(C.patient.name)}${C.patient.nickname ? ' ("' + esc(C.patient.nickname) + '")' : ''}</b>. Fictional case — treat as confidential health information.`) + steps + `
      <div class="grid2">
        <section class="card">
          <h2>Care team (group information)</h2>
          <div class="form-grid">
            <label>Group No.${inp('group.groupNo', { ph: 'e.g., 3' })}</label>
            <label>Section${inp('group.section', { ph: 'e.g., BSN 3-A' })}</label>
            <label>Date${inp('group.date', { ph: 'Day 1' })}</label>
          </div>
          <table class="tbl compact"><thead><tr><th style="width:38%">Role</th><th>Name</th>${st.ro ? '' : '<th style="width:36px"></th>'}</tr></thead><tbody>
          ${g.members.map((m, i) => `<tr><td>${i < C.roles.length - 1 ? `<b>${esc(m.role)}</b>` : inp(`group.members.${i}.role`, { ph: 'Role' })}</td><td>${inp(`group.members.${i}.name`, { ph: 'Full name' })}</td>${st.ro ? '' : `<td>${i >= C.roles.length ? `<button class="icon-btn" data-act="delMember" data-i="${i}" title="Remove" aria-label="Remove member">${icon('x', 'sm')}</button>` : ''}</td>`}</tr>`).join('')}
          </tbody></table>
          ${st.ro ? '' : '<button class="btn ghost sm" data-act="addMember">+ Add member</button>'}
        </section>
        <section class="card">
          <h2>Documentation progress</h2>
          <div class="tiles">${tiles}</div>
        </section>
      </div>
      <section class="card rules">
        <h2>Charting rules</h2>
        <ul class="rule-list">
          <li><b>Editable fields</b> are white. Grey panels are reference data protected by your instructor. Some fields (diagnosis statements, counters) calculate automatically.</li>
          <li><b>Approved abbreviations only</b> — no QD, no U, no trailing zeros. The EHR flags these as you type.</li>
          <li><b>Never chart care before it is done.</b> Use objective, respectful language.</li>
          <li><b>Time stamps:</b> 24-hour time with H (e.g., 0815 H). Use Day 1 for the date.</li>
          <li><b>Audit trail:</b> every change is logged with the logged-in user and time, like a real EHR.</li>
          <li><b>RA 10173 (Data Privacy Act):</b> do not screenshot, photograph, or share this record outside class.</li>
        </ul>
      </section>`;
    };

    V.orders = () => {
      const p = C.patient;
      const rows = [['Name', p.nickname ? `${p.name} ("${p.nickname}")` : p.name], ['Hospital No.', p.hospNo], ['Date of birth', `${p.dob}${p.age ? ' (' + p.age.replace(/ y$/, ' years') + ')' : ''}`], ['Sex', p.sex], ['Ward / Bed', p.location], ['Attending physician', p.attending], ['Admitting diagnosis', p.dx], ['Allergy', `<span class="pill red">${esc(p.allergy)}</span>`], ['Weight / Height', `${p.weight} / ${p.height}`], ['Admission', p.admission], ['Context', p.context]];
      return head('Orders & Demographics', 'Reference – read only', 'Active physician orders entered through CPOE. Use these to link dependent interventions.') + `
      <div class="grid2 wide-right">
        <section class="card ref"><h2>Client banner</h2><dl class="dl">${rows.map(r => `<dt>${r[0]}</dt><dd>${r[0] === 'Allergy' ? r[1] : esc(r[1])}</dd>`).join('')}</dl></section>
        <section class="card ref"><h2>Physician orders (CPOE)</h2>
          <table class="tbl"><thead><tr><th style="width:44px">No.</th><th style="width:120px">Category</th><th>Order</th><th style="width:100px">Status</th></tr></thead><tbody>
          ${C.orders.length ? '' : '<tr><td colspan="4" class="empty">No orders in this case.</td></tr>'}${C.orders.map(o => `<tr><td class="num">${o.no}</td><td><span class="tag">${esc(o.cat)}</span></td><td>${esc(o.text)}</td><td><span class="pill ${o.status === 'Completed' ? 'grey' : 'green'}">${esc(o.status)}</span></td></tr>`).join('')}
          </tbody></table>
          <p class="hint">Ordered by ${esc(p.attending)} · Day 1 · Verified by pharmacy</p>
        </section>
      </div>`;
    };

    V.labs = () => {
      const panels = [];
      C.labs.forEach(r => { let p = panels.find(x => x.panel === r.panel); if (!p) { p = { panel: r.panel, collected: r.collected, status: r.status, rows: [] }; panels.push(p); } p.rows.push(r); });
      return head('Results Review', 'Chart review – read only', 'Laboratory and imaging results for this encounter. Abnormal values are flagged.') + `
      ${panels.map(p => `<section class="card flush"><div class="sec-bar"><b>${esc(p.panel || 'Laboratory')}</b>${p.collected ? `<span>Collected ${esc(p.collected)}</span>` : ''}<span class="pill ${/final/i.test(p.status) ? 'green' : 'amber'}">${esc(p.status || 'Final')}</span></div>
        <table class="tbl lab-tbl"><thead><tr><th>Test</th><th style="width:120px">Result</th><th style="width:40px">Flag</th><th style="width:110px">Units</th><th style="width:140px">Reference range</th></tr></thead><tbody>
        ${p.rows.map(r => `<tr class="${r.flag ? 'lab-abn' : ''}"><td>${esc(r.test)}</td><td class="lab-val">${esc(r.value)}</td><td>${r.flag ? `<span class="lab-flag">${esc(r.flag)}</span>` : ''}</td><td>${esc(r.unit)}</td><td class="muted">${esc(r.ref)}</td></tr>`).join('')}
        </tbody></table></section>`).join('')}
      ${C.imaging.map(im => `<section class="card flush"><div class="sec-bar"><b>${esc(im.study)}</b><span>${esc(im.done)}</span><span class="pill ${/final/i.test(im.status || 'Final') ? 'green' : 'amber'}">${esc(im.status || 'Final')}</span></div>
        <div class="report"><p><span class="lbl">Findings</span>${esc(im.findings)}</p><p><span class="lbl">Impression</span>${esc(im.impression)}</p><p class="muted small">Electronically signed by Radiology</p></div></section>`).join('')}
      ${!panels.length && !C.imaging.length ? '<section class="card empty">No results for this encounter.</section>' : ''}`;
    };

    V.mar = () => {
      const hours = ['0800', '0900', '1000', '1100', '1200', '1300', '1400', '1500'];
      return head('Medication Administration Record', 'Chart review – Day 1 schedule', 'Scheduled, PRN and continuous medications from active orders. Document what you actually gave in the <b>Intervention Log</b>.') + `
      <div class="callout danger">${icon('warn')}<div><b>Allergy:</b> ${esc(C.patient.allergy)}. Check every medication against the allergy before giving.</div></div>
      <section class="card flush"><div class="tbl-wrap"><table class="tbl mar-tbl"><thead><tr><th style="min-width:230px">Medication</th>${hours.map(h => `<th class="hr">${h}</th>`).join('')}</tr></thead><tbody>
      ${C.mar.length ? '' : '<tr><td colspan="9" class="empty">No medications in this case.</td></tr>'}${C.mar.map(m => `<tr><td><b>${esc(m.med)}</b> ${esc(m.dose)} ${esc(m.route)}<br><small class="muted">${esc(m.freq)}${m.order ? ' · Order ' + esc(m.order) : ''}</small></td>${hours.map(h => `<td class="hr">${m.kind === 'Continuous' ? '<span class="mar-cont"></span>' : m.kind === 'PRN' ? '<span class="mar-prn">PRN</span>' : m.dueList.includes(h) ? '<span class="mar-due">Due</span>' : ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></section>
      <p class="hint" style="margin-top:0">Legend: <span class="mar-due">Due</span> scheduled dose · <span class="mar-prn">PRN</span> as needed · <span class="mar-cont" style="display:inline-block;width:40px"></span> continuous infusion</p>`;
    };

    V.cards = () => {
      const d = D();
      const filter = st.cardFilter || 'all';
      const rows = C.cards.map((txt, i) => {
        const c = d.cards[i];
        if (filter === 'todo' && c.cat && c.cluster) return '';
        return `<tr class="${c.cat && c.cluster ? 'done' : ''}"><td class="num">${i + 1}</td><td class="card-text">${esc(txt)}</td><td>${sel(`cards.${i}.cat`, C.categories, { ph: 'Category…' })}</td><td>${sel(`cards.${i}.cluster`, C.clusters, { ph: '—', cls: 'narrow' })}</td><td>${ta(`cards.${i}.just`, { rows: 1, ph: 'Justify…' })}</td></tr>`;
      }).join('');
      const p = progress(d).cards;
      return head('Data Review', 'Task 1 · Sort and cluster the data', 'Choose a category and a cluster for every data card. A card can fit more than one category — explain your choice in the justification.',
        `<div class="head-side">${meter(p.done, p.of, 'Cards categorized')}<div class="seg" role="tablist"><button class="${filter === 'all' ? 'on' : ''}" data-act="cardFilter" data-v="all">All</button><button class="${filter === 'todo' ? 'on' : ''}" data-act="cardFilter" data-v="todo">To do</button></div></div>`) + `
      <section class="card flush"><div class="tbl-wrap"><table class="tbl cards-tbl"><thead><tr><th style="width:44px">Card</th><th>Data</th><th style="width:190px">Category</th><th style="width:76px">Cluster</th><th style="width:28%">Justification</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">${C.cards.length ? 'All cards are sorted.' : 'This case has no data cards yet.'}</td></tr>`}</tbody></table></div></section>
      <section class="card"><h2>Clusters</h2><p class="hint">Name the problem each cluster suggests. Cards are listed automatically from your choices above.</p>
        <table class="tbl"><thead><tr><th style="width:60px">Cluster</th><th style="width:40%">Problem this cluster suggests</th><th>Cards (auto-listed)</th></tr></thead><tbody>
        ${C.clusters.map(k => `<tr><td class="num"><span class="cl-badge">${k}</span></td><td>${inp(`clusterProblems.${k}`, { ph: 'e.g., Impaired gas exchange' })}</td><td data-derive="cluster" data-k="${k}">${clusterList(k)}</td></tr>`).join('')}
        </tbody></table></section>`;
    };
    function clusterList(k) {
      const ids = D().cards.map((c, i) => c.cluster === k ? i + 1 : null).filter(Boolean);
      return ids.length ? ids.map(n => `<span class="chip" title="${esc(C.cards[n - 1])}">#${n}</span>`).join('') : '<span class="muted">—</span>';
    }

    V.flowsheet = () => {
      const ff = D().flowFiled;
      return head('Flowsheet', 'Task 2a · Vital signs and assessment — Day 1, ' + C.flowTime, 'Enter each value exactly as on the data card, with units and site. Flag each as Normal or Abnormal and cite the source card. Click <b>File</b> when the column is complete.',
        `<div class="head-side"><span class="filed" data-derive="filed">${filedHtml()}</span>${st.ro ? '' : '<button class="btn primary sm" data-act="fileFlow">File</button>'}</div>`) + `
      <section class="card flush"><div class="sec-bar"><b>Vital Signs / Admission Assessment</b><span>Day 1 · ${esc(C.flowTime)} column</span></div><div class="tbl-wrap"><table class="tbl flow"><thead><tr><th style="width:190px">Parameter</th><th>Value</th><th style="width:110px">Unit</th><th style="width:150px">Site / Device</th><th style="width:120px">Flag</th><th style="width:96px">Source card</th></tr></thead><tbody>
      ${C.flowsheetRows.map(r => { const b = `flow.${r}`; const f = val(b + '.flag'); return `<tr class="${f === 'Abnormal' ? 'abn' : ''}" data-row="${esc(r)}"><th class="param">${esc(r)}</th><td>${inp(b + '.value', { lint: 'text' })}</td><td>${inp(b + '.unit')}</td><td>${inp(b + '.site')}</td><td>${sel(b + '.flag', ['Normal', 'Abnormal'], { cls: 'flag' })}</td><td>${sel(b + '.card', cardOpts, { cls: 'narrow' })}</td></tr>`; }).join('')}
      </tbody></table></div></section>`;
    };

    function filedHtml() { const f = D().flowFiled; return f ? `${icon('sign', 'sm')} Filed by ${esc(f.by)} · ${hm(f.at)} H` : '<span class="muted">Not yet filed</span>'; }
    const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0'); };

    V.note = () => {
      const wc = wordCount(val('note.text'));
      return head('Nursing Notes', 'Task 2b · Admission nursing note', 'Write 80–120 words. Objective language, approved abbreviations, client\'s words in quotation marks. End with name, title, date and time.') + `
      <section class="card note-card">
        <div class="note-meta">
          <label>Note type<input class="f" value="Admission Nursing Note" disabled></label>
          <label>Date / Time${inp('note.datetime', { ph: 'Day 1, 0815 H' })}</label>
          <label>Author${inp('note.signature', { ph: 'Name, RN (Student)' })}</label>
        </div>
        <div class="editor">
          ${st.ro ? '' : `<div class="smarttext"><span>SmartText:</span><button data-act="noteIns" data-v="time" title="Insert Day 1 + current time">Time stamp</button><button data-act="noteIns" data-v="late" title="Late entry label">Late entry</button><button data-act="noteIns" data-v="quote" title="Insert quotation marks for client's words">"Client words"</button><button data-act="noteIns" data-v="sig" title="Insert signature line">Signature</button></div>`}
          <div class="editor-bar"><span>Narrative</span><span class="wc ${wc >= 80 && wc <= 120 ? 'ok' : wc > 120 ? 'over' : ''}" data-derive="wc">${wc} words · target 80–120</span></div>
          ${ta('note.text', { rows: 12, cls: 'note-ta', ph: 'Day 1, 0800 H. Received client…', lint: 'text' })}
        </div>
      </section>`;
    };

    V.dx = () => {
      return head('Nursing Diagnoses', 'Task 3a · Prioritized nursing diagnoses (at least 4)', 'Type P, E and S separately. For a Risk diagnosis leave E blank and list risk factors in S. The full statement builds itself.') + `
      <div class="dx-list">
      ${D().dx.map((x, i) => `<section class="card dx-card ${x.p ? 'filled' : ''}"><div class="dx-rank">${i + 1}</div><div class="dx-body">
        <div class="form-grid dx-grid">
          <label>Type${sel(`dx.${i}.type`, C.dxTypes)}</label>
          <label class="span2">P – Problem (NANDA-I label)${inp(`dx.${i}.p`, { ph: 'e.g., Impaired gas exchange' })}</label>
          <label>Card nos.${inp(`dx.${i}.cards`, { ph: 'e.g., 4, 6, 7' })}</label>
          <label class="span2">E – Related to (nurse-treatable)${ta(`dx.${i}.e`, { rows: 2, lint: 'E' })}</label>
          <label class="span2">S – As evidenced by (cues)${ta(`dx.${i}.s`, { rows: 2, lint: 'text' })}</label>
          <label class="span4">Why this priority?${inp(`dx.${i}.why`, { ph: 'ABC / Maslow rationale' })}</label>
        </div>
        <div class="statement" data-derive="dx" data-i="${i}">${dxStmtHtml(i)}</div>
      </div></section>`).join('')}
      </div>
      <div class="callout">${icon('warn')}<div><b>Self-check:</b> Is any E entry a medical diagnosis (e.g., pneumonia)? Does every cue in S appear on a data card? Did you rank by ABC and Maslow?</div></div>`;
    };
    function dxStmtHtml(i) { const s = dxStatement(D().dx[i]); return s ? `<span class="lbl">Full statement</span>${esc(s)}` : '<span class="lbl">Full statement</span><span class="muted">Builds automatically from P, E and S.</span>'; }

    V.careplan = () => {
      const pi = st.cpPriority; const b = `plans.${pi}`;
      const pl = D().plans[pi];
      const smartKeys = [['S', 'Specific'], ['M', 'Measurable'], ['A', 'Attainable / Action-oriented'], ['R', 'Relevant / Realistic'], ['T', 'Time-framed']];
      const dxS = dxStatement(D().dx[pi]);
      const tabs = [0, 1, 2, 3].map(i => { const p = D().plans[i]; const n = p.ints.filter(x => x.text.trim()).length; return `<button class="${i === pi ? 'on' : ''}" data-act="cpTab" data-v="${i}">Priority ${i + 1}${i > 1 ? ' <small>(optional)</small>' : ''}<em class="${p.outcome && n >= 4 ? 'ok' : ''}">${n}</em></button>`; }).join('');
      return head('Care Plan', 'Task 3b · SMART outcomes and interventions', 'Complete for Priorities 1 and 2 (3 and 4 optional). Tick each SMART element only if your outcome truly contains it. Give at least 4 interventions of different types.') + `
      <div class="subtabs">${tabs}</div>
      <section class="card">
        <div class="cp-dx"><span class="lbl">Nursing diagnosis (from Priority ${pi + 1})</span>${dxS ? esc(dxS) : '<span class="muted">Enter Priority ' + (pi + 1) + ' in Nursing Diagnoses first.</span>'}</div>
        <label class="blk">SMART outcome<div class="prefix-wrap"><span class="prefix">The client will</span>${ta(b + '.outcome', { rows: 2, ph: 'maintain SpO2 at 92% or higher on 2–4 L/min nasal cannula within 8 hours…', lint: 'text' })}</div></label>
        <div class="smart">${smartKeys.map(([k, l]) => `<div class="smart-item ${pl.smart[k] ? 'on' : ''}">${chk(`${b}.smart.${k}`, `<b>${k}</b> ${l}`)}</div>`).join('')}</div>
      </section>
      <section class="card flush"><div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:40px">#</th><th>Nursing intervention</th><th style="width:150px">Type</th><th>Rationale</th><th style="width:130px">Linked order</th></tr></thead><tbody>
      ${pl.ints.map((x, i) => `<tr><td class="num">${i + 1}</td><td>${ta(`${b}.ints.${i}.text`, { rows: 2, lint: 'text' })}</td><td>${sel(`${b}.ints.${i}.type`, C.interventionTypes)}</td><td>${ta(`${b}.ints.${i}.rat`, { rows: 2 })}</td><td>${sel(`${b}.ints.${i}.order`, C.orders.map(o => ({ v: o.no, l: 'Order ' + o.no + ' – ' + o.cat })), { ph: 'None' })}</td></tr>`).join('')}
      </tbody></table></div></section>`;
    };

    const dxOpts = () => D().dx.map((x, i) => x.p ? { v: i + 1, l: `P${i + 1} – ${x.p}` } : null).filter(Boolean);

    V.impl = () => {
      const rows = D().impl;
      const order = timeOrderOk(rows);
      return head('Intervention Log', 'Task 4a · Implementation log (time order)', 'Chart only actions that a data card shows were actually done. Never chart ahead of care.',
        st.ro ? '' : `<div class="head-side"><button class="btn ghost sm" data-act="sortImpl">Sort by time</button><button class="btn sm" data-act="addImpl">+ Add entry</button></div>`) + `
      ${order ? '' : `<div class="callout warn">${icon('warn')}<div>Entries are not in time order. Use <b>Sort by time</b>.</div></div>`}
      <section class="card flush"><div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:110px">Time (H)</th><th>Action done</th><th style="width:160px">Linked dx</th><th>Client response</th><th style="width:90px">Card</th><th style="width:80px">Initials</th>${st.ro ? '' : '<th style="width:36px"></th>'}</tr></thead><tbody>
      ${rows.map((x, i) => `<tr><td>${inp(`impl.${i}.time`, { ph: '0815 H', lint: 'impl-time' })}</td><td>${ta(`impl.${i}.action`, { rows: 2, lint: 'text' })}</td><td>${sel(`impl.${i}.dx`, dxOpts())}</td><td>${ta(`impl.${i}.response`, { rows: 2, lint: 'text' })}</td><td>${sel(`impl.${i}.card`, cardOpts, { cls: 'narrow' })}</td><td>${inp(`impl.${i}.initials`, { ph: 'AB' })}</td>${st.ro ? '' : `<td><button class="icon-btn" data-act="delRow" data-list="impl" data-i="${i}" title="Delete row" aria-label="Delete row">${icon('x', 'sm')}</button></td>`}</tr>`).join('') || '<tr><td colspan="7" class="empty">No entries yet.</td></tr>'}
      </tbody></table></div></section>`;
    };
    function timeOrderOk(rows) { const ts = rows.map(r => r.time.replace(/\D/g, '')).filter(t => t.length === 4); return ts.every((t, i) => i === 0 || t >= ts[i - 1]); }

    V.eval = () => {
      const outs = D().plans.map((p, i) => p.outcome ? { v: i + 1, l: `P${i + 1}: The client will ${p.outcome.slice(0, 70)}${p.outcome.length > 70 ? '…' : ''}` } : null).filter(Boolean);
      return head('Evaluation', 'Task 4b · Evaluation entries', 'Quote the time and the actual value. "Goal met" alone is not an evaluation.',
        st.ro ? '' : `<div class="head-side"><button class="btn sm" data-act="addEval">+ Add evaluation</button></div>`) + `
      <div class="eval-list">
      ${D().evals.map((x, i) => `<section class="card eval-card"><div class="eval-top"><span class="tag">Evaluation ${i + 1}</span>${st.ro ? '' : `<button class="icon-btn" data-act="delRow" data-list="evals" data-i="${i}" title="Delete" aria-label="Delete evaluation">${icon('x', 'sm')}</button>`}</div>
        <div class="form-grid eval-grid">
          <label>Dx priority${sel(`evals.${i}.dx`, dxOpts())}</label>
          <label class="span3">Outcome (from care plan)${sel(`evals.${i}.outcome`, outs)}</label>
          <label>Data time (H)${inp(`evals.${i}.time`, { ph: '1200 H', lint: 'time' })}</label>
          <label class="span3">Data value(s) quoted${inp(`evals.${i}.value`, { ph: 'SpO2 94% on 3 L/min; RR 22', lint: 'text' })}</label>
          <label>Judgment${sel(`evals.${i}.judgment`, C.judgments)}</label>
          <label>Plan${sel(`evals.${i}.plan`, C.plans)}</label>
          <label class="span2">Revision / comment${inp(`evals.${i}.revision`)}</label>
        </div>
        <div class="lint" data-derive="evalwarn" data-i="${i}">${evalWarn(i)}</div>
      </section>`).join('') || '<section class="card empty">No evaluations yet.</section>'}
      </div>`;
    };
    function evalWarn(i) { const x = D().evals[i]; if (x && x.judgment && (!x.value.trim() || !x.time.trim())) return `<span>${icon('warn')}A judgment needs a time-stamped value quoted as evidence.</span>`; return ''; }

    V.audit = () => {
      if (!st.task5Unlocked && !st.ro) {
        return head('Chart Audit', 'Task 5 · Audit the colleague\'s record', '') + `<section class="card locked">${icon('lock', 'big')}<h2>This activity is locked</h2><p>Your instructor will unlock the chart audit during class. This screen updates automatically once it is open.</p></section>`;
      }
      const n = D().audit.filter(x => x.wrong.trim()).length;
      return head('Chart Audit', 'Task 5 · Audit the colleague\'s record (' + C.auditNurse + ')', 'Compare with the data cards and orders. Find at least 10 errors. Click an entry to log it.',
        `<div class="head-side">${meter(Math.min(n, 10), 10, 'Errors logged')}<span class="count-big ${n >= 10 ? 'ok' : ''}" data-derive="auditN">${n}</span></div>`) + `
      <div class="grid2 audit-grid">
        <section class="card colleague"><div class="colleague-head"><div><b>Chart under review</b><small>Documented by ${esc(C.auditNurse)} · Day 1</small></div><span class="pill amber">Audit mode</span></div>
          <div class="audit-record">${C.auditRecord.map(r => `<button class="ar-row" data-act="auditPick" data-v="${r.id}" ${st.ro ? 'disabled' : ''}><span class="ar-id">${r.id}</span><span class="ar-sec">${esc(r.section)}</span><span class="ar-entry">${esc(r.entry)}</span></button>`).join('')}</div>
        </section>
        <section class="card help-card"><h2>How to correct an EHR error</h2><ol class="steps"><li>Do <b>not</b> delete the original entry.</li><li>Use the <b>correction or addendum</b> function.</li><li>State the <b>reason</b> for the correction.</li><li>Enter the <b>correct data</b>.</li><li>Keep the original visible in the <b>audit trail</b>.</li><li>Label <b>late entries</b> with the current time and the time of the event.</li></ol></section>
      </div>
      <section class="card flush"><div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:40px">#</th><th style="width:110px">Location</th><th>What is wrong</th><th style="width:190px">Type</th><th>Possible harm</th><th>Correct entry or action</th></tr></thead><tbody>
      ${D().audit.map((x, i) => `<tr data-audit-row="${i}"><td class="num">${i + 1}</td><td>${sel(`audit.${i}.loc`, C.auditRecord.map(r => ({ v: r.id, l: r.id + ' – ' + r.section })), { ph: '—' })}</td><td>${ta(`audit.${i}.wrong`, { rows: 2 })}</td><td>${sel(`audit.${i}.type`, C.auditErrorTypes)}</td><td>${ta(`audit.${i}.harm`, { rows: 2 })}</td><td>${ta(`audit.${i}.correct`, { rows: 2 })}</td></tr>`).join('')}
      </tbody></table></div></section>`;
    };

    V.sign = () => {
      const d = D(); const done = d.checklist.filter(x => x.done).length;
      const issues = validate();
      const signed = d.signed;
      return head('Sign & Submit', 'Pre-sign checklist', 'Tick each box only after checking the whole record. The Verifier initials each check.',
        `<div class="head-side">${meter(done, C.checklist.length, 'Checks completed')}</div>`) + `
      <section class="card flush"><table class="tbl checklist"><thead><tr><th style="width:64px">Done</th><th>Check</th><th style="width:150px">Verifier initials</th></tr></thead><tbody>
      ${C.checklist.map((t, i) => `<tr class="${d.checklist[i].done ? 'done' : ''}"><td>${chk(`checklist.${i}.done`)}</td><td>${esc(t)}</td><td>${inp(`checklist.${i}.initials`, { ph: 'AB' })}</td></tr>`).join('')}
      </tbody></table></section>
      <div class="grid2">
        <section class="card"><h2>Chart validation</h2><p class="hint">The EHR checks the record before it can be signed. Warnings do not block signing, but your instructor will see them.</p>
          <ul class="issues">${issues.length ? issues.map(x => `<li class="${x.level}"><span class="dot"></span><span>${esc(x.msg)}</span>${x.tab ? `<button class="link" data-goto="${x.tab}">Go</button>` : ''}</li>`).join('') : '<li class="ok"><span class="dot"></span>No problems found.</li>'}</ul>
        </section>
        <section class="card sign-card">${signed ? `<div class="signed-stamp">${icon('sign')}<div><b>Electronically signed</b><span>${esc(signed.by)}${signed.title ? ', ' + esc(signed.title) : ''}</span><small>${new Date(signed.at).toLocaleString()}</small></div></div><p class="hint">This record has been submitted to your instructor and is now read-only.</p>` :
          st.ro ? '<p class="muted">Not yet signed.</p>' :
          `<h2>Electronic signature</h2><p class="hint">Signing submits the whole record to your instructor. You can no longer edit it after signing (the Exit Ticket is included).</p>
          <button class="btn primary lg" data-act="openSign" ${done < C.checklist.length ? 'disabled' : ''}>${icon('sign')} Sign & submit record</button>
          ${done < C.checklist.length ? `<p class="muted small">Complete all ${C.checklist.length} checklist items to enable signing.</p>` : ''}`}
        </section>
      </div>`;
    };

    function validate() {
      const d = D(); const pr = progress(d); const out = [];
      const add = (level, msg, tab) => out.push({ level, msg, tab });
      if (!pr.summary.done) add('err', 'Group number and member names are missing.', 'summary');
      if (pr.cards.done < pr.cards.of) add('err', `${pr.cards.of - pr.cards.done} data card(s) not yet categorized/clustered.`, 'cards');
      if (pr.flowsheet.done < pr.flowsheet.of) add('err', `${pr.flowsheet.of - pr.flowsheet.done} flowsheet row(s) empty.`, 'flowsheet');
      const wc = wordCount(d.note.text);
      if (wc < 80 || wc > 120) add('warn', `Admission note is ${wc} words (target 80–120).`, 'note');
      if (!d.note.signature.trim()) add('warn', 'Admission note has no signature/title.', 'note');
      if (pr.dx.done < 4) add('err', `Only ${pr.dx.done} nursing diagnosis(es) — at least 4 required.`, 'dx');
      if (pr.careplan.done < 2) add('err', 'Care plan for Priorities 1 and 2 needs an outcome and 4+ interventions each.', 'careplan');
      if (!pr.impl.done) add('err', 'Intervention log is empty.', 'impl');
      if (!timeOrderOk(d.impl)) add('warn', 'Intervention log is not in time order.', 'impl');
      if (!pr.eval.done) add('err', 'No evaluation entries.', 'eval');
      if (d.evals.some(x => x.judgment && (!x.value.trim() || !x.time.trim()))) add('warn', 'An evaluation has a judgment without time-stamped data.', 'eval');
      const auditN = d.audit.filter(x => x.wrong.trim()).length;
      if (auditN < 10) add('warn', `Chart audit: ${auditN} error(s) logged (target 10 or more).`, 'audit');
      // lint scan across the record
      const texts = [];
      C.flowsheetRows.forEach(r => texts.push(['flowsheet', (d.flow[r] || {}).value]));
      texts.push(['note', d.note.text]);
      d.dx.forEach(x => texts.push(['dx', x.e], ['dx', x.s]));
      d.plans.forEach(p => { texts.push(['careplan', p.outcome]); p.ints.forEach(x => texts.push(['careplan', x.text])); });
      d.impl.forEach(x => texts.push(['impl', x.action], ['impl', x.response]));
      d.evals.forEach(x => texts.push(['eval', x.value]));
      const seen = new Set();
      texts.forEach(([tab, t]) => lintText(t, 'text').forEach(w => { const k = tab + w; if (!seen.has(k)) { seen.add(k); add('warn', w + ' (' + (TABS.find(x => x.id === tab) || {}).label + ')', tab); } }));
      const timeBad = d.impl.some(x => x.time && lintTime(x.time).length) || d.evals.some(x => x.time && lintTime(x.time).length);
      if (timeBad) add('warn', 'Some time stamps are not in 24-hour "0815 H" format.', 'impl');
      const named = d.group.members.filter(m => m.name.trim());
      if (named.some(m => m.exit.some(a => !a.trim()))) add('warn', 'Exit ticket is incomplete for some members.', 'exit');
      return out;
    }

    V.exit = () => {
      const named = D().group.members.map((m, i) => ({ m, i })).filter(x => x.m.name.trim());
      return head('Exit Ticket', 'Individual', 'Each member answers in 3–5 sentences. Members come from the care team on the Patient Summary.') + (named.length ? named.map(({ m, i }) => `
      <section class="card exit-card"><div class="exit-who"><div class="avatar">${esc(initials(m.name))}</div><div><b>${esc(m.name)}</b><small>${esc(m.role)}</small></div></div>
        ${C.exitQuestions.map((q, k) => `<label class="blk"><span class="q">${k + 1}. ${esc(q)}</span>${ta(`group.members.${i}.exit.${k}`, { rows: 3 })}</label>`).join('')}
      </section>`).join('') : `<section class="card empty">Add member names on the <button class="link" data-goto="summary">Patient Summary</button> first.</section>`);
    };

    V.results = () => {
      const g = st.grades;
      if (!g || !g.scores) return head('Results', 'Rubric and score sheet', '') + `<section class="card locked">${icon('results', 'big')}<h2>Not yet released</h2><p>Your instructor completes the rubric after you submit. Scores and feedback appear here once released.</p></section>`;
      return head('Results', 'Rubric and score sheet', 'Completed by your instructor.') + rubricTable(g, false);
    };
    function rubricTable(g) {
      let total = 0;
      const body = C.rubric.map(sec => `<tr class="sec"><td colspan="4">${esc(sec.group)}</td></tr>` + sec.items.map(it => { const s = g.scores[it.id]; if (s !== '' && s != null) total += +s; return `<tr><td>${esc(it.label)}</td><td class="num">${it.max}</td><td class="num"><b>${s === '' || s == null ? '—' : esc(s)}</b></td><td>${esc((g.feedback || {})[it.id] || '')}</td></tr>`; }).join('')).join('');
      return `<section class="card flush"><table class="tbl rubric"><thead><tr><th>Criterion</th><th style="width:60px">Max</th><th style="width:70px">Score</th><th>Feedback</th></tr></thead><tbody>${body}<tr class="total"><td>TOTAL</td><td class="num">100</td><td class="num">${total}</td><td>${total}%</td></tr></tbody></table></section>${g.general ? `<section class="card"><h2>Instructor comments</h2><p>${esc(g.general)}</p></section>` : ''}`;
    }
    function initials(n) { return n.trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase(); }

    /* ================= SHELL ================= */
    function navHtml() {
      const pr = progress(D());
      return TABS.map(t => {
        if (t.section) return `<div class="nav-sec">${t.section}</div>`;
        if (t.id === 'results' && !st.grades && !st.ro) { /* still show */ }
        const p = pr[t.id];
        const locked = t.id === 'audit' && !st.task5Unlocked && !st.ro;
        const pct = p ? Math.round(p.done / p.of * 100) : null;
        const badge = locked ? icon('lock', 'sm') : pct === null ? '' : pct === 100 ? '<span class="ok-dot">' + icon('check') + '</span>' : `<span class="nav-pct">${pct}%</span>`;
        return `<button class="nav-item ${st.tab === t.id ? 'on' : ''}" data-goto="${t.id}">${icon(t.icon)}<span class="nav-txt"><b>${t.label}</b><small>${t.sub}</small></span>${badge}</button>`;
      }).join('');
    }

    function pagerHtml() {
      const ids = TABS.filter(t => t.id).map(t => t.id);
      const i = ids.indexOf(st.tab);
      const lab = id => (TABS.find(t => t.id === id) || {}).label;
      const prev = ids[i - 1], next = ids[i + 1];
      return `<nav class="pager">${prev ? `<button class="pg-btn" data-goto="${prev}"><small>${icon('left', 'sm')} Previous</small><b>${esc(lab(prev))}</b></button>` : '<span></span>'}${next ? `<button class="pg-btn next" data-goto="${next}"><small>Next ${icon('right', 'sm')}</small><b>${esc(lab(next))}</b></button>` : ''}</nav>`;
    }

    function render() {
      const view = (V[st.tab] || V.summary)();
      root.querySelector('.ehr-nav').innerHTML = navHtml();
      const main = root.querySelector('.ehr-main');
      const keep = st.lastTab === st.tab ? main.scrollTop : 0;
      const roBar = st.ro && st.roNote ? `<div class="ro-banner">${icon('lock', 'sm')}<span>${st.roNote}</span></div>` : '';
      main.innerHTML = `<div class="view ${keep ? 'still' : ''}" data-tab="${st.tab}">${roBar}${view}${pagerHtml()}</div>`;
      main.scrollTop = keep; st.lastTab = st.tab;
      // column labels for the stacked (phone) table layout
      main.querySelectorAll('.tbl-wrap table').forEach(t => {
        const hs = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
        t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (hs[i] && td.tagName === 'TD') td.dataset.label = hs[i]; }));
      });
    }
    function refreshDerived() {
      root.querySelectorAll('[data-derive]').forEach(el => {
        const k = el.dataset.derive;
        if (k === 'cluster') el.innerHTML = clusterList(el.dataset.k);
        else if (k === 'dx') el.innerHTML = dxStmtHtml(+el.dataset.i);
        else if (k === 'wc') { const wc = wordCount(val('note.text')); el.textContent = wc + ' words · target 80–120'; el.className = 'wc ' + (wc >= 80 && wc <= 120 ? 'ok' : wc > 120 ? 'over' : ''); }
        else if (k === 'evalwarn') el.innerHTML = evalWarn(+el.dataset.i);
        else if (k === 'filed') el.innerHTML = filedHtml();
        else if (k === 'auditN') { const n = D().audit.filter(x => x.wrong.trim()).length; el.textContent = n; el.classList.toggle('ok', n >= 10); }
      });
      root.querySelector('.ehr-nav').innerHTML = navHtml();
      // meters inside the page head
      const m = root.querySelector('.pg-head .meter');
      if (m) {
        const pr = progress(D())[st.tab === 'sign' ? 'sign' : st.tab];
        if (pr) { const pct = Math.round(pr.done / pr.of * 100); m.querySelector('b').textContent = `${pr.done} / ${pr.of}`; m.querySelector('i').style.width = pct + '%'; }
      }
    }

    /* ================= EVENTS ================= */
    let trailTimer = {};
    function onField(e) {
      const el = e.target.closest('[data-path]'); if (!el || st.ro) return;
      const p = el.dataset.path;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      setPath(D(), p, v);
      if (el.dataset.lint) { const box = root.querySelector(`[data-lint-for="${CSS.escape(p)}"]`); if (box) box.innerHTML = lintHtml(p, el.dataset.lint); }
      // re-lint impl time when the card changes
      if (/^impl\.\d+\.card$/.test(p)) { const tp = p.replace('.card', '.time'); const box = root.querySelector(`[data-lint-for="${CSS.escape(tp)}"]`); if (box) box.innerHTML = lintHtml(tp, 'impl-time'); }
      // row-level visual states
      const tr = el.closest('tr');
      if (tr && /^cards\.\d+\./.test(p)) { const i = +p.split('.')[1]; tr.classList.toggle('done', !!(D().cards[i].cat && D().cards[i].cluster)); }
      if (tr && /\.flag$/.test(p)) tr.classList.toggle('abn', v === 'Abnormal');
      if (tr && /^checklist\./.test(p)) { const i = +p.split('.')[1]; tr.classList.toggle('done', !!D().checklist[i].done); }
      const si = el.closest('.smart-item'); if (si) si.classList.toggle('on', !!v);
      refreshDerived();
      // audit trail (one entry per field per 4 s)
      clearTimeout(trailTimer[p]);
      trailTimer[p] = setTimeout(() => {
        const t = D().trail; t.push({ t: Date.now(), u: st.user || 'Group', tab: st.tab, f: p });
        if (t.length > 800) t.splice(0, t.length - 800);
      }, 4000);
      st.onChange(D());
      if (el.type === 'checkbox' && st.tab === 'sign') render();
    }
    root.addEventListener('input', onField);
    root.addEventListener('change', e => {
      if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') return onField(e);
      if (st.ro) return;
      // Clinical decision support: fire advisories when a value is committed
      const p = e.target.dataset && e.target.dataset.path; const v = e.target.value || '';
      const num = parseFloat((v.match(/\d+(\.\d+)?/) || [])[0]);
      const AL = C.alerts || {};
      if (p === 'flow.SpO2.value' && AL.spo2Min && num && num < +AL.spo2Min && !fired.has('spo2' + num)) {
        fired.add('spo2' + num);
        st.onAction('bpa', { id: 'spo2', level: 'high', title: 'Low oxygen saturation', body: `SpO2 <b>${esc(v)}</b> is below the target of <b>${esc(AL.spo2Min)}% or higher</b>. ${esc(AL.spo2Text)}`, actions: ['Will apply O2 per order and reassess', 'Physician notified', 'Value entered in error'] });
      }
      if (p === 'flow.Temperature.value' && AL.feverMin && num >= +AL.feverMin && num < 45 && !fired.has('temp' + num)) {
        fired.add('temp' + num);
        st.onAction('bpa', { id: 'temp', level: 'med', title: 'Fever – PRN order available', body: `Temperature <b>${esc(v)}</b> is at or above <b>${esc(AL.feverMin)} °C</b>. ${esc(AL.feverText)}`, actions: ['Will give PRN per order and reassess', 'Not giving – reason documented'] });
      }
      if (/^(impl\.\d+\.action|plans\.\d+\.ints\.\d+\.text)$/.test(p) && allergyHit(v) && !fired.has('allergy' + p)) {
        fired.add('allergy' + p);
        st.onAction('bpa', { id: 'allergy', level: 'high', title: 'Drug–allergy interaction', body: `This entry mentions <b>${esc(allergyHit(v))}</b>. Patient allergy on file: <b>${esc(C.patient.allergy)}</b>.`, actions: ['Will not give – remove entry', 'Override – documented reason'] });
      }
    });
    const fired = new Set();
    function allergyHit(v) {
      const kws = String((C.alerts || {}).allergyKeywords || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean);
      // the allergen named on the banner always counts, e.g. "Penicillin – hives" → "penicillin"
      const main = String(C.patient.allergy || '').split(/[\s(–,-]+/)[0];
      if (main && !/^(nkda|none)$/i.test(main) && main.length > 2) kws.push(main);
      const t = String(v || '').toLowerCase();
      return kws.find(k => t.includes(k.toLowerCase())) || '';
    }
    function logTrail(f) { const t = D().trail; t.push({ t: Date.now(), u: st.user || 'Group', tab: st.tab, f }); if (t.length > 800) t.splice(0, t.length - 800); }

    root.addEventListener('click', e => {
      const g = e.target.closest('[data-goto]');
      if (g) { go(g.dataset.goto); return; }
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act; const d = D();
      const mutate = fn => { if (st.ro) return; fn(); st.onChange(d); render(); };
      switch (act) {
        case 'cardFilter': st.cardFilter = a.dataset.v; render(); break;
        case 'cpTab': st.cpPriority = +a.dataset.v; render(); break;
        case 'addMember': mutate(() => d.group.members.push({ role: 'Other member', name: '', exit: ['', '', '', ''] })); break;
        case 'delMember': mutate(() => d.group.members.splice(+a.dataset.i, 1)); break;
        case 'addImpl': mutate(() => d.impl.push(blankImpl())); break;
        case 'addEval': mutate(() => d.evals.push(blankEval())); break;
        case 'delRow': if (confirm('Delete this row? (The deletion is recorded in the audit trail.)')) mutate(() => { d[a.dataset.list].splice(+a.dataset.i, 1); d.trail.push({ t: Date.now(), u: st.user || 'Group', tab: st.tab, f: a.dataset.list + ' row deleted' }); }); break;
        case 'fileFlow': {
          if (st.ro) break;
          const empty = C.flowsheetRows.filter(r => !(d.flow[r] && d.flow[r].value.trim())).length;
          if (empty && !confirm(`${empty} row(s) are still blank. File the column anyway?`)) break;
          d.flowFiled = { by: st.user || 'Group', at: Date.now() };
          logTrail('Flowsheet ' + C.flowTime + ' column filed'); st.onChange(d); render();
          st.onAction('toast', { msg: 'Flowsheet filed' });
          break;
        }
        case 'noteIns': {
          const t = root.querySelector('[data-path="note.text"]'); if (!t || st.ro) break;
          const now = hm(Date.now());
          const ins = { time: `Day 1, ${now} H. `, late: `LATE ENTRY for Day 1, ____ H (entered Day 1, ${now} H): `, quote: '"" ', sig: `\n— ${st.user || 'Name'}, Student Nurse, Day 1, ${now} H` }[a.dataset.v];
          const s0 = t.selectionStart ?? t.value.length, e2 = t.selectionEnd ?? s0;
          t.value = t.value.slice(0, s0) + ins + t.value.slice(e2);
          const pos = a.dataset.v === 'quote' ? s0 + 1 : s0 + ins.length;
          t.focus(); t.setSelectionRange(pos, pos);
          t.dispatchEvent(new Event('input', { bubbles: true }));
          break;
        }
        case 'sortImpl': mutate(() => d.impl.sort((x, y) => (x.time.replace(/\D/g, '') || '9999').localeCompare(y.time.replace(/\D/g, '') || '9999'))); break;
        case 'auditPick': {
          if (st.ro) break;
          let i = d.audit.findIndex(x => !x.loc && !x.wrong.trim());
          if (i < 0) { d.audit.push({ loc: '', wrong: '', type: '', harm: '', correct: '' }); i = d.audit.length - 1; }
          d.audit[i].loc = a.dataset.v; st.onChange(d); render();
          const row = root.querySelector(`[data-audit-row="${i}"]`);
          if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('flash'); setTimeout(() => { const t = row.querySelector('textarea'); t && t.focus({ preventScroll: true }); }, 350); }
          break;
        }
        default: st.onAction(act, a);
      }
    });

    function go(tab) {
      st.tab = tab; render();
      root.classList.remove('nav-open');
      if (opts.onTab) opts.onTab(tab);
    }

    render();
    return {
      go, render, validate,
      get data() { return st.data; },
      setData(d) { st.data = normalize(d); render(); },
      setReadOnly(v, note) { st.ro = !!v; if (note !== undefined) st.roNote = note; render(); },
      setTask5(v) { if (st.task5Unlocked !== !!v) { st.task5Unlocked = !!v; render(); } },
      setGrades(g) { st.grades = g; if (st.tab === 'results') render(); else root.querySelector('.ehr-nav').innerHTML = navHtml(); },
      setUser(u) { const changed = st.user !== u; st.user = u; if (changed && st.tab === 'summary' && !root.contains(document.activeElement)) render(); },
      log(f) { if (!st.ro) { logTrail(f); st.onChange(D()); } },
      get tab() { return st.tab; }
    };
  }

  // Overall completion (0–100) across all graded tasks, for the faculty list
  function overall(d) {
    const pr = progress(normalize(d));
    const parts = Object.values(pr);
    return Math.round(parts.reduce((a, p) => a + Math.min(p.done / p.of, 1), 0) / parts.length * 100);
  }
  window.EHR = { create, overall, blankData, normalize, progress, dxStatement, lintText, wordCount, TABS, icon, esc, rubricHtml: null };
})();
