/* ============================================================
   OPERON Smart Insights - screens for insights.js
   Loads the readings, runs the analysis every 30 minutes and draws:
   - a network overview ranked by what needs attention first,
   - a technical page per meter (night flow, hour-by-hour heat map,
     daily use against its normal range, likely causes, what to check),
   - the short summary inside the meter panel on the map.
   Uses the dashboard's sql(), meters, CONFIG, haveAuth() and focusMeter().
   ============================================================ */
(function(){
  'use strict';

  var REFRESH_MS = 30 * 60000;
  var state = { data: null, err: null, loading: null, at: 0, view: 'overview', filter: 'all', meter: null };

  var ICON = { leak: '💧', night: '🌙', spike: '⚡', step: '📈', noflow: '⛔', drop: '📉', data: '📡' };
  var SEVTXT = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
  var FILTERS = [
    ['all', 'All'], ['leak', 'Leaks'], ['night', 'Night use'], ['abnormal', 'Abnormal use'], ['data', 'Data gaps']
  ];
  function inFilter(f, key){
    if (key === 'all') return true;
    if (key === 'abnormal') return f.type === 'spike' || f.type === 'step' || f.type === 'noflow' || f.type === 'drop';
    return f.type === key;
  }

  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(x, d){ return x == null || !isFinite(x) ? '—' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d == null ? 1 : d }); }
  function money(v){ return v == null ? '—' : CONFIG.CURRENCY + ' ' + Math.round(v).toLocaleString('en-US'); }
  function lpm(m3h){ return m3h == null ? '—' : num(m3h * 1000 / 60, 1) + ' L/min'; }
  function dshort(key){ return new Date(key + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  function cssv(n, fb){ return getComputedStyle(document.body).getPropertyValue(n).trim() || fb; }

  /* ---------- data ---------- */
  async function load(force){
    if (typeof haveAuth !== 'function' || !haveAuth() || !window.WMInsights) return null;
    if (state.loading) return state.loading;
    if (!force && state.data && Date.now() - state.at < REFRESH_MS) return state.data;
    state.loading = (async function(){
      var ORG = CONFIG.ORG, now = Date.now();
      var TYPES = "d.type in ('Water Meter','Flow Meter')";
      var DT = "to_timestamp(l.ts/1000) at time zone 'Asia/Dubai'";
      try{
        state.err = null;
        var res = await Promise.all([
          /* last reading of each counter in every hour, 4 weeks: enough for 14 nights and an hourly profile */
          sql('select l.device, l.key, max(l.ts) as ts, max(l.num_value) as v ' +
              'from ts_data l join devices d on d.id=l.device ' +
              "where d.org='" + ORG + "' and " + TYPES + ' and l.key in (' + K.TOTAL + ',' + K.DAILY + ') and l.ts>=' + (now - 28 * 86400000) + ' ' +
              'group by l.device, l.key, floor(l.ts/3600000.0)'),
          /* daily totals, 90 days: the "normal" for each meter */
          sql('select l.device, date_trunc(\'day\',' + DT + ')::date::text as d, max(l.num_value) as v ' +
              'from ts_data l join devices d on d.id=l.device ' +
              "where d.org='" + ORG + "' and " + TYPES + ' and l.key=' + K.DAILY + ' and l.ts>=' + (now - 90 * 86400000) + ' ' +
              'group by l.device, d')
        ]);
        state.data = WMInsights.analyse(
          { now: now, meters: meters, hourly: res[0], daily: res[1], keys: { lifetime: K.TOTAL, daily: K.DAILY } },
          { TARIFF: CONFIG.TARIFF, CURRENCY: CONFIG.CURRENCY, MIN_EXCESS_M3: CONFIG.SPIKE_MIN });
        state.at = now;
        window.INSIGHTS = state.data;
      }catch(e){
        state.err = e.message || String(e);
        console.warn('insights failed:', state.err);
      }finally{ state.loading = null; }
      if (typeof renderUI === 'function' && meters.length) renderUI(meters);
      if (window.renderTiles) renderTiles();
      if (modal && modal.classList.contains('open')) render();
      var open = document.getElementById('detail');
      if (open && open.classList.contains('open') && window.__detailMeter) renderDetail(window.__detailMeter);
      return state.data;
    })();
    return state.loading;
  }

  function resultFor(id){ return state.data && state.data.meters[id]; }

  /* ---------- styles ---------- */
  var css = document.createElement('style');
  css.textContent = [
    '#inModal{position:fixed;inset:0;background:rgba(8,14,24,.62);display:none;align-items:center;justify-content:center;z-index:55}',
    '#inModal.open{display:flex}',
    '#inCard{background:var(--glass);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border:1px solid var(--glassbrd);border-radius:18px;',
    '  width:min(1080px,95vw);height:min(820px,92vh);display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.5)}',
    '#inHead{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line)}',
    '#inHead .t{font-size:15px;font-weight:700} #inHead .s{font-size:11px;color:var(--muted)}',
    '#inHead .sp{margin-left:auto;display:flex;gap:6px;align-items:center}',
    '.inBtn{font-size:11.5px;padding:6px 11px;border-radius:7px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}',
    '.inBtn:hover{border-color:var(--accent)} .inBtn:disabled{opacity:.5;cursor:default}',
    '#inClose{background:none;border:none;color:var(--muted);font-size:17px;cursor:pointer;padding:0 4px} #inClose:hover{color:var(--text)}',
    '#inBody{overflow-y:auto;padding:14px 18px 22px;flex:1}',
    '.inTiles{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-bottom:12px}',
    '.inTile{background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:9px 11px}',
    '.inTile .v{font-size:19px;font-weight:700} .inTile .l{font-size:9.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-top:2px}',
    '.inChips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}',
    '.inChip{font-size:11px;padding:5px 11px;border-radius:14px;border:1px solid var(--line);background:var(--panel2);color:var(--muted);cursor:pointer}',
    '.inChip.sel{border-color:var(--accent);color:var(--text)}',
    '.inRow{display:grid;grid-template-columns:26px 1fr auto 18px;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--line);',
    '  border-left:3px solid var(--muted);border-radius:10px;margin-bottom:7px;cursor:pointer;background:var(--glass2)}',
    '.inRow:hover{border-color:var(--accent)}',
    '.inRow.high{border-left-color:var(--bad)} .inRow.medium{border-left-color:var(--warn)} .inRow.low{border-left-color:var(--blue)}',
    '.inRow .ic{font-size:17px;text-align:center} .inRow .m{font-size:11px;color:var(--muted)} .inRow .h{font-size:13px;font-weight:600;margin:1px 0}',
    '.inRow .su{font-size:11.5px;color:var(--muted)} .inRow .c{text-align:right;font-size:12px;font-weight:700;white-space:nowrap}',
    '.inRow .c small{display:block;font-weight:400;color:var(--muted);font-size:10px} .inRow .go{color:var(--muted)}',
    '.inSev{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;padding:2px 7px;border-radius:9px;margin-left:6px;vertical-align:1px}',
    '.inSev.high{background:rgba(244,63,94,.15);color:var(--bad)} .inSev.medium{background:rgba(245,158,11,.15);color:var(--warn)}',
    '.inSev.low,.inSev.info{background:rgba(59,130,246,.15);color:var(--blue)} .inSev.conf{background:var(--panel2);color:var(--muted)}',
    '.inEmpty{padding:26px;text-align:center;color:var(--muted);font-size:12.5px}',
    '.inSec{margin-top:18px} .inSec h3{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px;font-weight:700}',
    '.inCardF{border:1px solid var(--line);border-left:3px solid var(--muted);border-radius:10px;padding:12px 14px;margin-bottom:9px;background:var(--glass2)}',
    '.inCardF.high{border-left-color:var(--bad)} .inCardF.medium{border-left-color:var(--warn)} .inCardF.low,.inCardF.info{border-left-color:var(--blue)}',
    '.inCardF.ok{border-left-color:var(--ok)}',
    '.inCardF .h{font-size:14px;font-weight:700} .inCardF p{font-size:12.5px;line-height:1.6;margin-top:6px}',
    '.inCardF .k{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-top:10px;font-weight:700}',
    '.inCardF ul{margin:5px 0 0 18px;font-size:12.5px;line-height:1.6}',
    '.inCardF .cost{margin-top:8px;font-size:12px;color:var(--warn);font-weight:600}',
    '.inGrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
    '.inTbl{width:100%;border-collapse:collapse;font-size:12px}',
    '.inTbl td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top} .inTbl td:first-child{color:var(--muted);width:48%}',
    '.inTbl td b{font-weight:600}',
    '.inChart{background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}',
    '.inChart .ct{font-size:11.5px;font-weight:600;margin-bottom:2px} .inChart .cs{font-size:10.5px;color:var(--muted);margin-bottom:6px}',
    '.inChart svg{display:block;width:100%;height:auto}',
    '.inLeg{display:flex;gap:12px;flex-wrap:wrap;font-size:10.5px;color:var(--muted);margin-top:6px;align-items:center}',
    '.inLeg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}',
    '.inBack{font-size:12px;color:var(--accent);cursor:pointer;margin-bottom:10px;display:inline-block}',
    '.inMeta{font-size:11px;color:var(--muted);margin-top:3px}',
    '.inNote{font-size:11.5px;color:var(--muted);line-height:1.6;margin-top:16px;border-top:1px solid var(--line);padding-top:12px}',
    '.inNote summary{cursor:pointer;color:var(--accent);font-size:12px}',
    '.inOk{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px;margin-top:6px}',
    '.inOk div{font-size:11.5px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;cursor:pointer;background:var(--glass2)}',
    '.inOk div:hover{border-color:var(--accent)} .inOk span{color:var(--muted);display:block;font-size:10.5px}',
    /* the compact block inside the meter panel */
    '#dInsight{margin-bottom:10px}',
    '#dInsight .di{display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border:1px solid var(--line);border-left:3px solid var(--muted);border-radius:7px;margin-bottom:5px;font-size:12px;line-height:1.45}',
    '#dInsight .di.high{border-left-color:var(--bad)} #dInsight .di.medium{border-left-color:var(--warn)} #dInsight .di.low,#dInsight .di.info{border-left-color:var(--blue)}',
    '#dInsight .di.ok{border-left-color:var(--ok)} #dInsight .di b{display:block} #dInsight .di span{color:var(--muted);font-size:11.5px}',
    '#dInsight .dmore{font-size:11.5px;color:var(--accent);cursor:pointer;display:inline-block;margin-top:1px}',
    '#dInsight .dmore:hover{text-decoration:underline}',
    '@media(max-width:760px){ .inTiles{grid-template-columns:repeat(2,1fr)} .inGrid{grid-template-columns:1fr} }',
    /* print only the report, on white paper */
    '@media print{ body{overflow:visible!important;height:auto!important;background:#fff!important}',
    '  body > *:not(#inModal){display:none!important}',
    '  #inModal{position:static!important;display:block!important;background:#fff!important}',
    '  #inCard{width:auto!important;height:auto!important;border:none!important;box-shadow:none!important;background:#fff!important;backdrop-filter:none!important;color:#1d2b3a}',
    '  #inHead .sp,.inChips,.inBack,.inRow .go{display:none!important} #inBody{overflow:visible!important}',
    '  .inRow,.inCardF,.inChart,.inTile{break-inside:avoid;background:#fff!important} .inNote details{display:block} }'
  ].join('\n');
  document.head.appendChild(css);

  /* ---------- modal shell ---------- */
  var modal = document.createElement('div');
  modal.id = 'inModal';
  modal.innerHTML = '<div id="inCard"><div id="inHead"><div><div class="t" id="inTitle">Smart Insights</div><div class="s" id="inSub"></div></div>' +
    '<div class="sp"><button class="inBtn" id="inRefresh">↻ Refresh</button><button class="inBtn" id="inPrint">🖨 Print / PDF</button>' +
    '<button id="inClose" title="Close">✕</button></div></div><div id="inBody"></div></div>';
  document.body.appendChild(modal);
  var body = modal.querySelector('#inBody');
  modal.querySelector('#inClose').onclick = close;
  modal.addEventListener('click', function(e){ if (e.target === modal) close(); });
  addEventListener('keydown', function(e){ if (e.key === 'Escape' && modal.classList.contains('open')) close(); });
  modal.querySelector('#inPrint').onclick = function(){ window.print(); };
  modal.querySelector('#inRefresh').onclick = function(){
    var b = this; b.disabled = true; b.textContent = 'Analysing…';
    load(true).finally(function(){ b.disabled = false; b.textContent = '↻ Refresh'; render(); });
  };
  function close(){ modal.classList.remove('open'); }

  function open(opts){
    opts = opts || {};
    state.view = opts.meter ? 'meter' : 'overview';
    state.meter = opts.meter || null;
    if (opts.filter) state.filter = opts.filter;
    modal.classList.add('open');
    render();
    if (!state.data && haveAuth()) load().then(render);
  }

  function render(){
    var sub = modal.querySelector('#inSub');
    if (!haveAuth()){
      modal.querySelector('#inTitle').textContent = 'Smart Insights';
      sub.textContent = '';
      body.innerHTML = '<div class="inEmpty">Connect to the 3PhTech platform (🔑 Key) to analyse leaks and consumption.</div>';
      return;
    }
    if (!state.data){
      body.innerHTML = state.err
        ? '<div class="inEmpty">The analysis could not load: ' + esc(state.err) + '<br><br>Try ↻ Refresh.</div>'
        : '<div class="inEmpty"><div class="spin" style="margin:0 auto 12px"></div>Analysing 4 weeks of hourly readings and 90 days of daily use…</div>';
      return;
    }
    sub.textContent = 'Leaks, night use and abnormal consumption · analysed ' +
      new Date(state.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · updates every 30 min';
    if (state.view === 'meter' && resultFor(state.meter)) renderMeter(resultFor(state.meter));
    else renderOverview();
  }

  /* ---------- overview ---------- */
  function renderOverview(){
    var d = state.data, s = d.summary;
    modal.querySelector('#inTitle').textContent = 'Smart Insights';
    var list = d.findings.filter(function(x){ return inFilter(x.f, state.filter); });
    var flagged = {};
    d.findings.forEach(function(x){ if (x.f.severity !== 'info') flagged[x.meter] = true; });
    var clear = Object.keys(d.meters).map(function(id){ return d.meters[id]; })
      .filter(function(r){ return !flagged[r.id]; })
      .sort(function(a, b){ return a.name.localeCompare(b.name); });

    var h = '<div class="inTiles">' +
      tile(s.leaks, 'Possible leaks', s.leaks ? 'var(--bad)' : 'var(--ok)') +
      tile(money(s.lossPerMonth), 'Leak cost / month if unfixed', s.lossPerMonth ? 'var(--warn)' : null) +
      tile(s.abnormal, 'Abnormal consumption', s.abnormal ? 'var(--warn)' : 'var(--ok)') +
      tile(s.nightHigh, 'Night use above normal', s.nightHigh ? 'var(--warn)' : 'var(--ok)') +
      tile(s.noData, 'Not enough data', s.noData ? 'var(--muted)' : 'var(--ok)') + '</div>';

    h += '<div class="inChips">' + FILTERS.map(function(f){
      var n = f[0] === 'all' ? d.findings.length : d.findings.filter(function(x){ return inFilter(x.f, f[0]); }).length;
      return '<span class="inChip' + (state.filter === f[0] ? ' sel' : '') + '" data-f="' + f[0] + '">' + f[1] + ' ' + n + '</span>';
    }).join('') + '</div>';

    h += list.length ? list.map(function(x){
      var f = x.f, cost = f.costPerMonth ? money(f.costPerMonth) + '<small>per month if it continues</small>'
        : f.costToday ? money(f.costToday) + '<small>extra so far today</small>'
        : f.costOnce ? money(f.costOnce) + '<small>extra that day</small>' : '';
      return '<div class="inRow ' + f.severity + '" data-m="' + esc(x.meter) + '"><div class="ic">' + (ICON[f.type] || '•') + '</div>' +
        '<div><div class="m">' + esc(x.name) + '</div><div class="h">' + esc(f.title) +
        '<span class="inSev ' + f.severity + '">' + SEVTXT[f.severity] + '</span>' +
        (f.confidence ? '<span class="inSev conf">' + f.confidence + ' confidence</span>' : '') + '</div>' +
        '<div class="su">' + esc(f.summary) + '</div></div><div class="c">' + cost + '</div><div class="go">›</div></div>';
    }).join('') : '<div class="inEmpty">Nothing to report in this category.</div>';

    if (clear.length) h += '<div class="inSec"><h3>' + clear.length + ' meters with nothing unusual</h3><div class="inOk">' +
      clear.map(function(r){
        var n = r.night, why = n.status === 'insufficient' ? 'not enough night readings'
          : n.expectedNightUse ? 'night use normal for this meter'
          : 'stops at night on ' + (n.recentNights - n.continuousNights) + ' of ' + n.recentNights + ' nights';
        return '<div data-m="' + esc(r.id) + '">' + esc(r.name) + '<span>✓ ' + why + '</span></div>';
      }).join('') + '</div></div>';

    h += methodNote();
    body.innerHTML = h;
    body.querySelectorAll('.inChip').forEach(function(c){ c.onclick = function(){ state.filter = c.dataset.f; renderOverview(); }; });
    body.querySelectorAll('[data-m]').forEach(function(r){ r.onclick = function(){ state.view = 'meter'; state.meter = r.dataset.m; render(); body.scrollTop = 0; }; });
  }
  function tile(v, label, color){
    return '<div class="inTile"><div class="v"' + (color ? ' style="color:' + color + '"' : '') + '>' + v + '</div><div class="l">' + label + '</div></div>';
  }

  function methodNote(){
    var o = state.data.options;
    return '<details class="inNote"><summary>How this analysis works</summary><p style="margin-top:8px">' +
      '<b>Leaks: minimum night flow.</b> Between ' + pad(o.NIGHT_FROM) + ':00 and ' + pad(o.NIGHT_TO) + ':00 almost every site has at least one hour ' +
      'where no water is used. The analysis turns each meter’s counter readings into water used per hour and checks the last ' + o.NIGHTS +
      ' nights. If flow never drops to zero on at least 5 of the last 7 nights, something is running continuously. The lowest night flow is ' +
      'the likely leak rate, and the loss estimate assumes all of it is waste, so treat it as an upper limit.</p><p style="margin-top:6px">' +
      '<b>Night use that is normal.</b> Meters named for irrigation, pumps, tanks, chillers, cooling, pools or fountains use water at night on ' +
      'purpose. They are never called leaks. Instead each is compared with its own usual nights.</p><p style="margin-top:6px">' +
      '<b>Abnormal consumption: robust statistics.</b> Each meter’s normal day is learned from its last 8 weeks using the median and the median ' +
      'absolute deviation, so one strange day cannot shift the baseline. Regular weekday patterns, such as busy race days, are learned and not ' +
      'flagged. A day counts as abnormal when it is far outside that range (robust z-score above 3.5) and at least ' + CONFIG.SPIKE_MIN +
      ' m³ above normal. Sustained shifts are dated with a least-squares change-point test. Today is compared with how much the meter has normally ' +
      'used by the same hour.</p><p style="margin-top:6px"><b>One cause, one finding.</b> If a leak explains the high daily totals, you see the leak, ' +
      'not a separate alarm for each day.</p><p style="margin-top:6px">Everything runs in your browser on the platform readings. No data is sent anywhere else.</p></details>';
  }
  function pad(n){ return (n < 10 ? '0' : '') + n; }

  /* ---------- one meter ---------- */
  function renderMeter(r){
    var m = (typeof meters !== 'undefined' ? meters : []).filter(function(x){ return x.id === r.id; })[0] || {};
    var n = r.night, o = state.data.options;
    modal.querySelector('#inTitle').textContent = r.name;
    var h = '<span class="inBack" id="inBack">‹ All insights</span>' +
      '<div class="inMeta">' + esc(r.type || '') + ' · readings about every ' + (r.intervalMin || '—') + ' min · ' +
      Math.round(r.coverage * 100) + '% of hours covered (last 28 days) · uses the ' + r.counter + ' counter</div>';

    h += '<div class="inSec" style="margin-top:10px">';
    if (r.findings.length){
      h += r.findings.map(function(f){
        return '<div class="inCardF ' + f.severity + '"><div class="h">' + (ICON[f.type] || '') + ' ' + esc(f.title) +
          '<span class="inSev ' + f.severity + '">' + SEVTXT[f.severity] + '</span>' +
          (f.confidence ? '<span class="inSev conf">' + f.confidence + ' confidence</span>' : '') + '</div>' +
          '<p>' + esc(f.detail) + '</p>' +
          (f.causes ? '<div class="k">Likely causes</div><p style="margin-top:3px">' + esc(f.causes) + '</p>' : '') +
          (f.checks && f.checks.length ? '<div class="k">What to check</div><ul>' + f.checks.map(function(c){ return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
          (f.costPerMonth ? '<div class="cost">Cost if it continues: ' + money(f.costPerMonth) + ' a month · ' + money(f.costPerMonth * 12.17) + ' a year</div>'
            : f.costToday ? '<div class="cost">Extra so far today: ' + money(f.costToday) + '</div>'
            : f.costOnce ? '<div class="cost">Extra that day: ' + money(f.costOnce) + '</div>' : '') +
          '</div>';
      }).join('');
    } else {
      h += '<div class="inCardF ok"><div class="h">✓ No leak or abnormal consumption found</div><p>' +
        (n.status === 'insufficient' ? 'There are not enough night readings to rule out a leak. Consumption checks found nothing unusual.'
          : n.expectedNightUse ? 'Night use is normal for this meter and in line with its usual nights. Daily use is within its normal range.'
          : 'Water stopped completely at night on ' + (n.recentNights - n.continuousNights) + ' of the last ' + n.recentNights +
            ' nights, and daily use is within its normal range.') + '</p></div>';
    }
    h += '</div>';

    /* night flow */
    h += '<div class="inSec"><h3>Night flow · ' + pad(o.NIGHT_FROM) + ':00–' + pad(o.NIGHT_TO) + ':00</h3><div class="inGrid"><div>' +
      '<table class="inTbl">' +
      row(n.status === 'continuous' ? 'Minimum night flow (median of the nights it ran)' : 'Minimum night flow (median, last ' + (n.recentNights || 7) + ' nights)', n.mnf == null ? '—' : '<b>' + num(n.mnf, 3) + ' m³/h</b> · ' + lpm(n.mnf)) +
      row('Night volume ' + pad(o.NIGHT_FROM) + '–' + pad(o.NIGHT_TO) + ' (median)', n.nightVolume == null ? '—' : num(n.nightVolume, 2) + ' m³') +
      row('Nights water never stopped', n.status === 'insufficient' ? '—' : n.continuousNights + ' of ' + n.recentNights) +
      row('Trend in minimum night flow', n.trend ? n.trend + (n.trendPerNight ? ' (' + (n.trendPerNight > 0 ? '+' : '') + lpm(n.trendPerNight).replace(' L/min', ' L/min per night') + ')' : '') : '—') +
      (n.status === 'continuous' ? row('Continuous flow since', n.onsetBeforeWindow ? 'before ' + dshort(n.nights[0].date) + ' (whole period)' : dshort(n.onset)) +
        row('Possible loss (upper limit)', num(n.lossPerDay, 2) + ' m³/day · ' + money(n.lossPerDay * o.TARIFF) + '/day · ' + money(n.lossPerDay * 30 * o.TARIFF) + '/month') : '') +
      (n.nightBaseline != null ? row('Night volume: last 3 nights vs before', num(n.nightRecent, 2) + ' vs ' + num(n.nightBaseline, 2) + ' m³') : '') +
      row('Night profile', n.expectedNightUse ? 'Night use expected (compared with its own nights)' : 'Standard (should stop at night)') +
      row('Usable nights', n.usableNights + ' of ' + o.NIGHTS) +
      '</table></div><div>' + mnfChart(n) + '</div></div>' +
      '<div class="inChart" style="margin-top:12px">' + heatStrip(n, o) + '</div></div>';

    /* daily */
    var dd = r.daily, t = r.today;
    h += '<div class="inSec"><h3>Daily consumption vs normal</h3><div class="inGrid"><div class="inChart" style="grid-column:1/-1">' + dailyChart(dd) + '</div></div>' +
      '<table class="inTbl" style="margin-top:8px">' +
      row('Normal day for this meter', dd.normalDay == null ? 'needs 14+ days of history' : num(dd.normalDay, 1) + ' m³ · ' + money(dd.normalDay * o.TARIFF)) +
      (t ? row('Today so far (to ' + pad(t.hour) + ':00)', num(t.soFar, 1) + ' m³, normally ' + num(t.expectedSoFar, 1) + ' m³ by now' +
               (t.projected != null ? ' · heading for about ' + num(t.projected, 0) + ' m³' : '')) : '') +
      '</table></div>';

    h += '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="inBtn" id="inOnMap">📍 Show on map</button>' +
      (typeof openReportModal === 'function' ? '<button class="inBtn" id="inReport">📄 Consumption report</button>' : '') + '</div>';
    h += methodNote();
    body.innerHTML = h;
    body.querySelector('#inBack').onclick = function(){ state.view = 'overview'; render(); };
    body.querySelector('#inOnMap').onclick = function(){ close(); if (typeof focusMeter === 'function') focusMeter(r.id, true); };
    var rb = body.querySelector('#inReport'); if (rb) rb.onclick = function(){ close(); openReportModal(r.id); };
  }
  function row(k, v){ return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }

  /* 14 nights x 24 hours: continuous flow shows as a band that never goes dark */
  function heatStrip(n, o){
    var nights = n.nights, cw = 22, ch = 15, pl = 58, pt = 16, W = pl + 24 * cw + 4, H = pt + nights.length * ch + 22;
    var vals = [];
    nights.forEach(function(x){ x.hours.forEach(function(v){ if (v != null && v > 0) vals.push(v); }); });
    vals.sort(function(a, b){ return a - b; });
    var top = vals.length ? vals[Math.floor(vals.length * 0.95)] || vals[vals.length - 1] : 1;
    var mut = cssv('--muted', '#7f93ad'), line = cssv('--line', '#1d3149'), acc = cssv('--accent', '#22d3ee');
    var g = '<defs><pattern id="inHatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line x1="0" y1="0" x2="0" y2="4" stroke="' + line + '" stroke-width="1.5"/></pattern></defs>';
    for (var hr = 0; hr < 24; hr += 3)
      g += '<text x="' + (pl + hr * cw + cw / 2) + '" y="11" font-size="9" text-anchor="middle" fill="' + mut + '">' + pad(hr) + '</text>';
    nights.forEach(function(x, i){
      var y = pt + i * ch;
      g += '<text x="' + (pl - 6) + '" y="' + (y + ch - 4) + '" font-size="9" text-anchor="end" fill="' + mut + '">' + dshort(x.date) + '</text>';
      x.hours.forEach(function(v, hr){
        var X = pl + hr * cw, tip = dshort(x.date) + ' ' + pad(hr) + ':00–' + pad((hr + 1) % 24) + ':00: ';
        if (v == null){ g += '<rect x="' + (X + 1) + '" y="' + (y + 1) + '" width="' + (cw - 2) + '" height="' + (ch - 2) + '" fill="url(#inHatch)"><title>' + tip + 'no data</title></rect>'; return; }
        var a = v < 0.005 ? 0 : Math.min(1, 0.18 + 0.82 * Math.log1p(v) / Math.log1p(top));
        g += '<rect x="' + (X + 1) + '" y="' + (y + 1) + '" width="' + (cw - 2) + '" height="' + (ch - 2) + '" rx="2" fill="' + (a ? acc : line) + '"' +
          (a ? ' fill-opacity="' + a.toFixed(2) + '"' : '') + '><title>' + tip + num(v, 3) + ' m³ (' + lpm(v) + ')</title></rect>';
      });
      if (x.continuous) g += '<text x="' + (W - 2) + '" y="' + (y + ch - 4) + '" font-size="9" text-anchor="end" fill="' + cssv('--bad', '#f43f5e') + '">●</text>';
    });
    g += '<rect x="' + (pl + o.NIGHT_FROM * cw) + '" y="' + (pt - 1) + '" width="' + ((o.NIGHT_TO - o.NIGHT_FROM) * cw) + '" height="' + (nights.length * ch + 2) +
      '" fill="none" stroke="' + cssv('--warn', '#f59e0b') + '" stroke-width="1.5" stroke-dasharray="4 3" rx="3"/>';
    return '<div class="ct">Water used each hour, last ' + nights.length + ' nights</div>' +
      '<div class="cs">Each square is one hour. Dark means no water used. A leak shows as a band that never goes dark inside the dashed night window.</div>' +
      '<svg viewBox="0 0 ' + (W + 10) + ' ' + H + '">' + g + '</svg>' +
      '<div class="inLeg"><span><i style="background:' + line + '"></i>no flow</span><span><i style="background:' + acc + ';opacity:.45"></i>low</span>' +
      '<span><i style="background:' + acc + '"></i>high</span><span><i style="background:repeating-linear-gradient(45deg,' + line + ' 0 2px,transparent 2px 4px)"></i>no readings</span>' +
      '<span style="color:var(--bad)">● water never stopped that night</span></div>';
  }

  function mnfChart(n){
    var xs = n.nights, W = 360, H = 150, pl = 36, pb = 22, pt = 8, iw = W - pl - 6, ih = H - pt - pb;
    var vals = xs.map(function(x){ return x.mnf == null ? null : x.mnf * 1000 / 60; });
    var max = Math.max.apply(null, vals.filter(function(v){ return v != null; }).concat([0.5]));
    var mut = cssv('--muted', '#7f93ad'), line = cssv('--line', '#1d3149');
    var bw = iw / xs.length, g = '';
    for (var k = 0; k <= 3; k++){
      var yy = pt + ih - ih * k / 3;
      g += '<line x1="' + pl + '" x2="' + (W - 6) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + line + '"/>' +
        '<text x="' + (pl - 4) + '" y="' + (yy + 3) + '" font-size="8.5" text-anchor="end" fill="' + mut + '">' + num(max * k / 3, max < 3 ? 1 : 0) + '</text>';
    }
    xs.forEach(function(x, i){
      var v = vals[i], X = pl + i * bw;
      if (v == null){ g += '<text x="' + (X + bw / 2) + '" y="' + (pt + ih - 2) + '" font-size="8" text-anchor="middle" fill="' + mut + '">·</text>'; }
      else {
        var hh = Math.max(v > 0 ? 2 : 0, ih * v / max);
        g += '<rect x="' + (X + bw * 0.15) + '" y="' + (pt + ih - hh) + '" width="' + (bw * 0.7) + '" height="' + hh + '" rx="2" fill="' +
          (x.continuous ? cssv('--bad', '#f43f5e') : cssv('--ok', '#22c55e')) + '"><title>' + dshort(x.date) + ': lowest flow ' + num(v, 2) + ' L/min' +
          (x.continuous ? ' (never stopped)' : '') + '</title></rect>';
      }
      if (i % 2 === 0) g += '<text x="' + (X + bw / 2) + '" y="' + (H - 7) + '" font-size="8" text-anchor="middle" fill="' + mut + '">' + dshort(x.date).split(' ')[0] + '</text>';
    });
    return '<div class="inChart"><div class="ct">Lowest night flow each night (L/min)</div>' +
      '<div class="cs">Green: water stopped at some point. Red: it never stopped.</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg></div>';
  }

  function dailyChart(dd){
    var s = dd.series;
    if (!s.length) return '<div class="ct">Daily consumption</div><div class="cs">Not enough daily history yet.</div>';
    var W = 1000, H = 190, pl = 44, pb = 22, pt = 10, iw = W - pl - 8, ih = H - pt - pb;
    var max = Math.max.apply(null, s.map(function(r){ return Math.max(r.v, r.hi || 0); }).concat([1]));
    var mut = cssv('--muted', '#7f93ad'), line = cssv('--line', '#1d3149'), bw = iw / s.length;
    var X = function(i){ return pl + i * bw + bw / 2; }, Y = function(v){ return pt + ih - ih * v / max; };
    var g = '';
    for (var k = 0; k <= 4; k++){
      var yy = Y(max * k / 4);
      g += '<line x1="' + pl + '" x2="' + (W - 8) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + line + '"/>' +
        '<text x="' + (pl - 5) + '" y="' + (yy + 3) + '" font-size="10" text-anchor="end" fill="' + mut + '">' + num(max * k / 4, 0) + '</text>';
    }
    /* normal range band */
    var up = [], dn = [];
    s.forEach(function(r, i){ if (r.hi != null){ up.push(X(i) + ',' + Y(r.hi)); dn.unshift(X(i) + ',' + Y(r.lo)); } });
    if (up.length > 1) g += '<polygon points="' + up.concat(dn).join(' ') + '" fill="' + cssv('--accent', '#22d3ee') + '" fill-opacity=".10"/>';
    s.forEach(function(r, i){
      var hh = Math.max(r.v > 0 ? 1.5 : 0, ih * r.v / max);
      var col = r.flag === 'high' ? cssv('--bad', '#f43f5e') : r.flag === 'low' ? cssv('--warn', '#f59e0b') : cssv('--blue', '#3b82f6');
      g += '<rect x="' + (X(i) - bw * 0.35) + '" y="' + (pt + ih - hh) + '" width="' + (bw * 0.7) + '" height="' + hh + '" rx="1.5" fill="' + col + '" fill-opacity="' + (r.flag ? 1 : 0.75) + '">' +
        '<title>' + dshort(r.d) + ': ' + num(r.v, 1) + ' m³' + (r.expected != null ? ' · normal ' + num(r.expected, 1) + ' m³ (range ' + num(r.lo, 0) + '–' + num(r.hi, 0) + ')' : '') +
        (r.weekdayFactor ? ' · this weekday usually ×' + r.weekdayFactor : '') + '</title></rect>';
      if (i % 7 === 0) g += '<text x="' + X(i) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="' + mut + '">' + dshort(r.d) + '</text>';
    });
    var exp = s.map(function(r, i){ return r.expected == null ? null : X(i) + ',' + Y(r.expected); }).filter(Boolean);
    if (exp.length > 1) g += '<polyline points="' + exp.join(' ') + '" fill="none" stroke="' + mut + '" stroke-width="1.2" stroke-dasharray="4 3"/>';
    return '<div class="ct">Daily use, last ' + s.length + ' days</div>' +
      '<div class="cs">Shaded: this meter’s normal range for that day of the week. Dashed: its typical day.</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>' +
      '<div class="inLeg"><span><i style="background:var(--blue)"></i>within normal</span><span><i style="background:var(--bad)"></i>abnormally high</span>' +
      '<span><i style="background:var(--warn)"></i>abnormally low</span></div>';
  }

  /* ---------- compact block in the meter panel ---------- */
  function renderDetail(m){
    window.__detailMeter = m;
    var el = document.getElementById('dInsight');
    if (!el) return;
    if (!haveAuth()){ el.innerHTML = '<div class="di"><div><span>Connect to the platform to check this meter for leaks and abnormal use.</span></div></div>'; return; }
    var r = resultFor(m.id);
    if (!r){
      el.innerHTML = state.err
        ? '<div class="di"><div><span>Leak analysis unavailable: ' + esc(state.err) + '</span></div></div>'
        : '<div class="di"><div><span>Checking for leaks and abnormal use…</span></div></div>';
      if (!state.loading && !state.err) load();
      return;
    }
    var n = r.night, h = '';
    if (r.findings.length){
      h = r.findings.slice(0, 2).map(function(f){
        return '<div class="di ' + f.severity + '"><div>' + (ICON[f.type] || '') + '</div><div><b>' + esc(f.title) + '</b><span>' + esc(f.summary) +
          (f.costPerMonth ? ' · ' + money(f.costPerMonth) + '/month' : '') + '</span></div></div>';
      }).join('');
      if (r.findings.length > 2) h += '<div class="di"><div></div><div><span>+' + (r.findings.length - 2) + ' more</span></div></div>';
    } else {
      h = '<div class="di ok"><div>✓</div><div><b>No leak or abnormal use</b><span>' +
        (n.status === 'insufficient' ? 'Not enough night readings to rule out a leak'
          : n.expectedNightUse ? 'Night use in line with its usual nights'
          : 'Water stopped at night on ' + (n.recentNights - n.continuousNights) + ' of ' + n.recentNights + ' nights') + '</span></div></div>';
    }
    el.innerHTML = h + '<span class="dmore" id="dMore">Full analysis: night flow, heat map, causes ›</span>';
    document.getElementById('dMore').onclick = function(){ open({ meter: m.id }); };
  }

  window.loadInsights = load;
  window.openInsights = open;
  window.renderDetailInsight = renderDetail;
  window.insightFor = resultFor;
})();
