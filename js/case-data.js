/* NCM 110 Simulated EHR — fixed course template + the active patient case.
   The parts below are the SAME for every case (rubric, checklist, dropdowns).
   Patient-specific content (banner, orders, data cards, labs, MAR, audit
   record…) comes from a case built by the instructor and is loaded with
   applyCase(). Until then the built-in sample case is shown. */
(function () {
  const BASE = {
    course: 'NCM 110 Nursing Informatics',
    title: 'Simulated EHR Documentation Lab',
    categories: ['Subjective', 'Objective – assessment', 'Objective – lab / imaging', 'Risk score', 'History / background', 'Intervention (done)', 'Evaluation / response', 'Not clinically relevant'],
    clusters: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    dxTypes: ['Actual (problem-focused)', 'Risk', 'Health promotion', 'Syndrome'],
    interventionTypes: ['Independent', 'Dependent', 'Collaborative'],
    judgments: ['Goal met', 'Goal partially met', 'Goal not met'],
    plans: ['Continue plan', 'Modify plan', 'Resolve / discontinue'],
    auditErrorTypes: ['Wrong patient identifier', 'Inaccurate / transcription error', 'Omission / incomplete', 'Inconsistent across record', 'Unapproved abbreviation', 'Charting ahead / timing', 'Subjective / judgmental language', 'Missing signature', 'Evaluation without data', 'Medical vs nursing diagnosis', 'Copy-forward'],
    checklist: [
      'Right client: two identifiers (name and DOB or hospital number) match the wristband.',
      'Accurate: every value matches its source (device, lab, client).',
      'Complete: date, time, units, site, reassessment after PRN drugs, client response, signature and title.',
      'Consistent: allergy, risk scores, and lung findings agree across banner, flowsheet, eMAR, notes, and care plan.',
      'Timely and truthful: charted after the care, never before; late entries labeled.',
      'No copy-forward of old findings.',
      'Approved abbreviations only (no QD, no U, no trailing zeros).',
      'Objective and respectful language.',
      'Every evaluation quotes time-stamped data, not just "goal met."',
      'No screenshots or sharing outside class (RA 10173).'
    ],
    roles: ['Charge Nurse', 'Documenting Nurse', 'Verifier', 'Auditor', 'Other member'],
    rubric: [
      { group: 'RUBRIC 1 – Group documentation (Tasks 1–4)', items: [
        { id: 'r1_1', label: 'Data sorting and clustering', max: 10, tab: 'cards' },
        { id: 'r1_2', label: 'Assessment documentation', max: 10, tab: 'flowsheet' },
        { id: 'r1_3', label: 'Nursing diagnoses', max: 12, tab: 'dx' },
        { id: 'r1_4', label: 'SMART outcomes', max: 8, tab: 'careplan' },
        { id: 'r1_5', label: 'Interventions and rationale', max: 10, tab: 'careplan' },
        { id: 'r1_6', label: 'Implementation and evaluation entries', max: 10, tab: 'impl' }
      ]},
      { group: 'RUBRIC 2 – Record audit (Task 5)', items: [
        { id: 'r2_1', label: 'Errors identified', max: 12, tab: 'audit' },
        { id: 'r2_2', label: 'Correct classification', max: 6, tab: 'audit' },
        { id: 'r2_3', label: 'Harm analysis', max: 6, tab: 'audit' },
        { id: 'r2_4', label: 'Correction method', max: 6, tab: 'audit' }
      ]},
      { group: 'RUBRIC 3 – Individual conduct and exit ticket', items: [
        { id: 'r3_1', label: 'Confidentiality and EHR etiquette', max: 4, tab: 'sign' },
        { id: 'r3_2', label: 'Exit ticket', max: 6, tab: 'exit' }
      ]}
    ]
  };

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const s = v => String(v == null ? '' : v);

  /* Turn a stored case into the shape the EHR screens use */
  function prepare(c) {
    c = JSON.parse(JSON.stringify(c || {}));
    const p = Object.assign({ name: '', nickname: '', hospNo: '', dob: '', age: '', sex: '', ward: '', bed: '', attending: '', dx: '', allergy: 'NKDA', weight: '', height: '', admission: '', code: 'Full Code', isolation: '', fallRisk: 'Low', ews: '0', context: '' }, c.patient || {});
    p.location = [p.ward, p.bed ? 'Bed ' + p.bed : ''].filter(Boolean).join(', ');
    const parts = p.name.split(',');
    p.initials = ((parts[0] || '').trim()[0] || '') + (((parts[1] || '').trim()[0]) || '');
    p.initials = p.initials.toUpperCase() || 'PT';
    const mine = { bed: s(p.bed), name: p.name, age: [p.age, (p.sex || '')[0]].filter(Boolean).join(' '), md: p.attending, dx: p.dx, allergy: /^nkda$/i.test(p.allergy.trim()) || !p.allergy.trim() ? 'NKDA' : p.allergy.split(/[(–-]/)[0].trim(), fall: p.fallRisk, iso: p.isolation, ews: p.ews, mine: true };
    const census = (c.census || []).filter(x => s(x.bed) !== s(p.bed)).concat([mine])
      .map(x => Object.assign({}, x, { bed: s(x.bed), ews: x.ews === '' || x.ews == null ? '' : +x.ews }))
      .sort((a, b) => (parseInt(a.bed, 10) || 0) - (parseInt(b.bed, 10) || 0));
    return Object.assign({}, BASE, {
      id: c.id || '', caseTitle: c.title || '',
      patient: p, census,
      orders: (c.orders || []).map((o, i) => Object.assign({ no: i + 1 }, o)),
      cards: (c.cards || []).filter(x => s(x).trim()),
      flowTime: c.flowTime || '0800 H',
      flowsheetRows: (c.flowsheetRows || []).filter(x => s(x).trim()),
      labs: c.labs || [], imaging: c.imaging || [],
      mar: (c.mar || []).map(m => Object.assign({}, m, { dueList: s(m.due).split(/[\s,;]+/).map(x => x.replace(/\D/g, '')).filter(x => x.length === 4) })),
      alerts: Object.assign({ allergyKeywords: '', allergyAdvice: '', spo2Min: '', spo2Text: '', feverMin: '', feverText: '', fallText: '' }, c.alerts || {}),
      auditNurse: c.auditNurse || 'J. Reyes, RN',
      auditRecord: (c.auditRecord || []).map((r, i) => Object.assign({ id: LETTERS[i] || String(i + 1) }, r)),
      exitQuestions: (c.exitQuestions || []).filter(x => s(x).trim())
    });
  }

  // window.CASE is shared by every screen. applyCase() swaps its contents in place.
  window.CASE = {};
  window.CASE_BASE = BASE;
  window.applyCase = function (c) {
    const next = prepare(c);
    Object.keys(window.CASE).forEach(k => delete window.CASE[k]);
    Object.assign(window.CASE, next);
    return window.CASE;
  };
  window.applyCase(window.EHRCore ? window.EHRCore.SAMPLE_CASE : {});
})();
