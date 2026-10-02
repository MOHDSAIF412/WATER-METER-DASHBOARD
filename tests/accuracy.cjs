/* Proves the water arithmetic on REAL portal exports.      node tests/accuracy.cjs
   Every disagreement with the portal's own daily figure must have a named cause
   found in the readings; an unexplained one fails the run.                     */
const U = require('../usage.js');
const P = require('./fixture.json');
const HOUR = 3600000, DAY = 86400000, TZ = 4 * HOUR;
const f = ts => new Date(ts + TZ).toISOString().slice(0, 16).replace('T', ' ');
const day = ts => new Date(ts + TZ).toISOString().slice(0, 10);
const r2 = v => Math.round(v * 100) / 100;

let failures = 0, checks = 0;
function check(ok, label, detail){
  checks++; if (!ok) failures++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? ' — ' + detail : ''));
}
const H = s => console.log('\n' + s + '\n' + '='.repeat(s.length));

function series(ex, prefix){
  const col = ex.header.find(h => h.startsWith(prefix));
  if (!col) return null;
  return ex.rows.filter(r => r[col] != null).map(r => ({ ts: r.ts, v: r[col] })).sort((a, b) => a.ts - b.ts);
}

const METERS = [
  { key: 'golf',    name: 'Golf Academy', cadence: '20 min' },
  { key: 'stables', name: '30 stables',   cadence: '7 h' },
];

for (const M of METERS){
  H('Meter: ' + M.name + '  (reports every ' + M.cadence + ')');
  const raw = series(P[M.key], 'Ttl Flow Cons.');
  const reg = U.clean(raw);
  const first = day(raw[0].ts), last = day(raw[raw.length - 1].ts);
  console.log('  readings: ' + raw.length + ' from ' + f(raw[0].ts) + ' to ' + f(raw[raw.length - 1].ts));

  let gaps = [], maxGap = 0;
  for (let i = 1; i < raw.length; i++){
    const h = (raw[i].ts - raw[i - 1].ts) / HOUR;
    maxGap = Math.max(maxGap, h);
    if (h > U.MAX_GAP_H) gaps.push(f(raw[i - 1].ts) + ' → ' + f(raw[i].ts) + ' (' + h.toFixed(1) + ' h)');
  }
  console.log('  longest gap: ' + maxGap.toFixed(1) + ' h' + (gaps.length ? ' · ' + gaps.length + ' too long to split across days:' : ''));
  gaps.forEach(g => console.log('      ' + g));

  const cor = reg.corrections || [];
  console.log('  register faults corrected: ' + cor.length);
  cor.slice(0, 4).forEach(c => console.log('      ' + f(c.ts) + '  step ' + c.jump + ' m³ → a meter fault, not water'));
  if (cor.length > 4) console.log('      … and ' + (cor.length - 4) + ' more');

  check(reg.length === raw.length, 'every reading kept', reg.length + ' of ' + raw.length);

  let back = 0;
  for (let i = 1; i < reg.length; i++) if (reg[i].v < reg[i - 1].v - 1e-9) back++;
  check(back === 0, 'the cleaned register never goes backwards', back + ' backward steps');

  /* days must telescope exactly into the register, within each unbroken run */
  const from = U.addDays(first, 1), to = U.addDays(last, -1);
  const all = U.daily(reg, from, to);
  const days = all.filter(d => d.v != null);
  let worst = 0, counted = 0, run = null;
  const closeRun = () => {
    if (run && run.n > 1){
      const span = U.used(reg, U.dayStart(run.from), U.dayStart(U.addDays(run.to, 1)));
      if (span){ counted += run.n; worst = Math.max(worst, Math.abs(run.sum - span.m3)); }
    }
    run = null;
  };
  all.forEach(d => {
    if (d.v == null){ closeRun(); return; }
    if (run && run.to === U.addDays(d.d, -1)){ run.to = d.d; run.sum += d.v; run.n++; }
    else { closeRun(); run = { from: d.d, to: d.d, sum: d.v, n: 1 }; }
  });
  closeRun();
  check(worst < 0.01, counted + ' consecutive days add up to the register difference',
        'largest difference ' + worst.toFixed(4) + ' m³');

  check(!days.some(d => d.v < 0), 'no day uses a negative amount of water');

  /* the same answer from a shorter fetch window */
  const half = raw.slice(Math.floor(raw.length / 2));
  const reg2 = U.clean(half);
  let startTs = half[0].ts;
  for (let i = 1; i < half.length; i++) if ((half[i].ts - half[i - 1].ts) / HOUR > U.MAX_GAP_H) startTs = half[i].ts;
  const d0 = U.addDays(day(startTs), 1), d1 = U.addDays(last, -1);
  const a1 = U.used(reg, U.dayStart(d0), U.dayStart(d1)), a2 = U.used(reg2, U.dayStart(d0), U.dayStart(d1));
  check(a1 && a2 && Math.abs(a1.m3 - a2.m3) < 0.05, 'a shorter fetch window gives the same total',
        a1 && a2 ? r2(a1.m3) + ' vs ' + r2(a2.m3) + ' m³' : 'no overlap');

  /* the database may return rows in any order */
  const shuffled = raw.slice();
  for (let i = shuffled.length - 1; i > 0; i--){ const j = (i * 7919) % (i + 1); const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t; }
  const regS = U.clean(shuffled);
  check(Math.abs(regS[regS.length - 1].v - reg[reg.length - 1].v) < 1e-6, 'the row order from the database does not matter');

  const shown = U.register(reg);
  check(Math.abs(shown - raw[raw.length - 1].v) < 0.01, 'the reading shown equals the meter’s own display',
        r2(shown) + ' vs ' + raw[raw.length - 1].v);

  /* an independent measurement: the meter's own flow rate */
  const flow = series(P[M.key], 'Flow (M');
  if (flow && flow.length > 50){
    let vol = 0;
    for (let i = 1; i < flow.length; i++){
      const h = (flow[i].ts - flow[i - 1].ts) / HOUR;
      if (h > 0 && h <= U.MAX_GAP_H) vol += (flow[i].v + flow[i - 1].v) / 2 * h;
    }
    const regVol = U.used(reg, flow[0].ts, flow[flow.length - 1].ts);
    const err = Math.abs(vol - regVol.m3) / regVol.m3 * 100;
    check(err < 1, 'agrees with the meter’s separate flow-rate readings',
          r2(vol) + ' m³ by flow rate vs ' + r2(regVol.m3) + ' m³ by register = ' + err.toFixed(2) + '% apart');
  }

  /* every disagreement with the portal's daily counter must have a cause */
  const interval = series(P[M.key], 'Flow Cons.');
  const pd = series(P[M.key], 'Wtr Cons./D');
  if (pd && pd.length){
    const portalDay = {};
    for (let i = 1; i < pd.length; i++)
      if (pd[i].v < pd[i - 1].v - 0.01) portalDay[day(pd[i - 1].ts)] = pd[i - 1].v;
    let explained = 0, unexplained = 0; const rows = [];
    Object.keys(portalDay).sort().forEach(d => {
      if (d < from || d > to) return;
      const mine = days.find(x => x.d === d);
      if (!mine) return;
      const diff = portalDay[d] - mine.v;
      if (Math.abs(diff) < Math.max(1, mine.v * 0.02)) return;
      const t0 = U.dayStart(d), t1 = t0 + DAY;
      const inDay = reg.filter(x => x.ts >= t0 && x.ts < t1);
      const NEAR = 4 * HOUR;
      const faultNearMidnight = reg.some(x => x.estimated &&
        ((x.ts >= t0 - NEAR && x.ts < t0 + NEAR) || (x.ts >= t1 - NEAR && x.ts < t1 + NEAR)));
      const fcDay = interval ? interval.filter(x => x.ts > t0 && x.ts <= t1).reduce((a, x) => a + x.v, 0) : null;
      const fcAgrees = fcDay != null && mine.v > 0 && Math.abs(fcDay - mine.v) <= Math.max(1, mine.v * 0.15);
      let why;
      if (inDay.some(x => x.estimated)) why = 'meter fault that day, corrected';
      else if (faultNearMidnight)       why = 'meter fault across midnight — it moves the split between the two days';
      else if (inDay.length <= 4)       why = 'reports every ' + M.cadence + ': the counter adds whole readings, so its day is not midnight to midnight';
      else if (fcAgrees)                why = 'the portal counter is wrong: the meter’s own interval column says ' + r2(fcDay) + ' m³, agreeing with the register';
      else if (diff > 0)                why = 'counter did not reset at midnight';
      else                              why = null;
      if (why){ explained++; rows.push([d, r2(portalDay[d]), r2(mine.v), why]); }
      else { unexplained++; rows.push([d, r2(portalDay[d]), r2(mine.v), 'UNEXPLAINED']); }
    });
    console.log('  portal daily counter vs the register: ' + rows.length + ' day(s) disagree by more than 2%');
    rows.slice(0, 4).forEach(r => console.log('      ' + r[0] + '  portal ' + r[1] + ' · register ' + r[2] + ' m³ — ' + r[3]));
    if (rows.length > 4) console.log('      … and ' + (rows.length - 4) + ' more');
    check(unexplained === 0, 'every disagreement with the portal counter has a cause in the readings',
          explained + ' explained, ' + unexplained + ' unexplained');
  }

  const est = days.filter(d => d.estimated).length;
  const partial = days.filter(d => d.covered != null && d.covered < 0.9).length;
  console.log('  days exact: ' + (days.length - est) + ' · interpolated midnight: ' + est + ' · part-silent: ' + partial);
}

