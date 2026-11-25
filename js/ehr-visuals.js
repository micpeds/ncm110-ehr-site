/* Small SVG chart kit for the EHR (no libraries).
   Single-series charts only: identity comes from the title, abnormal state
   uses the reserved status colors WITH an icon/label (never color alone). */
window.EHRViz = (function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* Adult reference ranges used for the vital-sign charts and tiles */
  const VITALS = [
    { k: 'temp', label: 'Temperature', short: 'Temp', unit: '°C', lo: 36.5, hi: 37.5, min: 35, max: 40, dec: 1 },
    { k: 'hr', label: 'Heart rate', short: 'HR', unit: 'bpm', lo: 60, hi: 100, min: 40, max: 140 },
    { k: 'rr', label: 'Respiratory rate', short: 'RR', unit: '/min', lo: 12, hi: 20, min: 6, max: 36 },
    { k: 'spo2', label: 'Oxygen saturation', short: 'SpO₂', unit: '%', lo: 95, hi: 100, min: 82, max: 100 },
    { k: 'bp', label: 'Blood pressure', short: 'BP', unit: 'mmHg', lo: 90, hi: 139, lo2: 60, hi2: 89, min: 40, max: 180 },
    { k: 'pain', label: 'Pain score', short: 'Pain', unit: '/10', lo: 0, hi: 3, min: 0, max: 10 }
  ];
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;

  /* The ranges a case actually uses: adult defaults, overridden by any
     limits the instructor set for this patient (e.g., a child or newborn). */
  function defs(caseRanges) {
    const r = caseRanges || {};
    return VITALS.map(d => {
      const o = Object.assign({}, d), c = r[d.k] || {};
      ['lo', 'hi', 'lo2', 'hi2'].forEach(k => { const v = num(c[k]); if (v != null) o[k] = v; });
      if (o.lo > o.hi) { const t = o.lo; o.lo = o.hi; o.hi = t; }
      o.min = Math.min(o.min, o.lo); o.max = Math.max(o.max, o.hi);
      o.custom = Object.keys(c).some(k => num(c[k]) != null);
      return o;
    });
  }
  const rangeText = d => d.k === 'bp' ? `${d.lo}–${d.hi} / ${d.lo2}–${d.hi2}` : `${d.lo}–${d.hi}`;
  const toMin = t => { const s = String(t || '').replace(/\D/g, '').padStart(4, '0'); return +s.slice(0, 2) * 60 + +s.slice(2, 4); };
  const fmtT = t => String(t || '').replace(/\D/g, '').padStart(4, '0') + ' H';
  const fmtV = (def, v) => def.dec ? (+v).toFixed(def.dec) : String(Math.round(+v));

  function status(def, v, v2) {
    if (v == null) return null;
    if (def.k === 'bp') {
      if (v > def.hi || (v2 != null && v2 > def.hi2)) return 'high';
      if (v < def.lo || (v2 != null && v2 < def.lo2)) return 'low';
      return 'ok';
    }
    return v > def.hi ? 'high' : v < def.lo ? 'low' : 'ok';
  }
  const STATUS = { high: 'High', low: 'Low', ok: 'Normal' };

  /* readings for one measure, sorted by time */
  function series(vitals, k) {
    return (vitals || []).map(r => ({ t: r.time, m: toMin(r.time), v: num(k === 'bp' ? r.sbp : r[k]), v2: k === 'bp' ? num(r.dbp) : null, o2: r.o2 || '' }))
      .filter(p => p.v != null).sort((a, b) => a.m - b.m);
  }

  const ICON = {
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>', ok: '<path d="M5 12.5l4.5 4.5L19 7"/>'
  };
  const sicon = s => `<svg class="ico sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[s === 'high' ? 'up' : s === 'low' ? 'down' : 'ok']}</svg>`;
  /* status pill: icon + word, so state is never color-only */
  const statusPill = s => s ? `<span class="st-pill st-${s}">${sicon(s)}${STATUS[s]}</span>` : '';

  /* ---------- line / range chart for one vital sign ---------- */
  function vitalChart(def, pts, domain) {
    const W = 320, H = 150, L = 36, R = 14, T = 12, B = 24;
    if (!pts.length) return `<div class="viz-empty">No ${esc(def.label.toLowerCase())} readings</div>`;
    let lo = def.min, hi = def.max;
    pts.forEach(p => { lo = Math.min(lo, p.v2 != null ? p.v2 : p.v); hi = Math.max(hi, p.v); });
    const x0 = domain[0], x1 = Math.max(domain[1], domain[0] + 60);
    const X = m => L + (m - x0) / (x1 - x0) * (W - L - R);
    const Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const ticks = niceTicks(lo, hi, 3);
    let g = '';
    // normal range band (recessive)
    const bandTop = Math.min(def.hi, hi), bandBot = Math.max(def.lo, lo);
    g += `<rect class="viz-band" x="${L}" y="${Y(bandTop)}" width="${W - L - R}" height="${Math.max(0, Y(bandBot) - Y(bandTop))}" rx="3"/>`;
    g += ticks.map(t => `<line class="viz-grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="viz-ax" x="${L - 6}" y="${Y(t) + 3.5}" text-anchor="end">${t}</text>`).join('');
    // x labels: each reading time
    const seen = new Set();
    g += pts.map(p => { if (seen.has(p.m)) return ''; seen.add(p.m); return `<text class="viz-ax" x="${X(p.m)}" y="${H - 6}" text-anchor="middle">${esc(fmtT(p.t).replace(' H', ''))}</text>`; }).join('');
    if (def.k === 'bp') {
      g += pts.map(p => {
        const s = status(def, p.v, p.v2), x = X(p.m);
        return `<line class="viz-range ${s}" x1="${x}" x2="${x}" y1="${Y(p.v)}" y2="${Y(p.v2 != null ? p.v2 : p.v)}"/>
          <circle class="viz-pt ${s}" cx="${x}" cy="${Y(p.v)}" r="4"/>${p.v2 != null ? `<circle class="viz-pt ${s}" cx="${x}" cy="${Y(p.v2)}" r="4"/>` : ''}
          <rect class="viz-hit" x="${x - 12}" y="${Y(p.v) - 12}" width="24" height="${Math.max(24, Y(p.v2 != null ? p.v2 : p.v) - Y(p.v) + 24)}" tabindex="0" data-tip="${esc(fmtT(p.t))} · ${p.v}/${p.v2 != null ? p.v2 : '–'} mmHg · ${STATUS[s]}"/>`;
      }).join('');
    } else {
      if (pts.length > 1) g += `<polyline class="viz-line" points="${pts.map(p => X(p.m) + ',' + Y(p.v)).join(' ')}"/>`;
      g += pts.map(p => {
        const s = status(def, p.v);
        return `<circle class="viz-pt ${s}" cx="${X(p.m)}" cy="${Y(p.v)}" r="4"/><circle class="viz-hit" cx="${X(p.m)}" cy="${Y(p.v)}" r="12" tabindex="0" data-tip="${esc(fmtT(p.t))} · ${fmtV(def, p.v)} ${esc(def.unit)}${p.o2 && def.k === 'spo2' ? ' on ' + esc(p.o2) : ''} · ${STATUS[s]}"/>`;
      }).join('');
    }
    // direct label on the latest reading
    const last = pts[pts.length - 1];
    const lbl = def.k === 'bp' ? `${last.v}/${last.v2 != null ? last.v2 : '–'}` : fmtV(def, last.v);
    const lx = Math.min(X(last.m) + 8, W - R - 2), anchor = X(last.m) > W - 60 ? 'end' : 'start';
    g += `<text class="viz-lbl" x="${anchor === 'end' ? X(last.m) - 8 : lx}" y="${Y(last.v) - 8}" text-anchor="${anchor}">${lbl}</text>`;
    return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(def.label)} over time">${g}</svg>`;
  }
  function niceTicks(lo, hi, n) {
    const span = hi - lo, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(2));
    return out;
  }

  /* ---------- tiny sparkline for tiles ---------- */
  function spark(def, pts) {
    if (pts.length < 2) return '<svg class="spark" viewBox="0 0 90 26" aria-hidden="true"></svg>';
    const lo = Math.min(def.lo, ...pts.map(p => p.v)), hi = Math.max(def.hi, ...pts.map(p => p.v));
    const X = i => 3 + i / (pts.length - 1) * 84, Y = v => 3 + (1 - (v - lo) / (hi - lo || 1)) * 20;
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 90 26" aria-hidden="true"><polyline points="${pts.map((p, i) => X(i) + ',' + Y(p.v)).join(' ')}"/><circle class="${status(def, last.v, last.v2)}" cx="${X(pts.length - 1)}" cy="${Y(last.v)}" r="3"/></svg>`;
  }

  /* ---------- progress ring (single value) ---------- */
  function ring(pct, label) {
    const r = 34, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
    return `<svg class="ring" viewBox="0 0 84 84" role="img" aria-label="${esc(label)} ${p}%"><circle class="ring-bg" cx="42" cy="42" r="${r}"/><circle class="ring-fg" cx="42" cy="42" r="${r}" stroke-dasharray="${c * p / 100} ${c}" transform="rotate(-90 42 42)"/><text x="42" y="47" text-anchor="middle">${p}%</text></svg>`;
  }

  /* ---------- horizontal bars (one series, 0–100) ---------- */
  function hbars(rows, opts) {
    opts = opts || {};
    if (!rows.length) return `<div class="viz-empty">${esc(opts.empty || 'No data yet')}</div>`;
    return `<div class="hbars">${rows.map(r => `<div class="hb-row" tabindex="0" data-tip="${esc(r.label)} · ${esc(r.tip || r.value + '%')}"><span class="hb-lbl">${esc(r.label)}</span><span class="hb-track"><i style="width:${Math.max(0, Math.min(100, r.value))}%"></i></span><span class="hb-val">${esc(r.text != null ? r.text : r.value + '%')}</span></div>`).join('')}</div>`;
  }

  /* ---------- lab value against its reference range ---------- */
  function labRange(row) {
    const m = /(-?\d+(?:\.\d+)?)\s*[–-]\s*(-?\d+(?:\.\d+)?)/.exec(String(row.ref || '')); const v = num(row.value);
    if (!m || v == null) return '';
    const lo = +m[1], hi = +m[2], span = hi - lo || 1, min = Math.min(lo - span * 0.6, v), max = Math.max(hi + span * 0.6, v);
    const P = x => (x - min) / (max - min) * 100;
    const s = v > hi ? 'high' : v < lo ? 'low' : 'ok';
    return `<span class="lab-range" data-tip="${esc(row.test)} ${esc(row.value)} ${esc(row.unit)} · reference ${lo}–${hi} · ${STATUS[s]}" tabindex="0"><span class="lr-ref" style="left:${P(lo)}%;width:${P(hi) - P(lo)}%"></span><span class="lr-dot ${s}" style="left:${P(v)}%"></span></span>`;
  }

  /* ---------- one shared tooltip for every [data-tip] ---------- */
  let tip;
  function showTip(el, x, y) {
    if (!tip) { tip = document.createElement('div'); tip.className = 'viz-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.textContent = el.getAttribute('data-tip'); tip.style.display = 'block';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
    tip.style.top = Math.max(8, y - h - 12) + 'px';
  }
  const hideTip = () => { if (tip) tip.style.display = 'none'; };
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); });
  document.addEventListener('mousemove', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && tip && tip.style.display === 'block') showTip(el, e.clientX, e.clientY); });
  document.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); } });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('scroll', hideTip, true);

  return { VITALS, defs, rangeText, series, status, statusPill, vitalChart, spark, ring, hbars, labRange, toMin, fmtT, fmtV, STATUS };
})();
