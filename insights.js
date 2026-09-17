/* ============================================================
   OPERON water intelligence - leak, night-use and abnormal-consumption
   analysis. Pure functions: no page, no network. index.html fetches the
   readings and insights-ui.js draws the results.

   Why it is built this way
   - Leaks are judged on MINIMUM NIGHT FLOW, the water-industry standard:
     between 01:00 and 05:00 almost every building has at least one hour
     where nothing runs. If a meter never reaches zero, night after night,
     something is running continuously.
   - Irrigation, pump stations, tanks and chillers use water at night on
     purpose, so they are compared with their OWN usual nights instead.
   - Abnormal consumption uses robust statistics (median and MAD), so a
     single strange day cannot drag the "normal" level with it, and it
     learns each meter's weekday pattern so a busy race day is not an alarm.
   - Every verdict states its data coverage and confidence. With too few
     readings it says so rather than guessing.
   ============================================================ */
(function(root){
  'use strict';

  var HOUR = 3600000, DAY = 86400000, TZ = 4 * HOUR;            // Asia/Dubai, no DST

  var DEFAULTS = {
    NIGHT_FROM: 1, NIGHT_TO: 5,          // night window, local hours [from, to)
    NIGHTS: 14,                          // nights examined
    RECENT_NIGHTS: 7,                    // continuous flow judged on these
    CONT_MIN: 5,                         // ...on at least this many of them
    NEW_LEAK_NIGHTS: 3,                  // or on every one of the latest nights in a row (a new burst)
    MIN_NIGHTS: 5,                       // fewer usable nights = no verdict
    ZERO_M3H: 0.005,                     // an hour below 5 L counts as "stopped"
    MAX_GAP_H: 3,                        // readings further apart are not spread across hours
    Z: 3.5,                              // robust z-score for "abnormal"
    MIN_EXCESS_M3: 5,                    // ignore differences smaller than this
    BASELINE_DAYS: 56,
    NIGHT_USE_EXPECTED: /irrigation|pump|tank|chiller|cooling|pool|fountain|reservoir/i
  };

  /* ---------- small helpers ---------- */
  function localDay(ts){ return new Date(ts + TZ).toISOString().slice(0, 10); }
  function localHour(ts){ return new Date(ts + TZ).getUTCHours(); }
  function dayStart(key){ return Date.parse(key + 'T00:00:00Z') - TZ; }
  function addDays(key, n){ return new Date(Date.parse(key + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
  function median(a){
    var v = a.filter(isFinite).slice().sort(function(x, y){ return x - y; });
    if (!v.length) return null;
    var m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function mad(a, med){
    if (med == null) med = median(a);
    return median(a.map(function(x){ return Math.abs(x - med); }));
  }
  function round(x, d){ var p = Math.pow(10, d || 0); return Math.round(x * p) / p; }
  function sum(a){ return a.reduce(function(s, x){ return s + x; }, 0); }

  /* Robust spread with floors, so a very steady meter does not alarm on noise. */
  function spread(values, expected){
    return Math.max(1.4826 * (mad(values) || 0), 0.15 * Math.abs(expected || 0), 0.5);
  }

  /* ---------- 1. readings -> water used in each clock hour ----------
     readings: [{ts, v}] of ONE counter, any interval. Consumption between two
     readings is spread evenly over the real time between them, so hourly,
     15-minute and irregular meters are all handled the same way. A daily
     counter that resets counts the new value as usage since the reset; a
     lifetime counter that goes backwards (meter swapped) is left unknown.   */
  function hourlyUsage(readings, opt){
    var r = readings.filter(function(x){ return isFinite(x.ts) && isFinite(x.v); })
                    .sort(function(a, b){ return a.ts - b.ts; });
    var out = {}, gaps = [];                                   // hourStartTs -> m3
    for (var i = 1; i < r.length; i++){
      var a = r[i - 1], b = r[i], dt = b.ts - a.ts;
      if (dt <= 0) continue;
      gaps.push(dt);
      if (dt > opt.MAX_GAP_H * HOUR) continue;                  // too far apart to place in hours
      var used = b.v >= a.v ? b.v - a.v : (opt.resets ? b.v : NaN);
      if (!isFinite(used) || used / (dt / HOUR) > 1000) continue;   // swapped meter or glitch
      for (var h = Math.floor(a.ts / HOUR) * HOUR; h < b.ts; h += HOUR){
        var overlap = Math.min(b.ts, h + HOUR) - Math.max(a.ts, h);
        if (overlap <= 0) continue;
        out[h] = (out[h] || 0) + used * overlap / dt;
        out['c' + h] = (out['c' + h] || 0) + overlap;           // how much of the hour is covered
      }
    }
    return { usage: out, intervalMin: gaps.length ? round(median(gaps) / 60000, 0) : null };
  }
  function hourValue(h, hs){                                     // null unless the hour is >=90% covered
    return (h.usage['c' + hs] || 0) >= 0.9 * HOUR ? h.usage[hs] : null;
  }

  /* ---------- 2. night analysis ---------- */
  function analyseNights(h, meter, now, opt){
    var today = localDay(now), nights = [];
    for (var n = opt.NIGHTS; n >= 1; n--){
      var date = addDays(today, -n + (localHour(now) >= opt.NIGHT_TO ? 1 : 0));
      if (dayStart(date) + opt.NIGHT_TO * HOUR > now) continue;
      var hours = [], night = [];
      for (var hr = 0; hr < 24; hr++){
        var hs = dayStart(date) + hr * HOUR;
        var val = hs + HOUR <= now ? hourValue(h, hs) : null;
        hours.push(val == null ? null : round(val, 4));
        if (hr >= opt.NIGHT_FROM && hr < opt.NIGHT_TO) night.push(val);
      }
      var known = night.filter(function(x){ return x != null; });
      var usable = known.length >= (opt.NIGHT_TO - opt.NIGHT_FROM) - 1;
      nights.push({
        date: date, hours: hours, usable: usable,
        volume: usable ? round(sum(known) * (opt.NIGHT_TO - opt.NIGHT_FROM) / known.length, 3) : null,
        mnf: usable ? round(Math.min.apply(null, known), 4) : null,          // minimum night flow, m3/h
        zeroHours: usable ? known.filter(function(x){ return x < opt.ZERO_M3H; }).length : null
      });
    }
    nights.forEach(function(x){ x.continuous = x.usable ? x.zeroHours === 0 : null; });

    var usable = nights.filter(function(x){ return x.usable; });
    var recent = usable.slice(-opt.RECENT_NIGHTS);
    var expected = opt.NIGHT_USE_EXPECTED.test(meter.name || '');
    var res = {
      nights: nights, expectedNightUse: expected,
      usableNights: usable.length, recentNights: recent.length,
      continuousNights: recent.filter(function(x){ return x.continuous; }).length,
      status: 'clear', reasons: []
    };
    if (usable.length < opt.MIN_NIGHTS){
      res.status = 'insufficient';
      res.reasons.push('Only ' + usable.length + ' of the last ' + opt.NIGHTS + ' nights have enough readings between ' +
                       pad(opt.NIGHT_FROM) + ':00 and ' + pad(opt.NIGHT_TO) + ':00.');
      return res;
    }

    var mnfs = recent.map(function(x){ return x.mnf; });
    res.mnf = round(median(mnfs), 4);
    res.nightVolume = round(median(recent.map(function(x){ return x.volume; })), 3);

    /* trend of minimum night flow across all usable nights (least squares) */
    var xs = usable.map(function(_, i){ return i; }), ys = usable.map(function(x){ return x.mnf; });
    var mx = sum(xs) / xs.length, my = sum(ys) / ys.length;
    var sxx = sum(xs.map(function(x){ return (x - mx) * (x - mx); }));
    var slope = sxx ? sum(xs.map(function(x, i){ return (x - mx) * (ys[i] - my); })) / sxx : 0;
    var change = my > opt.ZERO_M3H ? slope * (xs.length - 1) / Math.max(my, 1e-6) : 0;
    res.trend = change > 0.5 ? 'rising' : change < -0.5 ? 'falling' : 'steady';
    res.trendPerNight = round(slope, 4);

    var streak = 0;
    for (var q = usable.length - 1; q >= 0 && usable[q].continuous; q--) streak++;
    res.streak = streak;
    if (!expected && (res.continuousNights >= opt.CONT_MIN || streak >= opt.NEW_LEAK_NIGHTS)){
      res.status = 'continuous';
      /* when did it start? walk back while nights stay continuous */
      var k = usable.length - 1;
      while (k > 0 && usable[k - 1].continuous) k--;
      res.onset = usable[k].date;
      res.onsetBeforeWindow = k === 0;
      /* the rate comes from the nights it actually ran, not diluted by earlier clean nights */
      var contMnfs = recent.filter(function(x){ return x.continuous; }).map(function(x){ return x.mnf; });
      res.mnf = res.leakRate = round(median(contMnfs), 4);        // m3/h that never stops
      res.lossPerDay = round(res.leakRate * 24, 2);               // upper bound: all of it is loss
      var spreadMnf = mad(contMnfs) * 1.4826;
      res.confidence = (recent.length >= opt.RECENT_NIGHTS && res.continuousNights >= 6 && streak >= 5 &&
                        (!res.mnf || spreadMnf / res.mnf < 0.6)) ? 'high' : 'medium';
      res.reasons.push('Water never stopped between ' + pad(opt.NIGHT_FROM) + ':00 and ' + pad(opt.NIGHT_TO) +
                       ':00 on ' + res.continuousNights + ' of the last ' + recent.length + ' nights' +
                       (res.continuousNights < opt.CONT_MIN ? ', including every one of the last ' + streak + '.' : '.'));
    } else if (!expected && res.continuousNights >= 2){
      res.status = 'intermittent';
      res.confidence = 'low';
      res.reasons.push('Water kept running through ' + res.continuousNights + ' of the last ' + recent.length +
                       ' nights, but stopped on the others.');
    }

    /* night use far above this meter's own usual nights (all meters, incl. irrigation) */
    var last3 = usable.slice(-3), before = usable.slice(0, -3);
    if (before.length >= 4){
      var now3 = median(last3.map(function(x){ return x.volume; }));
      var base = median(before.map(function(x){ return x.volume; }));
      var sd = spread(before.map(function(x){ return x.volume; }), base);
      res.nightBaseline = round(base, 3);
      res.nightRecent = round(now3, 3);
      if (now3 - base >= Math.max(1, 0.25 * opt.MIN_EXCESS_M3) && (now3 - base) / sd >= opt.Z &&
          now3 >= 1.6 * Math.max(base, 0.01)){
        res.elevated = true;
        res.elevatedExtraPerNight = round(now3 - base, 2);
      }
    }
    return res;
  }

  /* ---------- 3. daily consumption: spikes, drops, step changes ---------- */
  function analyseDaily(series, now, opt){
    var today = localDay(now);
    var byDay = {};
    series.forEach(function(s){ if (s.d < today && isFinite(s.v)) byDay[s.d] = s.v; });
    var days = Object.keys(byDay).sort();
    var res = { series: [], weekday: null, findings: [] };
    if (days.length < 14){ res.status = 'insufficient'; return res; }

    function baselineFor(d){
      var from = addDays(d, -opt.BASELINE_DAYS), vals = [], wd = {};
      days.forEach(function(k){
        if (k >= from && k < d){
          vals.push(byDay[k]);
          var w = new Date(k + 'T00:00:00Z').getUTCDay();
          (wd[w] = wd[w] || []).push(byDay[k]);
        }
      });
      if (vals.length < 14) return null;
      var med = median(vals), w = new Date(d + 'T00:00:00Z').getUTCDay(), factor = 1;
      if (med > 0 && wd[w] && wd[w].length >= 4){
        factor = Math.min(3, Math.max(0.3, median(wd[w]) / med));
        if (Math.abs(factor - 1) < 0.15) factor = 1;              // ignore weak weekday effects
      }
      var exp = med * factor;
      return { expected: exp, scale: spread(vals, med) * factor, factor: factor, n: vals.length };
    }

    var show = days.slice(-60);
    show.forEach(function(d){
      var b = baselineFor(d), v = byDay[d], row = { d: d, v: round(v, 2) };
      if (b){
        row.expected = round(b.expected, 2);
        row.lo = round(Math.max(0, b.expected - opt.Z * b.scale), 2);
        row.hi = round(b.expected + opt.Z * b.scale, 2);
        row.z = round((v - b.expected) / b.scale, 1);
        if (row.z >= opt.Z && v - b.expected >= opt.MIN_EXCESS_M3) row.flag = 'high';
        else if (row.z <= -opt.Z && b.expected - v >= opt.MIN_EXCESS_M3) row.flag = 'low';
        if (b.factor !== 1) row.weekdayFactor = round(b.factor, 2);
      }
      res.series.push(row);
    });

    var b0 = baselineFor(today);
    res.normalDay = b0 ? round(b0.expected, 2) : null;
    res.status = b0 ? 'ok' : 'insufficient';

    /* spikes and drops in the last 7 completed days */
    res.series.slice(-7).forEach(function(r){
      if (r.flag === 'high') res.findings.push({ kind: 'spike', date: r.d, value: r.v, expected: r.expected, z: r.z,
                                                excess: round(r.v - r.expected, 2) });
    });

    /* no water recorded for several days on a meter that normally uses some */
    var run = 0;
    for (var i = res.series.length - 1; i >= 0 && res.series[i].v <= 0.01; i--) run++;
    if (run >= 2 && b0 && b0.expected >= 1){
      res.findings.push({ kind: 'noflow', days: run, since: res.series[res.series.length - run].d, expected: round(b0.expected, 2) });
    } else {
      res.series.slice(-7).forEach(function(r){
        if (r.flag === 'low') res.findings.push({ kind: 'drop', date: r.d, value: r.v, expected: r.expected, z: r.z });
      });
    }

    /* step change: the level moved and stayed moved. The split day is the one
       that best divides the last 6 weeks into two flat levels (least squares). */
    var recentDays = res.series.slice(-42), best = null;
    function sse(a){ var m = sum(a) / a.length; return sum(a.map(function(x){ return (x - m) * (x - m); })); }
    for (var s = 7; s <= recentDays.length - 5; s++){
      var beforeV = recentDays.slice(0, s).map(function(x){ return x.v; });
      var afterV = recentDays.slice(s).map(function(x){ return x.v; });
      var mb = median(beforeV), ma = median(afterV);
      if (mb == null || ma == null) continue;
      var ratio = (ma + 0.5) / (mb + 0.5);
      var consistent = afterV.filter(function(x){ return ma > mb ? x > mb : x < mb; }).length / afterV.length;
      var score = -(sse(beforeV) + sse(afterV));
      if ((ratio >= 1.5 || ratio <= 0.6) && Math.abs(ma - mb) >= opt.MIN_EXCESS_M3 && consistent >= 0.8 &&
          (!best || score > best.score))
        best = { kind: 'step', since: recentDays[s].d, before: round(mb, 2), after: round(ma, 2),
                 ratio: round(ratio, 2), days: afterV.length, score: score };
    }
    if (best && !(run >= 2)){
      delete best.score;
      /* days that simply sit at the new level belong to the step, not separate alarms */
      res.findings = res.findings.filter(function(x){
        if (x.date < best.since) return true;
        if (x.kind === 'spike' && best.ratio > 1) return x.value > 1.3 * best.after + opt.MIN_EXCESS_M3;
        if (x.kind === 'drop' && best.ratio < 1) return x.value < 0.7 * best.after - opt.MIN_EXCESS_M3;
        return true;
      });
      res.findings.push(best);
    }
    return res;
  }

  /* ---------- 4. today so far vs a normal day at the same time ---------- */
  function analyseToday(h, meter, dailyRes, now, opt){
    var hourNow = localHour(now);
    if (hourNow < 6 || !isFinite(meter.daily)) return null;
    var today = localDay(now), cums = [], fulls = [];
    for (var n = 1; n <= 28; n++){
      var d = addDays(today, -n), cum = 0, full = 0, ok = true;
      for (var hr = 0; hr < 24; hr++){
        var v = hourValue(h, dayStart(d) + hr * HOUR);
        if (v == null){ ok = false; break; }                        // only whole days make a fair comparison
        if (hr < hourNow) cum += v;
        full += v;
      }
      if (ok){ cums.push(cum); fulls.push(full); }
    }
    if (cums.length < 10) return null;
    var exp = median(cums), sc = spread(cums, exp), z = (meter.daily - exp) / sc;
    var res = { hour: hourNow, soFar: round(meter.daily, 2), expectedSoFar: round(exp, 2), z: round(z, 1),
                normalDay: round(median(fulls), 2) };
    if (exp >= 1) res.projected = round(meter.daily * median(fulls) / exp, 1);
    res.flag = z >= opt.Z && meter.daily - exp >= opt.MIN_EXCESS_M3;
    return res;
  }

  /* ---------- 5. turn numbers into findings people can act on ---------- */
  var BANDS = [
    { max: 0.03, sev: 'low',    causes: 'a dripping tap, a slowly leaking cistern or a small valve seep' },
    { max: 0.3,  sev: 'medium', causes: 'a running toilet or cistern, a float valve that does not shut, or an automatic waterer or fixture left on' },
    { max: 2,    sev: 'high',   causes: 'an open valve or hose, an irrigation zone stuck on, or a tank float valve that has failed' },
    { max: 1e9,  sev: 'high',   causes: 'a burst or broken pipe. Treat as urgent' }
  ];
  function band(rate){ for (var i = 0; i < BANDS.length; i++) if (rate < BANDS[i].max) return BANDS[i]; return BANDS[3]; }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function listText(a){ return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function fmtDate(key){ return new Date(key + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }

  function buildFindings(r, opt){
    var f = [], n = r.night, dly = r.daily;
    if (n.status === 'continuous'){
      var b = band(n.leakRate);
      var sev = b.sev === 'low' && n.lossPerDay * 30 > 100 ? 'medium' : b.sev;
      f.push({
        type: 'leak', severity: sev, confidence: n.confidence,
        title: 'Continuous flow: possible leak',
        summary: 'Never below ' + round(n.leakRate * 1000 / 60, 1) + ' L/min at night, ' +
                 (n.continuousNights < opt.CONT_MIN ? 'every night since ' + fmtDate(n.onset) : n.continuousNights + ' of ' + n.recentNights + ' nights'),
        detail: 'Between ' + pad(opt.NIGHT_FROM) + ':00 and ' + pad(opt.NIGHT_TO) + ':00 the flow never dropped below ' +
                round(n.leakRate, 3) + ' m³/h (' + round(n.leakRate * 1000 / 60, 1) + ' L/min) on ' + n.continuousNights +
                ' of the last ' + n.recentNights + ' nights' +
                (n.onsetBeforeWindow ? ', and it was already happening ' + opt.NIGHTS + ' nights ago.' : ', starting around ' + fmtDate(n.onset) + '.') +
                ' At that rate up to ' + n.lossPerDay + ' m³ a day could be lost.',
        causes: 'At this rate it is most often ' + b.causes + '.',
        checks: checksFor('leak', r, opt),
        m3PerMonth: round(n.lossPerDay * 30, 1)
      });
    }
    if (n.elevated && n.status !== 'continuous'){
      f.push({
        type: 'night', severity: n.expectedNightUse ? 'medium' : 'low', confidence: 'medium',
        title: 'Night use higher than usual',
        summary: round(n.nightRecent, 1) + ' m³ per night lately, normally ' + round(n.nightBaseline, 1) + ' m³',
        detail: 'Over the last 3 nights this meter used a median of ' + round(n.nightRecent, 2) + ' m³ between ' +
                pad(opt.NIGHT_FROM) + ':00 and ' + pad(opt.NIGHT_TO) + ':00, against ' + round(n.nightBaseline, 2) +
                ' m³ on its earlier nights.' + (n.expectedNightUse ? ' Night use is normal for this meter, but not this much.' : ''),
        causes: n.expectedNightUse
          ? 'Usually a longer irrigation or filling schedule, a zone or float valve that stayed open, or a leak downstream.'
          : 'Usually a new night-time activity, equipment left running, or the early stage of a leak.',
        checks: checksFor('night', r, opt),
        m3PerMonth: round(n.elevatedExtraPerNight * 30, 1)
      });
    }
    /* One cause, one finding. Water lost to a leak or to longer night use also
       lifts the daily totals, so days it fully explains are folded into it. */
    var cause = f[0] || null, explained = [];
    var perDay = (n.status === 'continuous' ? n.lossPerDay : 0) + (n.elevated ? n.elevatedExtraPerNight : 0);
    function explains(excess, date, perDayShare){
      if (!cause || !perDay) return false;
      if (n.status === 'continuous' && !n.onsetBeforeWindow && date && date < addDays(n.onset, -3)) return false;
      return excess <= 1.3 * (perDayShare == null ? perDay : perDayShare) + opt.MIN_EXCESS_M3;
    }

    var stepUp = dly.findings.filter(function(x){ return x.kind === 'step' && x.ratio > 1; })[0];
    if (r.today && r.today.flag && stepUp && r.today.projected != null &&
        r.today.projected <= 1.3 * stepUp.after + opt.MIN_EXCESS_M3){
      stepUp.coversToday = true;
    } else if (r.today && r.today.flag && explains(r.today.soFar - r.today.expectedSoFar, null,
        (n.status === 'continuous' ? n.lossPerDay * r.today.hour / 24 : 0) + (n.elevated ? n.elevatedExtraPerNight : 0))){
      explained.push('today');
    } else if (r.today && r.today.flag){
      var t = r.today;
      f.push({
        type: 'spike', severity: t.z >= 2 * opt.Z ? 'high' : 'medium', confidence: 'medium',
        title: 'Unusually high use today',
        summary: t.soFar + ' m³ by ' + pad(t.hour) + ':00, normally ' + t.expectedSoFar + ' m³',
        detail: 'By ' + pad(t.hour) + ':00 this meter has used ' + t.soFar + ' m³. On a normal day it is at ' + t.expectedSoFar +
                ' m³ by this time.' + (t.projected ? ' If it continues, today will end near ' + t.projected + ' m³ against a normal ' + t.normalDay + ' m³.' : ''),
        causes: 'A burst or open valve, an extra event or cleaning, a filling operation, or a schedule change.',
        checks: checksFor('spike', r, opt),
        m3PerMonth: null, m3Today: round(Math.max(0, t.soFar - t.expectedSoFar), 1)
      });
    }
    dly.findings.forEach(function(x){
      if ((x.kind === 'spike' && explains(x.excess, x.date)) ||
          (x.kind === 'step' && x.ratio > 1 && explains(x.after - x.before, x.since))){
        explained.push(x.kind === 'step' ? 'step' : x.date);
        return;
      }
      if (x.kind === 'spike') f.push({
        type: 'spike', severity: x.z >= 2 * opt.Z ? 'high' : 'medium', confidence: 'high',
        title: 'Abnormal day on ' + fmtDate(x.date),
        summary: x.value + ' m³ against a normal ' + x.expected + ' m³ (' + round(x.value / Math.max(x.expected, 0.01), 1) + '×)',
        detail: 'On ' + fmtDate(x.date) + ' the meter used ' + x.value + ' m³. Its normal for that day of the week is ' + x.expected +
                ' m³, so ' + x.excess + ' m³ more than expected.',
        causes: 'A one-off event, cleaning or filling, a valve left open for part of the day, or a burst that has since been fixed.',
        checks: checksFor('spike', r, opt), m3PerMonth: null, m3Once: x.excess
      });
      if (x.kind === 'drop') f.push({
        type: 'drop', severity: 'low', confidence: 'medium',
        title: 'Much lower use on ' + fmtDate(x.date),
        summary: x.value + ' m³ against a normal ' + x.expected + ' m³',
        detail: 'On ' + fmtDate(x.date) + ' the meter recorded ' + x.value + ' m³, well below its normal ' + x.expected + ' m³.',
        causes: 'A closed site or supply valve, a supply interruption, or a meter that under-reads.',
        checks: checksFor('drop', r, opt), m3PerMonth: null
      });
      if (x.kind === 'noflow') f.push({
        type: 'noflow', severity: 'medium', confidence: 'high',
        title: 'No water recorded for ' + x.days + ' days',
        summary: 'Since ' + fmtDate(x.since) + ', normally ' + x.expected + ' m³ a day',
        detail: 'The meter has recorded no consumption since ' + fmtDate(x.since) + ', though it normally uses about ' + x.expected + ' m³ a day.',
        causes: 'A closed supply valve, a stuck or faulty meter, or a communication fault reporting zero.',
        checks: checksFor('noflow', r, opt), m3PerMonth: null
      });
      if (x.kind === 'step') f.push({
        type: 'step', severity: x.ratio >= 2 ? 'medium' : 'low', confidence: x.days >= 10 ? 'high' : 'medium',
        title: (x.ratio > 1 ? 'Usage stepped up' : 'Usage stepped down') + ' since ' + fmtDate(x.since),
        summary: x.before + ' → ' + x.after + ' m³ a day (' + (x.ratio > 1 ? '+' : '') + Math.round((x.ratio - 1) * 100) + '%)',
        detail: 'For the ' + x.days + ' days since ' + fmtDate(x.since) + ' typical use has been ' + x.after + ' m³ a day, against ' +
                x.before + ' m³ a day before. The change has held, so it is not a one-off.' +
                (x.coversToday ? ' Today’s higher use is in line with this new level.' : ''),
        causes: x.ratio > 1
          ? 'New occupants or activity, a changed irrigation schedule, or a leak that started around that date.'
          : 'Reduced occupancy or activity, a closed zone, or a meter beginning to under-read.',
        checks: checksFor(x.ratio > 1 ? 'stepup' : 'drop', r, opt),
        m3PerMonth: x.ratio > 1 ? round((x.after - x.before) * 30, 1) : null,
        m3PerMonth: x.ratio > 1 ? round((x.after - x.before) * 30, 1) : null
      });
    });
    if (explained.length){
      var days = explained.filter(function(x){ return x !== 'today' && x !== 'step'; }).map(fmtDate);
      var parts = [];
      if (days.length) parts.push('the high daily totals on ' + listText(days));
      if (explained.indexOf('today') >= 0) parts.push('today’s high use so far');
      var st = dly.findings.filter(function(x){ return x.kind === 'step'; })[0];
      if (explained.indexOf('step') >= 0 && st) parts.push('the rise in daily use since ' + fmtDate(st.since));
      cause.detail += ' It also accounts for ' + listText(parts) + '.';
      cause.explains = explained;
    }
    if (n.status === 'insufficient' && r.coverage < 0.5) f.push({
      type: 'data', severity: 'info', confidence: 'high',
      title: 'Not enough readings to judge',
      summary: Math.round(r.coverage * 100) + '% of hours covered in the last 28 days',
      detail: n.reasons.join(' ') + ' Leak and night checks need readings at least every ' + opt.MAX_GAP_H + ' hours.',
      causes: 'The meter or its gateway is reporting infrequently or has been offline.',
      checks: ['Check the meter’s signal and battery, and the gateway it reports through.'], m3PerMonth: null
    });
    /* how much water is involved matters as much as how unusual it is */
    f.forEach(function(x){ if (x.severity === 'low' && (x.m3PerMonth || 0) >= 200) x.severity = 'medium'; });
    return f;
  }

  function checksFor(type, r, opt){
    var night = r.night;
    switch (type){
      case 'leak': return [
        'Visit when the site is quiet (ideally 01:00–05:00) and read the meter twice, 15 minutes apart. If it moves with every tap closed, the leak is after the meter.',
        'Listen and look for running toilets and cisterns, dripping taps, and wet ground or unusually green patches along the pipe route.',
        'Check tank and trough float valves, automatic waterers, and any irrigation valves fed by this meter.',
        'Close sections one at a time and watch the meter to narrow down where the flow goes.' ];
      case 'night': return night.expectedNightUse ? [
        'Compare against the irrigation or filling schedule for these nights. Was run time extended?',
        'Check whether a zone or float valve failed to close at the end of its cycle.',
        'If the schedule has not changed, inspect the lines for a leak.' ] : [
        'Find out whether a new night-time activity started, for example cleaning, cooling or equipment.',
        'Walk the site at night and look for equipment or fixtures left running.' ];
      case 'spike': return [
        'Ask the site team whether there was an event, a cleaning or filling operation, or maintenance.',
        'Check for open hoses and valves, and for signs of a burst (water on the ground, pressure drop).',
        'If nobody expected it, read the meter again in an hour. Still climbing fast points to a fault.' ];
      case 'drop': return [
        'Confirm the site was operating normally and the supply valve is open.',
        'Compare with a manual meter reading to rule out an under-reading meter.' ];
      case 'noflow': return [
        'Check the supply valve upstream of the meter is open.',
        'Take a manual reading and compare it with the dashboard. If water is being used but not counted, the meter or its sensor needs service.' ];
      case 'stepup': return [
        'Find out what changed around that date: occupancy, events, irrigation schedule, new equipment.',
        'If nothing changed, look at the night check. A rise in night flow at the same date points to a leak.' ];
    }
    return [];
  }

  var SEV = { high: 0, medium: 1, low: 2, info: 3 };

  /* ---------- public entry point ----------
     input = {
       now, meters: [{id, name, type, active, daily}],
       hourly: [{device, key, ts, v}]  - last reading per hour of counter keys
       daily:  [{device, d, v}]         - daily totals (Dubai days)
       keys:   {lifetime: 949, daily: 1041}
     }                                                                       */
  function analyse(input, cfg){
    var opt = {}, k;
    for (k in DEFAULTS) opt[k] = DEFAULTS[k];
    for (k in (cfg || {})) if (cfg[k] != null) opt[k] = cfg[k];
    var now = input.now || Date.now(), keys = input.keys || { lifetime: 949, daily: 1041 };

    var hourlyBy = {}, dailyBy = {};
    (input.hourly || []).forEach(function(r){
      var id = r.device + '|' + r.key;
      (hourlyBy[id] = hourlyBy[id] || []).push({ ts: Number(r.ts), v: Number(r.v) });
    });
    (input.daily || []).forEach(function(r){ (dailyBy[r.device] = dailyBy[r.device] || []).push({ d: String(r.d).slice(0, 10), v: Number(r.v) }); });

    var results = {}, all = [];
    (input.meters || []).forEach(function(m){
      var life = hourlyBy[m.id + '|' + keys.lifetime] || [], dly = hourlyBy[m.id + '|' + keys.daily] || [];
      /* the lifetime counter never resets, so prefer it whenever it reports about as often */
      var useLife = life.length >= 0.8 * dly.length && life.length > 1;
      var h = hourlyUsage(useLife ? life : dly, { MAX_GAP_H: opt.MAX_GAP_H, resets: !useLife });
      var covered = 0;
      for (var t = Math.floor((now - 28 * DAY) / HOUR) * HOUR; t < Math.floor(now / HOUR) * HOUR; t += HOUR)
        if (hourValue(h, t) != null) covered++;

      var r = {
        id: m.id, name: m.name, type: m.type,
        counter: useLife ? 'lifetime total' : 'daily total', intervalMin: h.intervalMin,
        coverage: round(covered / (28 * 24), 3)
      };
      r.night = analyseNights(h, m, now, opt);
      r.daily = analyseDaily(dailyBy[m.id] || [], now, opt);
      r.today = analyseToday(h, m, r.daily, now, opt);
      r.findings = buildFindings(r, opt).sort(function(a, b){ return SEV[a.severity] - SEV[b.severity]; });
      r.worst = r.findings.length ? r.findings[0].severity : null;
      r.isLeak = r.night.status === 'continuous';
      r.isAbnormal = r.findings.some(function(f){ return f.type === 'spike' || f.type === 'step' || f.type === 'noflow'; });
      results[m.id] = r;
      r.findings.forEach(function(f){ all.push({ meter: m.id, name: m.name, f: f }); });
    });

    all.sort(function(a, b){
      return SEV[a.f.severity] - SEV[b.f.severity] ||
             ((b.f.m3PerMonth || b.f.m3Today || b.f.m3Once || 0) - (a.f.m3PerMonth || a.f.m3Today || a.f.m3Once || 0));
    });
    var ids = Object.keys(results);
    return {
      generatedAt: now, options: { NIGHT_FROM: opt.NIGHT_FROM, NIGHT_TO: opt.NIGHT_TO, NIGHTS: opt.NIGHTS },
      meters: results, findings: all,
      summary: {
        analysed: ids.length,
        leaks: ids.filter(function(i){ return results[i].isLeak; }).length,
        abnormal: ids.filter(function(i){ return results[i].isAbnormal; }).length,
        nightHigh: ids.filter(function(i){ return results[i].findings.some(function(f){ return f.type === 'night'; }); }).length,
        noData: ids.filter(function(i){ return results[i].night.status === 'insufficient'; }).length,
        lossM3PerMonth: Math.round(sum(ids.map(function(i){ var n = results[i].night; return n.status === 'continuous' ? n.lossPerDay * 30 : 0; })))
      }
    };
  }

  var api = { analyse: analyse, hourlyUsage: hourlyUsage, localDay: localDay, DEFAULTS: DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WMInsights = api;
})(this);
