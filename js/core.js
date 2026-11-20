/* =====================================================================
   CareChart EHR — shared server logic ("core")
   ---------------------------------------------------------------------
   The SAME file runs in two places:
     • in the browser (demo mode, data in localStorage)
     • in Google Apps Script (copy it into the script project as Core.gs)
   Storage is passed in as a "store" object, so the rules live in one
   place. Contains NO secrets: passwords are salted hashes and answer
   keys are data inside each case.
   ===================================================================== */
var EHRCore = (function () {

  /* ---------------- tiny synchronous SHA-256 ---------------- */
  function sha256(ascii) {
    function rr(v, n) { return (v >>> n) | (v << (32 - n)); }
    var str = unescape(encodeURIComponent(String(ascii)));
    var maxWord = Math.pow(2, 32), result = '', words = [], bitLen = str.length * 8;
    var hash = [], k = [], primeCounter = 0, isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    str += '\x80';
    while (str.length % 64 - 56) str += '\x00';
    for (i = 0; i < str.length; i++) {
      var j = str.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((bitLen / maxWord) | 0);
    words[words.length] = (bitLen);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
    return result;
  }

  /* ---------------- built-in sample case (no answer key here) ---------------- */
  var SAMPLE_ID = 'sample-lola';
  var SAMPLE_CASE = {
    id: SAMPLE_ID, builtin: true, owner: '',
    title: 'Lola Charing – Community-acquired pneumonia',
    patient: {
      name: 'VILLANUEVA, Rosario M.', nickname: 'Lola Charing', hospNo: '2026-004517', dob: '14 March 1954', age: '72 y', sex: 'Female',
      ward: 'Medical Ward 3', bed: '12', attending: 'Dr. A. Ramos', dx: 'Community-acquired pneumonia, right lower lobe',
      allergy: 'Sulfonamide (cotrimoxazole) – rash', weight: '52 kg', height: '152 cm', admission: 'Day 1, 0730 H, from the ED',
      code: 'Full Code', isolation: 'Droplet', fallRisk: 'High', ews: '6',
      context: 'Lives in Quezon City with daughter Mila; retired public school teacher; walks with a cane; 4 days of cough and fever.'
    },
    census: [
      { bed: '08', name: 'DELA CRUZ, Ernesto P.', age: '68 y M', md: 'Dr. L. Santos', dx: 'Heart failure, acute exacerbation', allergy: 'NKDA', fall: 'Mod', iso: '', ews: '3' },
      { bed: '09', name: 'MENDOZA, Liza R.', age: '45 y F', md: 'Dr. A. Ramos', dx: 'Dengue fever without warning signs', allergy: 'NKDA', fall: 'Low', iso: 'Standard', ews: '1' },
      { bed: '10', name: 'GARCIA, Pedro S.', age: '81 y M', md: 'Dr. M. Tan', dx: 'COPD in acute exacerbation', allergy: 'Penicillin', fall: 'High', iso: 'Droplet', ews: '5' },
      { bed: '14', name: 'AQUINO, Josefina T.', age: '59 y F', md: 'Dr. M. Tan', dx: 'Type 2 diabetes mellitus, uncontrolled', allergy: 'NKDA', fall: 'Low', iso: '', ews: '0' },
      { bed: '15', name: 'REYES, Mark A.', age: '34 y M', md: 'Dr. L. Santos', dx: 'Acute gastroenteritis', allergy: 'Shellfish', fall: 'Low', iso: 'Contact', ews: '2' },
      { bed: '16', name: 'BAUTISTA, Carmen L.', age: '77 y F', md: 'Dr. A. Ramos', dx: 'Ischemic stroke, day 3', allergy: 'NKDA', fall: 'High', iso: '', ews: '2' }
    ],
    orders: [
      { cat: 'Respiratory', text: 'Oxygen via nasal cannula at 2–4 L/min; titrate to keep SpO2 at 92% or higher.', status: 'Active' },
      { cat: 'Medication', text: 'Ceftriaxone 2 g IV once daily (first dose 0900 H).', status: 'Active' },
      { cat: 'Medication', text: 'Azithromycin 500 mg PO once daily.', status: 'Active' },
      { cat: 'Medication', text: 'Paracetamol 500 mg PO every 4 hours as needed for temperature 38.0 °C or higher, or for pain.', status: 'Active PRN' },
      { cat: 'IV Fluids', text: 'PNSS 1 L at 80 mL/hour.', status: 'Active' },
      { cat: 'Lab / Imaging', text: 'CBC, sputum Gram stain and culture, chest X-ray (done in ED).', status: 'Completed' },
      { cat: 'Nursing', text: 'Vital signs every 4 hours; SpO2 monitoring.', status: 'Active' },
      { cat: 'Diet', text: 'Soft diet as tolerated; strict intake and output.', status: 'Active' },
      { cat: 'Safety', text: 'Fall precautions.', status: 'Active' }
    ],
    cards: [
      '"Hirap akong huminga, lalo na kapag naglalakad papuntang CR." (It is hard to breathe, especially when I walk to the bathroom.)',
      '0800 H: Temperature 38.6 °C (axillary)', '0800 H: Heart rate 108 beats/min, regular',
      '0800 H: Respiratory rate 26 breaths/min; uses neck accessory muscles', '0800 H: BP 130/80 mmHg, right arm, sitting',
      '0800 H: SpO2 90% on room air', 'Crackles over the right lower posterior chest; left lung clear',
      'Productive cough with thick, yellow sputum, about 1 tablespoon per episode',
      '"Masakit ang kanang dibdib ko kapag umuubo." Pain 6/10, sharp, right lower chest, worse with coughing',
      'Splints right side with her arm when coughing; grimaces', 'Chest X-ray: right lower lobe consolidation',
      'CBC: WBC 15.8 x 10^9/L (high); neutrophils 85%',
      'Daughter: "Nadulas po si Mama sa banyo noong isang buwan." (Mama slipped in the bathroom last month.)',
      'Wakes up 2–3 times at night to urinate', 'Walks with a cane; unsteady when standing up',
      'Morse Fall Scale score: 55 (high risk; 45 or higher)', '"Wala akong ganang kumain." Ate about one-quarter of meals for 3 days',
      'Dry lips and oral mucosa; urine output 250 mL from 0730–1530 H',
      '"Natatakot ako, baka ma-ICU ako tulad ng asawa ko." (I\'m afraid I\'ll end up in the ICU like my husband.)',
      'Had an appendectomy in 1980', 'Her favorite teleserye airs at 2000 H', 'Allergy: cotrimoxazole caused a rash in 2019',
      'Braden Scale score: 18', '0815 H: Oxygen started via nasal cannula at 3 L/min; head of bed raised to 45 degrees',
      '0830 H: Taught pursed-lip breathing and pillow splinting during cough; client did a return demonstration',
      '0845 H: Paracetamol 500 mg PO given for T 38.6 °C and pain 6/10',
      '0900 H: Ceftriaxone 2 g IV given via left forearm IV line (patent, no swelling)',
      '0900 H: Bed in low position, bed alarm on, call bell within reach; daughter oriented to fall precautions',
      '0945 H: T 37.8 °C; pain 3/10; SpO2 93% on 3 L/min',
      '1200 H: SpO2 94% on 3 L/min; RR 22; still dyspneic when walking to the bathroom with assistance',
      '1200 H: Ate half of the soft-diet lunch; oral fluid intake 600 mL since 0730 H',
      '1300 H: Called for help before getting up to urinate; no falls this shift',
      '1400 H: Explained the treatment plan; client said, "Mas panatag na ako ngayon." (I feel calmer now.)'
    ],
    flowTime: '0800 H',
    flowsheetRows: ['Temperature', 'Heart rate', 'Respiratory rate', 'Blood pressure', 'SpO2', 'Oxygen device and flow', 'Pain score',
      'Pain location / quality', 'Lung sounds', 'Cough / sputum', 'Morse Fall Scale', 'Braden Scale', 'Allergy verified with client',
      'Oral intake (past 3 days)', 'Mucous membranes'],
    labs: [
      { panel: 'Complete Blood Count', collected: 'Day 1, 0650 H (ED)', status: 'Final', test: 'WBC', value: '15.8', unit: 'x 10^9/L', ref: '4.5 – 11.0', flag: 'H' },
      { panel: 'Complete Blood Count', collected: 'Day 1, 0650 H (ED)', status: 'Final', test: 'Neutrophils', value: '85', unit: '%', ref: '50 – 70', flag: 'H' },
      { panel: 'Sputum Gram stain and culture', collected: 'Day 1, 0715 H (ED)', status: 'Pending', test: 'Gram stain', value: 'Pending', unit: '', ref: '', flag: '' },
      { panel: 'Sputum Gram stain and culture', collected: 'Day 1, 0715 H (ED)', status: 'Pending', test: 'Culture and sensitivity', value: 'Pending', unit: '', ref: '', flag: '' }
    ],
    imaging: [{ study: 'Chest X-ray, PA view', done: 'Day 1, 0700 H (ED)', status: 'Final', findings: 'Right lower lobe consolidation.', impression: 'Findings consistent with right lower lobe pneumonia. Clinical correlation advised.' }],
    mar: [
      { med: 'Ceftriaxone', dose: '2 g', route: 'IV', freq: 'Once daily', kind: 'Scheduled', due: '0900', order: '2' },
      { med: 'Azithromycin', dose: '500 mg', route: 'PO', freq: 'Once daily', kind: 'Scheduled', due: '0900', order: '3' },
      { med: 'Paracetamol', dose: '500 mg', route: 'PO', freq: 'Every 4 hours PRN – T ≥ 38.0 °C or pain', kind: 'PRN', due: '', order: '4' },
      { med: 'PNSS (0.9% NaCl)', dose: '1 L', route: 'IV', freq: 'Continuous at 80 mL/hour', kind: 'Continuous', due: '', order: '5' }
    ],
    alerts: {
      allergyKeywords: 'cotrimoxazole, sulfamethoxazole, bactrim, sulfa',
      allergyAdvice: 'Avoid sulfonamide-containing drugs (e.g., cotrimoxazole). Verify the allergy with the client and daughter.',
      spo2Min: '92', spo2Text: 'Order 1: Oxygen via nasal cannula at 2–4 L/min; titrate to keep SpO2 ≥ 92%.',
      feverMin: '38', feverText: 'Order 4: Paracetamol 500 mg PO every 4 hours as needed. Remember to reassess after giving a PRN drug.',
      fallText: 'Morse Fall Scale 55 (high risk ≥ 45). Active order: Fall precautions. Consider bed in low position, bed alarm, call bell within reach, non-slip footwear, assisted toileting.'
    },
    auditNurse: 'J. Reyes, RN',
    auditRecord: [
      { section: 'Banner', entry: 'VILLANUEVA, Rosario M. | Hospital No. 2026-004517 | DOB 14 March 1945 | Allergy: NKDA' },
      { section: 'Flowsheet 0800', entry: 'T 38.6 | HR 108 | RR 16 | BP 130/80 | SpO2 98% RA | Pain 6/10 | JR | entered 0805' },
      { section: 'Flowsheet 1200', entry: 'T 37.4 | HR 96 | RR 22 | BP 120/80 | SpO2 94% | Pain — | JR | entered 1210' },
      { section: 'Fall risk', entry: 'Morse 55 – Low risk. Fall precautions: (blank)' },
      { section: 'eMAR', entry: 'Ceftriaxone 2 g IV QD – charted given 0900 – JR' },
      { section: 'eMAR', entry: 'Azithromycin 500 mg PO QD – (blank)' },
      { section: 'eMAR', entry: 'Paracetamol 500.0 mg PO q4h PRN – charted given 0845 – JR' },
      { section: 'Note 0805 H', entry: 'Received client awake, on room air. Lungs clear on both sides. No respiratory distress. Pain on chest 6/10. – JR' },
      { section: 'Note 0830 H', entry: 'IV line on left forearm infiltrated; removed. IV access to be re-inserted by IV team. – JR' },
      { section: 'Note 1130 H (event time 1500 H)', entry: 'Client ambulated to CR with assistance, tolerated well, no dyspnea. – JR' },
      { section: 'Note 1300 H', entry: 'Paracetamol given at 0845 for fever. Client is demanding and uncooperative, keeps asking if she will go to the ICU. – (no signature)' },
      { section: 'Note 1400 H', entry: 'Evaluation: Impaired gas exchange – Goal met. – JR' },
      { section: 'Care plan', entry: 'Pneumonia related to infection as evidenced by fever and cough.' }
    ],
    exitQuestions: [
      'Which error in Task 5 was the most dangerous for the client? Why?',
      'Give one example of how an EHR convenience feature (templates, copy-forward, defaults) can harm data quality.',
      'The 0800 SpO2 was charted as 98% instead of 90%. Which downstream decisions would that change?',
      'Complete: "Starting today, before I click Sign, I will always check..."'
    ],
    key: { audit: [], notes: [] }
  };

  /* A blank case for "start from scratch" */
  function blankCase() {
    return {
      title: 'Untitled case',
      patient: { name: 'LASTNAME, Firstname M.', nickname: '', hospNo: '2026-000000', dob: '1 January 1960', age: '66 y', sex: 'Female', ward: 'Medical Ward 3', bed: '12', attending: 'Dr. ', dx: '', allergy: 'NKDA', weight: '', height: '', admission: 'Day 1, 0730 H', code: 'Full Code', isolation: '', fallRisk: 'Low', ews: '0', context: '' },
      census: clone(SAMPLE_CASE.census), orders: [], cards: [], flowTime: '0800 H', flowsheetRows: clone(SAMPLE_CASE.flowsheetRows),
      labs: [], imaging: [], mar: [],
      alerts: { allergyKeywords: '', allergyAdvice: '', spo2Min: '92', spo2Text: '', feverMin: '38', feverText: '', fallText: '' },
      auditNurse: 'J. Reyes, RN', auditRecord: [], exitQuestions: clone(SAMPLE_CASE.exitQuestions), key: { audit: [], notes: [] }
    };
  }

  /* ---------------- helpers ---------------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clean(s, n) { return String(s == null ? '' : s).trim().replace(/\s+/g, '').slice(0, n || 50); }
  function err(msg) { throw new Error(msg); }
  function secId(s) { return clean(s, 20).toUpperCase(); }
  function recId(section, group) { return secId(section) + '-G' + String(+group); }
  function pinHash(id, pin) { return sha256(id + ':' + pin); }
  function pwHash(user, pw) { return sha256('ehr-staff:' + user + ':' + pw); }
  function stripKey(c) { var o = clone(c); delete o.key; return o; }

  function getCase(store, id, keyStore) {
    if (!id) return null;
    if (id === SAMPLE_ID) { var s = clone(SAMPLE_CASE); if (keyStore && keyStore.sampleKey) s.key = keyStore.sampleKey; return s; }
    return store.get('cases', id);
  }

  function recPublic(r, withData) {
    var o = { id: r.id, section: r.section, group: r.group, status: r.status, caseId: r.caseId || '', updatedAt: r.updatedAt, submittedAt: r.submittedAt || null,
      released: !!r.released, total: r.grades && r.grades.total != null && r.grades.total !== '' ? r.grades.total : null, progress: r.progress || 0, members: r.members || [], gradedBy: r.grades ? r.grades.by || '' : '' };
    if (withData) { o.data = r.data || null; o.grades = r.grades || null; }
    return o;
  }
  function membersOf(d) { try { return d.group.members.filter(function (m) { return m.name && m.name.trim(); }).map(function (m) { return m.name.trim(); }); } catch (e) { return []; } }

  /* ---------------- staff sessions ---------------- */
  function staff(store, req, adminOnly) {
    var s = req.token && store.sessionGet(req.token);
    if (!s) err('Your session has expired. Please sign in again.');
    var u = store.get('instructors', s.username);
    if (!u || u.active === false) err('Account disabled.');
    if (adminOnly && u.role !== 'admin') err('Admins only.');
    return u;
  }
  function canSection(u, sec) { return u.role === 'admin' || (sec && sec.instructor === u.id); }
  function mySections(store, u) { return store.list('sections').filter(function (s) { return canSection(u, s); }); }
  function userPublic(u) { return { id: u.id, name: u.name, role: u.role, active: u.active !== false }; }

  /* ---------------- actions ---------------- */
  var A = {};

  /* ----- public / students ----- */
  A.getSections = function (store) {
    return store.list('sections').filter(function (s) { return s.caseId && +s.groups > 0; })
      .map(function (s) { return { code: s.id, groups: +s.groups || 0 }; })
      .sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  };
  A.getConfig = function (store, r) {
    var s = store.get('sections', secId(r.section));
    return s ? { task5Unlocked: !!s.task5Unlocked, acceptingSubmissions: s.acceptingSubmissions !== false } : { task5Unlocked: false, acceptingSubmissions: true };
  };
  A.login = function (store, r, ks) {
    var sec = store.get('sections', secId(r.section));
    if (!sec) err('Section not found. Choose your section from the list.');
    if (!sec.caseId) err('Your instructor has not assigned a patient to this section yet.');
    if (!(+sec.groups > 0)) err('Your instructor has not set the number of groups for this section yet.');
    if (!/^\d{1,3}$/.test(clean(r.group, 3)) || +r.group < 1 || +r.group > (+sec.groups || 0)) err('Group must be between 1 and ' + sec.groups + ' for ' + sec.id + '.');
    var pin = String(r.pin || '');
    if (!/^\d{4,6}$/.test(pin)) err('PIN must be 4–6 digits.');
    var id = recId(sec.id, r.group);
    return store.withLock(function () {
      var rec = store.get('records', id);
      if (!rec) {
        if (!r.create) return { notFound: true, id: id };
        var now = store.now();
        rec = { id: id, section: sec.id, group: String(+r.group), pinHash: pinHash(id, pin), status: 'draft', caseId: sec.caseId, createdAt: now, updatedAt: now, data: null, progress: 0, members: [] };
        store.put('records', rec);
      } else if (rec.pinHash !== pinHash(id, pin)) err('Wrong group PIN for ' + id + '.');
      var c = getCase(store, rec.caseId || sec.caseId, ks);
      if (!c) err('The patient case for this section is missing. Tell your instructor.');
      var out = recPublic(rec, true);
      if (!rec.released) out.grades = null;
      return { created: !rec.data && rec.createdAt === rec.updatedAt, record: out, case: stripKey(c) };
    });
  };
  function auth(store, r) {
    var id = recId(r.section, r.group);
    var rec = store.get('records', id);
    if (!rec || rec.pinHash !== pinHash(id, String(r.pin || ''))) err('Session expired. Please log in again.');
    return rec;
  }
  A.save = function (store, r) {
    return store.withLock(function () {
      var rec = auth(store, r);
      if (rec.status !== 'draft') err('This record is already signed and submitted.');
      rec.data = r.data; rec.progress = +r.progress || 0; rec.members = membersOf(r.data); rec.updatedAt = store.now();
      store.put('records', rec);
      return { updatedAt: rec.updatedAt };
    });
  };
  A.submit = function (store, r) {
    return store.withLock(function () {
      var rec = auth(store, r);
      var sec = store.get('sections', rec.section);
      if (sec && sec.acceptingSubmissions === false) err('Submissions are closed for this section.');
      if (rec.status !== 'draft') err('This record is already signed and submitted.');
      rec.data = r.data; rec.progress = +r.progress || 0; rec.members = membersOf(r.data);
      rec.status = 'submitted'; rec.submittedAt = rec.updatedAt = store.now();
      store.put('records', rec);
      return { submittedAt: rec.submittedAt };
    });
  };

  /* ----- staff: account ----- */
  A.staffLogin = function (store, r) {
    var id = clean(r.username, 40).toLowerCase();
    var u = store.get('instructors', id);
    store.slowDown();
    if (!u || u.active === false || u.pwHash !== pwHash(id, String(r.password || ''))) err('Wrong username or password.');
    var token = store.token();
    store.sessionPut(token, { username: id });
    return { token: token, user: userPublic(u), mustChange: !!u.mustChange };
  };
  A.me = function (store, r) { var u = staff(store, r); return { user: userPublic(u), mustChange: !!u.mustChange }; };
  A.logout = function (store, r) { if (r.token) store.sessionDel(r.token); return { ok: true }; };
  A.changePassword = function (store, r) {
    var u = staff(store, r);
    if (u.pwHash !== pwHash(u.id, String(r.oldPassword || ''))) err('Current password is wrong.');
    if (String(r.newPassword || '').length < 6) err('New password must be at least 6 characters.');
    u.pwHash = pwHash(u.id, r.newPassword); u.mustChange = false; store.put('instructors', u);
    return { ok: true };
  };

  /* ----- staff: sections ----- */
  A.mySections = function (store, r) {
    var u = staff(store, r);
    var recs = store.list('records');
    var cases = {};
    return mySections(store, u).map(function (s) {
      var c = s.caseId ? (cases[s.caseId] || (cases[s.caseId] = getCase(store, s.caseId))) : null;
      var mine = recs.filter(function (x) { return x.section === s.id; });
      return { code: s.id, instructor: s.instructor, groups: +s.groups || 0, caseId: s.caseId || '', caseTitle: c ? c.title : '',
        task5Unlocked: !!s.task5Unlocked, acceptingSubmissions: s.acceptingSubmissions !== false,
        charts: mine.length, submitted: mine.filter(function (x) { return x.status !== 'draft'; }).length };
    }).sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  };
  A.updateSection = function (store, r) {
    var u = staff(store, r);
    var s = store.get('sections', secId(r.code));
    if (!s || !canSection(u, s)) err('Section not found or not yours.');
    var p = r.patch || {};
    if ('caseId' in p) {
      if (p.caseId) { var c = getCase(store, p.caseId); if (!c) err('Case not found.'); if (!c.builtin && c.owner !== u.id && u.role !== 'admin') err('You can only assign your own cases.'); }
      s.caseId = p.caseId || '';
    }
    if ('groups' in p) s.groups = checkGroups(store, s.id, p.groups);
    if ('task5Unlocked' in p) s.task5Unlocked = !!p.task5Unlocked;
    if ('acceptingSubmissions' in p) s.acceptingSubmissions = !!p.acceptingSubmissions;
    store.put('sections', s);
    return { ok: true };
  };

  function checkGroups(store, code, value) {
    var g = +value;
    if (!(g >= 1 && g <= 50) || Math.floor(g) !== g) err('Number of groups must be a whole number from 1 to 50.');
    var maxUsed = store.list('records').filter(function (x) { return x.section === code; }).reduce(function (m, x) { return Math.max(m, +x.group); }, 0);
    if (g < maxUsed) err('Group ' + maxUsed + ' already has a chart, so this section needs at least ' + maxUsed + ' groups.');
    return g;
  }

  /* ----- staff: charts ----- */
  A.list = function (store, r) {
    var u = staff(store, r);
    var codes = {}; mySections(store, u).forEach(function (s) { codes[s.id] = 1; });
    return { records: store.list('records').filter(function (x) { return codes[x.section]; }).map(function (x) { return recPublic(x, false); }) };
  };
  function myRecord(store, u, id) {
    var rec = store.get('records', id); if (!rec) err('Chart not found.');
    if (!canSection(u, store.get('sections', rec.section))) err('This chart belongs to another instructor\'s section.');
    return rec;
  }
  A.get = function (store, r, ks) {
    var u = staff(store, r); var rec = myRecord(store, u, r.id);
    return { record: recPublic(rec, true), case: getCase(store, rec.caseId, ks) };
  };
  A.grade = function (store, r) {
    var u = staff(store, r);
    return store.withLock(function () {
      var rec = myRecord(store, u, r.id);
      var g = r.grades || {}; g.gradedAt = store.now(); g.by = u.name || u.id;
      rec.grades = g; if (rec.status === 'submitted') rec.status = 'graded';
      if (typeof r.release === 'boolean') rec.released = r.release;
      store.put('records', rec); return { ok: true };
    });
  };
  A.setStatus = function (store, r) {
    var u = staff(store, r);
    if (['draft', 'submitted', 'graded'].indexOf(r.status) < 0) err('Bad status');
    return store.withLock(function () {
      var rec = myRecord(store, u, r.id);
      rec.status = r.status; if (r.status === 'draft' && rec.data) rec.data.signed = null;
      store.put('records', rec); return { ok: true };
    });
  };
  A.remove = function (store, r) {
    var u = staff(store, r); myRecord(store, u, r.id);
    store.remove('records', r.id); return { ok: true };
  };

  /* ----- staff: cases (each instructor owns their own) ----- */
  A.listCases = function (store, r) {
    var u = staff(store, r);
    var secs = store.list('sections');
    var mine = store.list('cases').filter(function (c) { return u.role === 'admin' || c.owner === u.id; });
    var all = [SAMPLE_CASE].concat(mine);
    return all.map(function (c) {
      return { id: c.id, title: c.title, owner: c.owner || '', builtin: !!c.builtin, updatedAt: c.updatedAt || null,
        patient: c.patient ? c.patient.name : '', dx: c.patient ? c.patient.dx : '', cards: (c.cards || []).length,
        // only reveal sections this user may see (other instructors' sections stay private)
        usedBy: secs.filter(function (s) { return s.caseId === c.id && canSection(u, s); }).map(function (s) { return s.id; }) };
    });
  };
  A.getCaseFull = function (store, r, ks) {
    var u = staff(store, r);
    var c = getCase(store, r.id, ks); if (!c) err('Case not found.');
    if (!c.builtin && c.owner !== u.id && u.role !== 'admin') err('This case belongs to another instructor.');
    return { case: c };
  };
  A.saveCase = function (store, r) {
    var u = staff(store, r);
    var c = r.case || {}; var now = store.now();
    if (!String(c.title || '').trim()) err('Give the case a title.');
    if (c.id === SAMPLE_ID) err('The built-in sample is read-only. Duplicate it first.');
    if (c.id) {
      var old = store.get('cases', c.id); if (!old) err('Case not found.');
      if (old.owner !== u.id && u.role !== 'admin') err('This case belongs to another instructor.');
      c.owner = old.owner; c.createdAt = old.createdAt;
    } else { c.id = 'case-' + store.token().slice(0, 10); c.owner = u.id; c.createdAt = now; }
    delete c.builtin; c.updatedAt = now;
    store.put('cases', c);
    return { id: c.id, updatedAt: now };
  };
  A.duplicateCase = function (store, r, ks) {
    var u = staff(store, r);
    var src = r.id === 'blank' ? blankCase() : getCase(store, r.id, ks); if (!src) err('Case not found.');
    if (!src.builtin && src.owner && src.owner !== u.id && u.role !== 'admin') err('This case belongs to another instructor.');
    var c = clone(src); delete c.id; delete c.builtin;
    c.title = r.id === 'blank' ? 'Untitled case' : 'Copy of ' + src.title;
    return A.saveCase(store, { token: r.token, case: c });
  };
  A.deleteCase = function (store, r) {
    var u = staff(store, r);
    var c = store.get('cases', r.id); if (!c) err('Case not found.');
    if (c.owner !== u.id && u.role !== 'admin') err('This case belongs to another instructor.');
    var used = store.list('sections').filter(function (s) { return s.caseId === c.id; }).map(function (s) { return s.id; });
    if (used.length) err('This case is assigned to ' + used.join(', ') + '. Assign another case first.');
    if (store.list('records').some(function (x) { return x.caseId === c.id; })) err('Student charts already use this case, so it cannot be deleted. Duplicate it to make changes.');
    store.remove('cases', r.id); return { ok: true };
  };

  /* ----- admin: instructors & sections ----- */
  A.adminData = function (store, r) {
    staff(store, r, true);
    var recs = store.list('records');
    return {
      instructors: store.list('instructors').map(function (u) { var o = userPublic(u); o.sections = store.list('sections').filter(function (s) { return s.instructor === u.id; }).map(function (s) { return s.id; }); return o; }),
      sections: store.list('sections').map(function (s) { var c = s.caseId ? getCase(store, s.caseId) : null; return { code: s.id, instructor: s.instructor, groups: +s.groups || 0, caseTitle: c ? c.title : '', charts: recs.filter(function (x) { return x.section === s.id; }).length }; })
    };
  };
  A.saveInstructor = function (store, r) {
    var me = staff(store, r, true);
    var id = clean(r.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(id)) err('Username: 3–40 letters, numbers, dot, dash or underscore.');
    var u = store.get('instructors', id);
    if (r.isNew && u) err('That username is taken.');
    if (!u) { u = { id: id, createdAt: store.now() }; if (!r.password) err('Set a temporary password for the new account.'); }
    if (r.name != null) u.name = String(r.name).trim().slice(0, 80) || id;
    if (r.role) u.role = r.role === 'admin' ? 'admin' : 'instructor';
    if (typeof r.active === 'boolean') { if (id === me.id && !r.active) err('You cannot disable your own account.'); u.active = r.active; }
    if (r.password) { if (String(r.password).length < 6) err('Password must be at least 6 characters.'); u.pwHash = pwHash(id, r.password); u.mustChange = id !== me.id; }
    store.put('instructors', u);
    return { ok: true };
  };
  A.deleteInstructor = function (store, r) {
    var me = staff(store, r, true);
    var id = clean(r.username, 40).toLowerCase();
    if (id === me.id) err('You cannot delete your own account.');
    if (store.list('sections').some(function (s) { return s.instructor === id; })) err('Reassign this instructor\'s sections first.');
    store.remove('instructors', id); return { ok: true };
  };
  A.saveSection = function (store, r) {
    staff(store, r, true);
    var code = secId(r.code);
    if (!/^[A-Z0-9-]{2,20}$/.test(code)) err('Section code: 2–20 letters, numbers or dashes (e.g., BSN3A).');
    var s = store.get('sections', code);
    if (r.isNew && s) err('Section ' + code + ' already exists.');
    if (!s) s = { id: code, caseId: SAMPLE_ID, groups: 0, task5Unlocked: false, acceptingSubmissions: true };
    var inst = store.get('instructors', clean(r.instructor, 40).toLowerCase());
    if (!inst) err('Choose an instructor.');
    if (r.groups != null && r.groups !== '') s.groups = checkGroups(store, code, r.groups);
    s.instructor = inst.id;
    store.put('sections', s); return { ok: true };
  };
  A.deleteSection = function (store, r) {
    staff(store, r, true);
    var code = secId(r.code);
    if (store.list('records').some(function (x) { return x.section === code; })) err('This section already has student charts. Delete those first.');
    store.remove('sections', code); return { ok: true };
  };

  /* ---------------- dispatcher ---------------- */
  function handle(store, req, keyStore) {
    var fn = A[req && req.action];
    if (!fn) err('Unknown action');
    return fn(store, req, keyStore || {});
  }

  /* first-run seeding: an admin account (+ demo data when asked) */
  function seed(store, opts) {
    opts = opts || {};
    if (store.list('instructors').length) return false;
    var adminPw = opts.adminPassword || 'admin123';
    store.put('instructors', { id: 'admin', name: 'Administrator', role: 'admin', active: true, pwHash: pwHash('admin', adminPw), mustChange: !opts.demo, createdAt: store.now() });
    if (opts.demo) {
      store.put('instructors', { id: 'mreyes', name: 'Prof. M. Reyes', role: 'instructor', active: true, pwHash: pwHash('mreyes', 'demo123'), createdAt: store.now() });
      store.put('instructors', { id: 'jcruz', name: 'Prof. J. Cruz', role: 'instructor', active: true, pwHash: pwHash('jcruz', 'demo123'), createdAt: store.now() });
      store.put('sections', { id: 'BSN3A', instructor: 'mreyes', groups: 6, caseId: SAMPLE_ID, task5Unlocked: false, acceptingSubmissions: true });
      store.put('sections', { id: 'BSN3B', instructor: 'mreyes', groups: 5, caseId: SAMPLE_ID, task5Unlocked: false, acceptingSubmissions: true });
      store.put('sections', { id: 'BSN3C', instructor: 'jcruz', groups: 6, caseId: SAMPLE_ID, task5Unlocked: false, acceptingSubmissions: true });
    }
    return true;
  }

  return { handle: handle, seed: seed, sha256: sha256, SAMPLE_ID: SAMPLE_ID, SAMPLE_CASE: SAMPLE_CASE, blankCase: blankCase, recId: recId };
})();
if (typeof window !== 'undefined') window.EHRCore = EHRCore;
