/* Does Smart Insights cry wolf, and does it catch a real leak?
   node tests/detection.cjs

   Builds synthetic meters the way the platform stores them - a lifetime register
   climbing at the cadence the meter reports - and counts how often the engine
   calls a leak. Healthy meters must almost never be flagged; leaking ones must
   be. The numbers are deterministic (seeded), so a change that makes the engine
   jumpier shows up here as a failure rather than as a surprise on site.      */
const I = require('../insights.js');
const HOUR = 3600000, DAY = 86400000, TZ = 4 * HOUR;

let seed = 20260919;
function rnd(){ seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

/* A believable day: busy morning and evening, and - this is the point of the
   whole leak test - NOTHING between 01:00 and 05:00, because a healthy building
   stops drawing water while everyone is asleep. Water that never stops is
   exactly what the engine is looking for.                                    */
const SHAPE = [0.06,0,0,0,0,0.10,0.35,0.70,0.85,0.70,0.55,0.50,
               0.55,0.50,0.45,0.50,0.65,0.85,1.00,0.90,0.70,0.45,0.20,0.06];

/* readings for one meter, as the platform stores them: a lifetime register
   climbing at the meter's own cadence.
     leakLpm    a constant extra flow that never stops
     leakFromDay  the day it starts (default: it was always there)
     nightDraws   some nights a tap or a flush at 02:00 - real, and not a leak */
function build(name, opts){
  const cadenceMin = opts.cadenceMin, days = opts.days || 35;
  const perDay = opts.m3PerDay, leak = (opts.leakLpm || 0) * 60 / 1000;      // L/min -> m³/h
  const leakFrom = opts.leakFromDay == null ? -1 : opts.leakFromDay;
  const shapeSum = SHAPE.reduce((a, b) => a + b, 0);
  const now = Date.UTC(2026, 8, 16, 7, 0, 0);                                // fixed "now", no clock
  const start = now - days * DAY;
  const rows = [];
  let total = 1000 + Math.floor(rnd() * 5000), t = start;
  while (t <= now){
    const hour = new Date(t + TZ).getUTCHours();
    const dow = new Date(t + TZ).getUTCDay();
    const dayNo = Math.floor((t - start) / DAY);
    const weekday = opts.weekdayEffect && (dow === 5 || dow === 6) ? 1.6 : 1;
    let rate = perDay / shapeSum * SHAPE[hour] * weekday * (0.85 + 0.3 * rnd());
    if (opts.nightDraws && hour === 2 && rnd() < 0.25) rate += 0.3;          // an occasional night draw
    if (leak && dayNo >= leakFrom) rate += leak;
    total += rate * (cadenceMin / 60);
    rows.push({ device: name, key: 949, ts: t, v: Math.round(total * 100) / 100 });
    t += cadenceMin * 60000;
  }
  return { now: now, rows: rows };
}

function leakFindings(meter, built){
  const res = I.analyse({ now: built.now, meters: [{ id: meter, name: meter, type: 'Water Meter' }],
                          hourly: built.rows, daily: [] }, {});
  const r = res.meters[meter];
  return { leak: r.findings.some(f => f.type === 'leak'), night: r.night, findings: r.findings };
}

let failures = 0;
function report(label, got, want, ok){
  const pass = ok(got);
  if (!pass) failures++;
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + label + ' — ' + got + ' (wanted ' + want + ')');
}

console.log('\nHealthy meters must not be called leaks');
console.log('='.repeat(38));
for (const c of [{ cadenceMin: 20, n: 60, label: 'every 20 min' },
                 { cadenceMin: 420, n: 40, label: 'every 7 h' }]){
  let flagged = 0;
  for (let i = 0; i < c.n; i++){
    const built = build('healthy' + i, { cadenceMin: c.cadenceMin, m3PerDay: 8 + rnd() * 60,
                                         weekdayEffect: i % 3 === 0, nightDraws: i % 2 === 0 });
    if (leakFindings('healthy' + i, built).leak) flagged++;
  }
  const pct = (flagged / c.n * 100).toFixed(1);
  report('healthy meters ' + c.label + ' flagged as leaking', flagged + '/' + c.n + ' (' + pct + '%)',
         'under 5%', () => flagged / c.n < 0.05);
}

console.log('\nReal leaks must be found');
console.log('='.repeat(25));
for (const c of [{ cadenceMin: 20,  lpm: 8.3, want: 0.8,  label: '8.3 L/min, meter every 20 min' },
                 { cadenceMin: 20,  lpm: 3.3, want: 0.3,  label: '3.3 L/min, meter every 20 min' },
                 /* a meter that only reports every 7 h cannot be watched hour by hour, so the
                    engine looks for its lowest flow STEPPING UP - which needs the leak to start
                    inside the window, as a new leak does */
                 { cadenceMin: 420, lpm: 8.3, want: 0.5, from: 20, label: '8.3 L/min starting mid-month, meter every 7 h' }]){
  let found = 0; const n = 40;
  for (let i = 0; i < n; i++){
    const built = build('leaky' + i, { cadenceMin: c.cadenceMin, m3PerDay: 8 + rnd() * 60,
                                       leakLpm: c.lpm, leakFromDay: c.from });
    if (leakFindings('leaky' + i, built).leak) found++;
  }
  const pct = (found / n * 100).toFixed(0);
  report(c.label, found + '/' + n + ' (' + pct + '%)', 'at least ' + (c.want * 100) + '%', () => found / n >= c.want);
}

console.log('\n' + (failures === 0 ? '  ALL CHECKS PASSED' : '  ' + failures + ' CHECK(S) FAILED'));
process.exit(failures ? 1 : 0);
