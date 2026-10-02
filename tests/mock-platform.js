/* TEST HARNESS ONLY - never loaded by the published site.
   Stands in for the 3PhTech platform so the pages can be driven end to end
   without a login: it answers the same SQL the dashboard sends, from the real
   exports in fixture.json, shifted forward by whole days so the newest reading
   looks recent. Load it after the page's own scripts:

     <script src="tests/mock-platform.js"></script>                            */
window.__mock = (async function(){
  const P = await fetch('tests/fixture.json').then(r => r.json());
  const DAY = 86400000, HOUR = 3600000;
  const DEVICES = [
    { id: 'golf',    name: 'Golf Academy', type: 'Flow Meter',  key: 'golf' },
    { id: 'stables', name: '30 stables',   type: 'Water Meter', key: 'stables' },
  ];
  const newest = Math.max.apply(null, DEVICES.map(d => Math.max.apply(null, P[d.key].rows.map(r => r.ts))));
  const SHIFT = Math.floor((Date.now() - 20 * 60000 - newest) / DAY) * DAY;     // whole days only

  const series = {};                                      // device -> key -> [{ts, v}]
  DEVICES.forEach(d => {
    const ex = P[d.key], col = p => ex.header.find(h => h.startsWith(p));
    series[d.id] = {};
    [[949, 'Ttl Flow Cons.'], [347, 'Flow (M'], [969, 'Flow Cons.'], [1041, 'Wtr Cons./D']].forEach(pair => {
      const c = col(pair[1]); if (!c) return;
      series[d.id][pair[0]] = ex.rows.filter(r => r[c] != null).map(r => ({ ts: r.ts + SHIFT, v: r[c] }));
    });
  });

  window.__mockInfo = { shiftDays: SHIFT / DAY, devices: DEVICES.map(d => d.id) };
  window.__mockRows = 0;
  window.haveAuth = () => true;
  window.sql = async function(q){
    q = q.replace(/\s+/g, ' ');
    if (/device_status_history/.test(q))
      return DEVICES.map(d => ({ id: d.id, name: d.name, type: d.type, active: true, sts: Date.now() - HOUR }));
    if (/ts_data_latest/.test(q)){
      const out = [];
      DEVICES.forEach(d => Object.keys(series[d.id]).forEach(key => {
        const s = series[d.id][key];
        if (s && s.length) out.push({ device: d.id, key: Number(key), num_value: s[s.length - 1].v, ts: s[s.length - 1].ts });
      }));
      return out;
    }
    const key = Number((q.match(/l\.key=(\d+)/) || [])[1] || 0);
    if (/from ts_data l/.test(q) && key && !/group by/.test(q)){
      const from = Number((q.match(/l\.ts>=(\d+)/) || [])[1] || 0);
      const to = Number((q.match(/l\.ts<=(\d+)/) || [])[1] || Infinity);
      const inList = q.match(/l\.device in \(([^)]*)\)/);
      const want = inList ? inList[1].split(',').map(x => x.trim().replace(/'/g, '')) : DEVICES.map(d => d.id);
      const out = [];
      want.forEach(id => ((series[id] || {})[key] || []).forEach(x => {
        if (x.ts >= from && x.ts <= to) out.push({ device: id, key: key, ts: x.ts, v: x.v });
      }));
      window.__mockRows += out.length;
      return out;
    }
    return [];                                            // alarms and anything else: nothing
  };
  return window.__mockInfo;
})();
