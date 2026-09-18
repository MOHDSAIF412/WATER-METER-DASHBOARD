/* ============================================================
   OPERON water usage - the one place consumption is calculated.
   Used by index.html, aareport.html and insights.js, so every figure on
   every page comes from the same, tested arithmetic.

   Source of truth: the meter's LIFETIME TOTAL register ("Ttl Flow Cons.",
   key 949). Water used between two moments = register at the end minus
   register at the start. Nothing else is summed or averaged.

   Why not the platform's daily counter ("Wtr Cons./D", key 1041)?
   Checked against portal exports, Sep 2026:
   - on water meters that report every 7 h it adds up 3 or 4 readings a day,
     so it swings 24-53 m3 while the register shows a steady 44-46 m3;
   - on flow meters it resets at 00:00-00:53 and on some days not at all
     (Golf Academy: 700 m3 reported, 206 m3 used);
   - on water meters its day started at 04:00 until about 7 Sep, then at 00:00.

   Days run midnight to midnight, Asia/Dubai (UTC+4, no daylight saving).

   Register glitches (falls, 0 during reboots, impossible jumps) are corrected
   by tracking the shift, not by dropping readings - see clean() below.

   Exact vs estimated. The register is exact at each reading. At a moment
   between two readings (such as midnight) the value is interpolated. If the
   readings either side are at most 60 min apart that is treated as measured;
   further apart, the result is flagged estimated. A period's TOTAL is still
   exact whenever both of its ends fall on readings; only the split between
   neighbouring days is estimated. Never interpolated across more than 15 h.
   ============================================================ */
