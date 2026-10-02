/* Runs Smart Insights over the REAL exports and checks what it concludes.
   node tests/insights.cjs
   Every reading is fed in, exactly as the browser now fetches them - the engine
   must never be judged on a thinned copy, which is what it used to get.      */
const I = require('../insights.js');
const P = require('./fixture.json');
const HOUR = 3600000;
const f = ts => new Date(ts + 4 * HOUR).toISOString().slice(0, 16).replace('T', ' ');

let failures = 0, checks = 0;
function check(ok, label, detail){
  checks++; if (!ok) failures++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? ' — ' + detail : ''));
}

const METERS = [
  { key: 'golf',    id: 'golf',    name: 'Golf Academy', type: 'Flow Meter' },
  { key: 'stables', id: 'stables', name: '30 stables',   type: 'Water Meter' },
];

const hourly = [];
let now = 0;
METERS.forEach(M => {
  const ex = P[M.key], col = p => ex.header.find(h => h.startsWith(p));
  [[949, 'Ttl Flow Cons.'], [1041, 'Wtr Cons./D']].forEach(pair => {
    const c = col(pair[1]); if (!c) return;
    ex.rows.forEach(r => { if (r[c] != null) hourly.push({ device: M.id, key: pair[0], ts: r.ts, v: r[c] }); });
  });
  now = Math.max(now, Math.max.apply(null, ex.rows.map(r => r.ts)) + 30 * 60000);
});

const res = I.analyse({ now: now, meters: METERS, hourly: hourly, daily: [] }, {});
console.log('as of ' + f(now) + ' Dubai · ' + hourly.length + ' readings fed in');

METERS.forEach(M => {
  const r = res.meters[M.id], n = r.night;
  console.log('\n=== ' + r.name);
  console.log('  reports every ' + r.intervalMin + ' min · ' + (r.lowRes ? 'base flow' : 'night by night') +
              ' · daily from ' + r.dailySource + ' · ' + r.corrections + ' register faults corrected');
  console.log('  normal day ' + r.daily.normalDay + ' m³' +
              (r.daily.partialDays ? ' · ' + r.daily.partialDays + ' part-silent day(s) left out' : ''));
  r.findings.forEach(x => console.log('    [' + x.severity + '/' + x.confidence + '] ' + x.title + ' — ' + x.summary +
                                      (x.m3PerMonth ? '  (' + x.m3PerMonth + ' m³/month)' : '')));
  if (!r.findings.length) console.log('    no findings');

  /* nothing half-written may reach a person */
  const text = r.findings.map(x => [x.title, x.summary, x.detail, x.causes, (x.checks || []).join(' ')].join(' ')).join(' ');
  check(!/undefined|NaN|\[object|null m³/.test(text), M.name + ': no half-written text in what the user reads',
        (text.match(/undefined|NaN|\[object|null m³/) || [''])[0] || 'clean');
  check(r.dailySource === 'lifetime total', M.name + ': daily figures come from the register, not the platform counter', r.dailySource);
});

const golf = res.meters.golf, stables = res.meters.stables;

check(golf.night.status === 'continuous', 'Golf Academy: the constant night flow is still reported as a possible leak',
      golf.night.status + ', ' + (golf.night.mnf * 1000 / 60).toFixed(1) + ' L/min');
check(golf.findings.some(x => x.type === 'leak' && x.m3PerMonth > 100),
      'Golf Academy: the leak is costed per month',
      String((golf.findings.find(x => x.type === 'leak') || {}).m3PerMonth));

const step = golf.findings.filter(x => x.type === 'step')[0];
check(step && step.severity === 'info' && /Back in normal use/.test(step.title),
      'Golf Academy: the August shutdown and reopening reads as information, not an alarm',
      step ? step.severity + ' · ' + step.title : 'no step finding');
check(golf.daily.normalDay > 150, 'Golf Academy: a normal day reflects the level it runs at now, not the quiet spell',
      golf.daily.normalDay + ' m³');

check(stables.findings.some(x => x.type === 'silent'), '30 stables: the meter going quiet is reported',
      (stables.silence || {}).ageH + ' h since the last reading, usually every ' + (stables.silence || {}).usualH + ' h');
check(stables.night.status !== 'continuous', '30 stables: its steady base flow is not called a leak', stables.night.status);

check(res.summary.analysed === 2 && res.summary.leaks >= 1 && isFinite(res.summary.lossM3PerMonth),
      'the summary totals add up', JSON.stringify(res.summary));

/* a meter with nothing to go on must say so rather than guess */
const empty = I.analyse({ now: now, meters: [{ id: 'x', name: 'New meter', type: 'Water Meter' }], hourly: [], daily: [] }, {}).meters.x;
check(empty.findings.every(x => x.type !== 'leak') && empty.night.status === 'insufficient',
      'a meter with no readings claims nothing', empty.night.status);

console.log('\n' + (failures === 0 ? '  ALL ' + checks + ' CHECKS PASSED' : '  ' + failures + ' of ' + checks + ' CHECKS FAILED'));
process.exit(failures ? 1 : 0);
