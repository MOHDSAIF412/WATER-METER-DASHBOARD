# Builds tests/fixture.json from the portal's own exports, so the checks run on
# real meter readings rather than invented ones. Run it again when newer exports
# arrive; the result is committed, so the tests need neither the spreadsheets nor
# a connection:
#     python tests/build-fixture.py "C:/Users/SAIF412/Downloads"
#
# Timestamps in the exports are Dubai local time (UTC+4); they are stored here as
# UTC milliseconds, which is what the platform returns and what usage.js expects.
import csv, datetime, io, json, os, sys, warnings
warnings.filterwarnings('ignore')
import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else 'C:/Users/SAIF412/Downloads'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixture.json')
TZ = 4 * 3600 * 1000

EXPORTS = [
    ('golf',      '12211.xlsx',
     'Golf Academy', 'a flow meter reading every 20 min, 1 Jul - 16 Sep 2026'),
    ('stables',   'Water Monitoring Dashboard for TCT_Data Report_17_09_2026 11_22 AM.xlsx',
     '30 stables', 'a water meter reading every 7 h, 1 - 15 Sep 2026'),
]
DAILY_CSV = [
    ('accommodation', '30_stables_accommodation_water_cons.csv', '30 stables accommodation'),
    ('racetrack',     'Racetrack_Pump_Station_water_cons.csv',   'Racetrack Pump Station'),
]


def ms(date_text, time_text):
    """'01/09/2026' + '5:00 PM' (Dubai) -> UTC milliseconds"""
    day = datetime.datetime.strptime(date_text.strip(), '%d/%m/%Y')
    t = time_text.strip().upper().replace('.', '')
    hh, mm = t.split(' ')[0].split(':')
    hh, mm = int(hh), int(mm)
    if 'PM' in t and hh != 12: hh += 12
    if 'AM' in t and hh == 12: hh = 0
    stamp = day.replace(hour=hh, minute=mm, tzinfo=datetime.timezone.utc)
    return int(stamp.timestamp() * 1000) - TZ


def num(v):
    s = str(v).strip()
    if s in ('', '-', 'None') or s.strip('- ') == '': return None
    try: return float(s)
    except ValueError: return None


fixture = {'note': 'Real exports from the 3PhTech portal. Built by tests/build-fixture.py.'}

for key, fname, meter, about in EXPORTS:
    path = os.path.join(SRC, fname)
    rows = list(openpyxl.load_workbook(path, read_only=True)['Main Report'].iter_rows(values_only=True))
    head = [str(c) for c in rows[3][3:] if c and str(c) != 'None']
    out = []
    for r in rows[4:]:
        if not r[0] or '/' not in str(r[0]): continue
        rec = {'ts': ms(str(r[0]), str(r[1]))}
        for i, h in enumerate(head):
            v = num(r[3 + i])
            if v is not None: rec[h] = v
        out.append(rec)
    fixture[key] = {'meter': meter, 'about': about, 'header': head, 'rows': out}
    print('%-14s %5d readings  %s' % (key, len(out), head[0][:40]))

for key, fname, meter in DAILY_CSV:
    days = {}
    for row in csv.DictReader(io.open(os.path.join(SRC, fname), encoding='utf-8-sig')):
        days[row['Date'].strip()] = num(row.get('Water Cons. (m3)'))
    fixture[key] = {'meter': meter, 'portalDaily': days,
                    'about': "the portal's own daily figures; this export carries no register readings"}
    print('%-14s %5d days      %s' % (key, len(days), meter))

json.dump(fixture, io.open(OUT, 'w', encoding='utf-8'))
print('written', OUT, os.path.getsize(OUT) // 1024, 'KB')