(function(root){
  'use strict';

  var HOUR = 3600000, DAY = 86400000, TZ = 4 * HOUR;
  var LIFETIME_KEY = 949;
  var MAX_GAP_H = 15;             // no value is interpolated across a longer gap (allows one missed 7-hourly reading)
  var EXACT_GAP_MIN = 60;         // readings this close either side count as measured
  var MAX_RATE = 500;             // m3/h: faster than any real meter here, so such a step is not counted as use

  function localDay(ts){ return new Date(ts + TZ).toISOString().slice(0, 10); }
  function dayStart(key){ return Date.parse(key + 'T00:00:00Z') - TZ; }
  function addDays(key, n){ return new Date(Date.parse(key + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
  function monthStart(key){ return dayStart(key.slice(0, 7) + '-01'); }
  function addMonths(key, n){
    var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + (m < 9 ? '0' : '') + (m + 1) + '-01';
  }

  /* ---------- 1. clean the register ----------
     A lifetime register can only stay the same or go up, and it cannot rise
     faster than water can flow. Golf Academy's register (Jul-Sep 2026) broke
     both rules dozens of times: during night irrigation it fell by ~235 m³
     (later ~490 m³) and jumped back - after one reading or after ~20 hours -
     and read 0 while rebooting. Meanwhile it kept counting normally, just
     shifted. The meter's separate flow-rate readings agree with the corrected
     register to 0.06% over 65 days.

     This needs EVERY reading. On the same data thinned to one reading per
     hour, no method got closer than 20%: a jump and its recovery inside one
     hour cannot be told apart from water. So fetching never thins readings.

     So the register is rebuilt from its own steps between readings:
       - a normal step (up, at a possible rate) is water used - kept exactly;
       - a tiny fall (rounding, up to 0.5 m³) is no water;
       - any other fall, or a rise faster than 500 m³/h, is a register jump,
         not water. That step's water is estimated from the flow rate of the
         normal steps just before and just after it, and marked estimated.
     No reading is dropped. A replaced or reset meter is absorbed the same way,
     so totals stay continuous. Where a jump happens across a gap of more than
     15 h, that step's water is unknown.
     Returns readings {ts, v (corrected), raw, estimated?, gap?};
     .corrections lists every jump found.                                     */
  var NOISE_M3 = 0.5;
  function clean(readings){
    var r = readings.filter(function(x){ return x && isFinite(x.ts) && isFinite(x.v); })
                    .map(function(x){ return { ts: Number(x.ts), v: Number(x.v) }; })
                    .sort(function(a, b){ return a.ts - b.ts; })
                    .filter(function(x, i, arr){ return i === 0 || x.ts !== arr[i - 1].ts; });
    if (!r.length){ var none = []; none.corrections = none.removed = []; return none; }

    /* water in each step between readings; null where the register jumped */
    var inc = [0], hrs = [0], corrections = [];
    for (var i = 1; i < r.length; i++){
      var h = (r[i].ts - r[i - 1].ts) / HOUR, d = r[i].v - r[i - 1].v;
      hrs.push(h);
      if (d < 0 && d >= -NOISE_M3) inc.push(0);
      else if (d < 0 || d / Math.max(h, 1 / 60) > MAX_RATE){ inc.push(null); corrections.push({ ts: r[i].ts, raw: r[i].v, jump: Math.round(d * 100) / 100 }); }
      else inc.push(d);
    }
    /* fill each jump step from the nearest normal flow rates on both sides */
    function rateNear(i, dir){
      for (var j = i + dir; j > 0 && j < inc.length; j += dir)
        if (inc[j] != null && hrs[j] > 0 && hrs[j] <= MAX_GAP_H) return inc[j] / hrs[j];
      return null;
    }
    var out = [{ ts: r[0].ts, v: r[0].v, raw: r[0].v }], total = r[0].v;
    for (var k = 1; k < r.length; k++){
      var c = { ts: r[k].ts, raw: r[k].v };
      if (inc[k] == null){
        var before = rateNear(k, -1), after = rateNear(k, 1);
        var rate = before != null && after != null ? (before + after) / 2 : (before != null ? before : (after != null ? after : 0));
        if (hrs[k] > MAX_GAP_H) c.gap = true;                          // water across this step is unknown
        else total += Math.min(rate, MAX_RATE) * hrs[k];
        c.estimated = true;
      } else total += inc[k];                                          // a normal step, even across a gap, is exact water
      c.v = total;
      out.push(c);
    }
    out.corrections = corrections;
    out.removed = corrections;
    return out;
  }

  /* ---------- 2. register value at any moment ----------
     { v, estimated } or null when there is no reading on both sides within 15 h.
     A reading exactly at t is exact.                                          */
  function valueAt(r, t){
    if (!r.length || t < r[0].ts || t > r[r.length - 1].ts) return null;
    var lo = 0, hi = r.length - 1;
    while (hi - lo > 1){ var mid = (lo + hi) >> 1; if (r[mid].ts <= t) lo = mid; else hi = mid; }
    var a = r[lo], b = r[hi];
    if (a.ts === t) return { v: a.v, estimated: !!a.estimated, gapMin: 0 };
    if (b.ts === t) return { v: b.v, estimated: !!b.estimated, gapMin: 0 };
    var gap = b.ts - a.ts;
    if (gap > MAX_GAP_H * HOUR || b.v < a.v || b.gap) return null;
    return { v: a.v + (b.v - a.v) * (t - a.ts) / gap,
             estimated: gap > EXACT_GAP_MIN * 60000 || !!b.estimated, gapMin: Math.round(gap / 60000) };
  }

  /* water used from `from` to `to`: { m3, estimated } or null */
  function used(r, from, to){
    var a = valueAt(r, from), b = valueAt(r, to);
    if (!a || !b || b.v < a.v) return null;
    var est = a.estimated || b.estimated;
    var lo = 0, hi = r.length;                                           // first reading after `from`
    while (lo < hi){ var mid = (lo + hi) >> 1; if (r[mid].ts <= from) lo = mid + 1; else hi = mid; }
    for (var i = lo; i < r.length && r[i].ts <= to && !est; i++)          // a corrected register jump inside the period
      if (r[i].estimated) est = true;
    return { m3: b.v - a.v, estimated: est };
  }

  /* water used from `from` up to the latest reading (for "so far" figures) */
  function usedSoFar(r, from){
    var last = r[r.length - 1];
    if (!last || last.ts <= from) return { m3: 0, estimated: false, asOf: last ? last.ts : null, noReadingYet: true };
    var u = used(r, from, last.ts);
    if (!u) return null;
    return { m3: u.m3, estimated: u.estimated, asOf: last.ts, noReadingYet: false };
  }

  /* How much of a day the meter was actually reporting for, 0 to 1. A day is
     only "covered" where consecutive readings are close enough to account for
     the water between them; a silence longer than MAX_GAP_H leaves that part
     of the day unaccounted for. A day with a long outage still has a value -
     the water is real - but it is NOT a normal day, so anything judging what
     normal looks like should leave it out.                                   */
  function coverage(r, from, to){
    if (!r.length || to <= from) return 0;
    var span = to - from, seen = 0, limit = MAX_GAP_H * HOUR;
    for (var i = 1; i < r.length; i++){
      if (r[i].ts <= from) continue;
      if (r[i - 1].ts >= to) break;
      var step = r[i].ts - r[i - 1].ts;
      if (step > limit || r[i].gap) continue;                       // unaccounted stretch
      seen += Math.min(r[i].ts, to) - Math.max(r[i - 1].ts, from);
    }
    return Math.max(0, Math.min(1, seen / span));
  }

  /* one row per local day from fromKey to toKey inclusive:
     { d, v, estimated, covered } (v null = unknown, covered = 0..1)          */
  function daily(r, fromKey, toKey){
    var out = [];
    for (var d = fromKey, g = 0; d <= toKey && g < 5000; d = addDays(d, 1), g++){
      var a = dayStart(d), b = dayStart(addDays(d, 1));
      var u = used(r, a, b);
      out.push({ d: d, v: u ? u.m3 : null, estimated: u ? u.estimated : false,
                 covered: Math.round(coverage(r, a, b) * 100) / 100 });
    }
    return out;
  }

  function latest(r){ return r.length ? r[r.length - 1] : null; }

  /* What the meter's own register showed at a moment, ignoring glitches.
     The corrected series starts from the first reading fetched, so it sits a
     constant amount away from the meter's display. That amount is read from
     real readings within 24 h of the moment. During a long glitch the raw
     register reads LOW (never high - jumps up are marked estimated and left
     out), so the true amount is the largest raw-minus-corrected difference.  */
  function offset(r, at){
    if (at == null){ var l = latest(r); at = l ? l.ts : 0; }
    var best = null;
    for (var i = 0; i < r.length; i++){
      var x = r[i];
      if (x.raw == null || x.estimated || Math.abs(x.ts - at) > DAY) continue;
      var dlt = x.raw - x.v;
      if (best == null || dlt > best) best = dlt;
    }
    return best == null ? 0 : best;
  }
  function register(r, at){
    var l = latest(r);
    if (!l) return null;
    if (at == null) return l.v + offset(r, l.ts);
    var va = valueAt(r, Math.min(at, l.ts));
    return va ? va.v + offset(r, Math.min(at, l.ts)) : null;
  }

  /* ---------- 3. fetching (browser) ----------
     Every register reading in one continuous range - never thinned out, and
     never separate windows: a jump that started before a window would shift
     one window against another. Differences inside one range are always safe. */
  var TYPES = "d.type in ('Water Meter','Flow Meter')";
  function scopeSql(opts){
    return opts.devices ? "l.device in (" + opts.devices.map(function(id){ return "'" + String(id).replace(/'/g, "''") + "'"; }).join(',') + ')'
                        : "d.org='" + opts.org + "' and " + TYPES;
  }
  /* every reading between from and to, padded 13 h each side so the ends can be interpolated */
  async function fetchRange(sql, opts, from, to){
    var a = Math.floor(from - (MAX_GAP_H + 1) * HOUR), b = Math.ceil(to + (MAX_GAP_H + 1) * HOUR);
    var rows = await sql('select l.device, l.ts, l.num_value as v from ts_data l join devices d on d.id=l.device ' +
      'where ' + scopeSql(opts) + ' and l.key=' + (opts.key || LIFETIME_KEY) + ' and l.ts>=' + a + ' and l.ts<=' + b +
      ' order by l.device, l.ts');
    var by = {};
    rows.forEach(function(x){ (by[x.device] = by[x.device] || []).push({ ts: Number(x.ts), v: Number(x.v) }); });
    Object.keys(by).forEach(function(id){ by[id] = clean(by[id]); });
    return by;
  }

  var api = {
    LIFETIME_KEY: LIFETIME_KEY, MAX_GAP_H: MAX_GAP_H, EXACT_GAP_MIN: EXACT_GAP_MIN,
    localDay: localDay, dayStart: dayStart, addDays: addDays, monthStart: monthStart, addMonths: addMonths,
    clean: clean, valueAt: valueAt, used: used, usedSoFar: usedSoFar, daily: daily, coverage: coverage, latest: latest,
    offset: offset, register: register,
    fetchRange: fetchRange
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WMUsage = api;
})(this);
