/* API layer.
   • Live mode (API_URL set): every action is POSTed to Google Apps Script.
   • Demo mode (API_URL empty): the SAME core logic (core.js) runs in the
     browser against localStorage, seeded with demo accounts. */
(function () {
  const CFG = window.EHR_CONFIG || {};
  const DEMO = !CFG.API_URL;
  const DB_KEY = 'ncm110_ehr_demo_v2';
  const TOKEN_KEY = 'ncm110_staff_token';

  /* ---------------- demo store (localStorage) ---------------- */
  function load() {
    try { const d = JSON.parse(localStorage.getItem(DB_KEY)); if (d && d.instructors) return d; } catch (e) {}
    return { instructors: {}, sections: {}, cases: {}, records: {}, sessions: {} };
  }
  let db = load();
  const persist = () => { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {} };
  const demoStore = {
    list: t => Object.values(db[t] || {}).map(x => JSON.parse(JSON.stringify(x))),
    get: (t, id) => (db[t] && db[t][id]) ? JSON.parse(JSON.stringify(db[t][id])) : null,
    put: (t, o) => { (db[t] = db[t] || {})[o.id] = JSON.parse(JSON.stringify(o)); persist(); },
    remove: (t, id) => { if (db[t]) delete db[t][id]; persist(); },
    withLock: fn => fn(),
    sessionGet: tok => { const s = db.sessions[tok]; return s && s.exp > Date.now() ? s.v : null; },
    sessionPut: (tok, v) => { db.sessions[tok] = { v, exp: Date.now() + 12 * 3600e3 }; persist(); },
    sessionDel: tok => { delete db.sessions[tok]; persist(); },
    now: () => Date.now(),
    token: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''),
    slowDown: () => {}
  };
  if (DEMO) { db = load(); if (EHRCore.seed(demoStore, { demo: true, adminPassword: 'admin123' })) persist(); }

  async function call(action, payload) {
    const req = Object.assign({ action }, payload || {});
    if (DEMO) {
      db = load(); // pick up changes made in another tab
      await new Promise(r => setTimeout(r, 120));
      return JSON.parse(JSON.stringify(EHRCore.handle(demoStore, req)));
    }
    const res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight Apps Script can't answer
      body: JSON.stringify(req)
    });
    if (!res.ok) throw new Error('Server error ' + res.status);
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'Request failed');
    return out.result;
  }

  /* staff calls carry the session token automatically */
  const token = {
    get: () => sessionStorage.getItem(TOKEN_KEY) || '',
    set: t => t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY)
  };
  const staff = (action, payload) => call(action, Object.assign({ token: token.get() }, payload || {}));

  window.API = {
    DEMO, call, staff, token,
    idOf: (section, group) => EHRCore.recId(section, group),
    // students
    getSections: () => call('getSections'),
    getConfig: section => call('getConfig', { section }),
    login: p => call('login', p),
    save: p => call('save', p),
    submit: p => call('submit', p),
    resetDemo: () => { localStorage.removeItem(DB_KEY); }
  };
})();