H('Edge cases');
{
  const one = U.clean([{ ts: 1000000000000, v: 50 }]);
  check(one.length === 1 && U.register(one) === 50, 'a meter with a single reading');
  const none = U.clean([]);
  check(none.length === 0 && U.latest(none) === null && U.register(none) === null, 'a meter with no readings at all');
  const dup = U.clean([{ ts: 1, v: 10 }, { ts: 1, v: 10 }, { ts: 2, v: 11 }]);
  check(dup.length === 2, 'the same timestamp twice is counted once');
  const junk = U.clean([{ ts: 1, v: 10 }, { ts: 2, v: NaN }, { ts: 3, v: 12 }, null, { ts: 'x', v: 5 }]);
  check(junk.length === 2 && junk[junk.length - 1].v === 12, 'rubbish rows are ignored, not counted as water');
  check(U.addDays('2026-02-28', 1) === '2026-03-01', 'end of February');
  check(U.addMonths('2026-01-01', 1) === '2026-02-01' && U.addMonths('2026-12-01', 1) === '2027-01-01' &&
        U.addMonths('2026-01-01', -1) === '2025-12-01', 'month arithmetic across a year end');
  check(U.localDay(U.dayStart('2026-09-18')) === '2026-09-18', 'a day starts on the day it names, Dubai time');
  check(new Date(U.dayStart('2026-09-18')).toISOString() === '2026-09-17T20:00:00.000Z', 'Dubai midnight is 20:00 UTC');
}

H('Result');
console.log(failures === 0 ? '  ALL ' + checks + ' CHECKS PASSED' : '  ' + failures + ' of ' + checks + ' CHECKS FAILED');
process.exit(failures ? 1 : 0);
