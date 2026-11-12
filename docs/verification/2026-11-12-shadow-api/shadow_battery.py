#!/usr/bin/env python3
"""Full functional battery for the Hebrew vowel-variant shadow API (8799).
Read-only: HTTP GETs against 127.0.0.1:8799 + read-only SQL on the shadow DB.
Credentials are loaded from the Lampy env files and never printed."""
import json, urllib.request, urllib.error, random, base64
import psycopg2

BASE = 'http://127.0.0.1:8799'
ROOT = '/api/lexicon/hebrew-vowel-variants'

def load(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

TOKEN = load('/root/bible-app-api.env')['BIBLE_APP_SANDBOX_TOKEN']
DBURL = load('/root/bible-hebrew-variant-api.env')['HEBREW_VARIANT_DATABASE_URL']

results = []
def record(tid, cat, desc, ok, detail=''):
    results.append({'id': tid, 'cat': cat, 'desc': desc,
                    'status': 'PASS' if ok else 'FAIL', 'detail': str(detail)[:400]})
    print(('PASS ' if ok else 'FAIL ') + tid + ' ' + desc + ((' :: ' + str(detail)[:160]) if detail else ''))

def req(path, token='valid', method='GET'):
    headers = {}
    if token == 'valid':
        headers['x-sandbox-token'] = TOKEN
    elif token == 'wrong':
        headers['x-sandbox-token'] = 'definitely-not-the-token'
    elif token == 'bearer':
        headers['Authorization'] = 'Bearer ' + TOKEN
    r = urllib.request.Request(BASE + path, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            body = resp.read().decode('utf-8', 'replace')
            try: parsed = json.loads(body)
            except Exception: parsed = None
            return resp.status, resp.headers.get('Content-Type', ''), parsed, body
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        try: parsed = json.loads(body)
        except Exception: parsed = None
        return e.code, e.headers.get('Content-Type', ''), parsed, body
    except Exception as e:
        return -1, '', None, str(e)

conn = psycopg2.connect(DBURL); conn.set_session(readonly=True, autocommit=True)
cur = conn.cursor()
def sql(q, args=()):
    cur.execute(q, args); return cur.fetchall()

# ---------- AUTH ----------
s, ct, b, _ = req(ROOT + '/by-word/238432', token=None)
record('A1', 'auth', 'no token -> 403 Sandbox authorization required', s == 403 and b == {'error': 'Sandbox authorization required'}, f'{s} {b}')
s, ct, b, _ = req(ROOT + '/by-word/238432', token='wrong')
record('A2', 'auth', 'wrong token -> 403', s == 403 and b == {'error': 'Sandbox authorization required'}, f'{s} {b}')
s, ct, b, _ = req(ROOT + '/by-word/238432', token='bearer')
record('A3', 'auth', 'Bearer header (valid token, wrong mechanism) -> 403', s == 403, f'{s}')
s, ct, b, _ = req(ROOT + '/504', token=None)
record('A4', 'auth', 'no token on group route -> 403', s == 403, f'{s}')
s, ct, b, _ = req(ROOT + '/504/members/6627/4/11/occurrences', token=None)
record('A5', 'auth', 'no token on occurrences route -> 403', s == 403, f'{s}')
s, ct, b, _ = req(ROOT + '/by-word/238432', token='valid')
record('A6', 'auth', 'valid x-sandbox-token -> 200', s == 200, f'{s}')

# ---------- REGRESSION ----------
s, ct, b, _ = req(ROOT + '/by-word/238432')
record('R1', 'regression', 'by-word/238432 -> group 504', s == 200 and b and b.get('group', {}).get('id') == 504, f'{s} {b}')
s, ct, b, _ = req(ROOT + '/504')
keys = sorted((m['memberKey']['rootId'], m['memberKey']['rootFormSeq'], m['memberKey']['vowelSeq']) for m in b['group']['members']) if b and b.get('group') else []
record('R2', 'regression', 'group 504 members == {(6627,4,11),(21384,3,1)}', s == 200 and keys == [(6627, 4, 11), (21384, 3, 1)], f'{s} {keys}')
s, ct, b, _ = req(ROOT + '/504/members/6627/4/11/occurrences?limit=100')
db_occ = sorted(r[0] for r in sql("""SELECT w.word_id FROM words w WHERE w.root_id=6627 AND w.root_form_seq=4
    AND w.root_vowel_seq=11 AND w.is_aramaic=0"""))
api_occ = sorted(o['wordId'] for o in b['occurrences']) if b else []
record('R3', 'regression', 'group 504 member (6627,4,11) occurrences == DB set', s == 200 and api_occ == db_occ, f'api {api_occ} db {db_occ}')
ez = {238431: 181, 238432: 504, 238435: 2659, 238436: 2177}
ok, det = True, []
for wid, g in ez.items():
    s, ct, b, _ = req(f'{ROOT}/by-word/{wid}')
    got = (b.get('group') or {}).get('id') if b else None
    if got != g: ok, det = False, det + [f'{wid}->{got}']
record('R4', 'regression', 'Ezekiel 27:32 associations 181/504/2659/2177', ok, det or 'all match')
nulls = [238430, 238433, 238434, 238437, 238438, 238439, 238440]
ok, det = True, []
for wid in nulls:
    s, ct, b, _ = req(f'{ROOT}/by-word/{wid}')
    if not (s == 200 and b and b.get('group') is None): ok, det = False, det + [f'{wid}:{s}:{b}']
record('R5', 'regression', 'Ezekiel 27:32 non-variant words -> group null', ok, det or 'all null')

# ---------- FUNCTIONAL CROSS-CHECKS ----------
random.seed(20261112)
grouped = sql("""SELECT DISTINCT w.word_id FROM words w JOIN hebrew_vowel_variant_member m
  ON m.root_id=w.root_id AND m.root_form_seq=w.root_form_seq AND m.vowel_seq=w.root_vowel_seq
  AND m.is_aramaic=(w.is_aramaic=1)""")
grouped_ids = [r[0] for r in grouped]
sample = random.sample(grouped_ids, 60)
ok, det = True, []
for wid in sample:
    exp = sql("""SELECT m.variant_group_id FROM words w JOIN hebrew_vowel_variant_member m
      ON m.root_id=w.root_id AND m.root_form_seq=w.root_form_seq AND m.vowel_seq=w.root_vowel_seq
      AND m.is_aramaic=(w.is_aramaic=1) WHERE w.word_id=%s""", (wid,))
    s, ct, b, _ = req(f'{ROOT}/by-word/{wid}')
    got = (b.get('group') or {}).get('id') if b else None
    if len(exp) != 1 or got != exp[0][0]: ok, det = False, det + [f'{wid}: api {got} db {exp}']
record('F1', 'functional', '60 sampled grouped words: API group == DB group', ok, det[:4] or '60/60 match')
ungrouped = sql("""SELECT w.word_id FROM words w WHERE NOT EXISTS (SELECT 1 FROM hebrew_vowel_variant_member m
  WHERE m.root_id=w.root_id AND m.root_form_seq=w.root_form_seq AND m.vowel_seq=w.root_vowel_seq
  AND m.is_aramaic=(w.is_aramaic=1))""")
sample = random.sample([r[0] for r in ungrouped], 60)
ok, det = True, []
for wid in sample:
    s, ct, b, _ = req(f'{ROOT}/by-word/{wid}')
    if not (s == 200 and b and b.get('group') is None): ok, det = False, det + [f'{wid}:{s}']
record('F2', 'functional', '60 sampled ungrouped words: API group null', ok, det[:4] or '60/60 null')
aram = sql("""SELECT DISTINCT w.word_id FROM words w JOIN hebrew_vowel_variant_member m
  ON m.root_id=w.root_id AND m.root_form_seq=w.root_form_seq AND m.vowel_seq=w.root_vowel_seq
  WHERE w.is_aramaic=1 AND m.is_aramaic""")
ok, det = True, []
for (wid,) in random.sample(aram, min(15, len(aram))):
    exp = sql("""SELECT m.variant_group_id FROM words w JOIN hebrew_vowel_variant_member m
      ON m.root_id=w.root_id AND m.root_form_seq=w.root_form_seq AND m.vowel_seq=w.root_vowel_seq
      AND m.is_aramaic WHERE w.word_id=%s AND w.is_aramaic=1""", (wid,))
    s, ct, b, _ = req(f'{ROOT}/by-word/{wid}')
    g = (b or {}).get('group') or {}
    if not (g.get('id') == exp[0][0] and g.get('language') == 'aramaic'): ok, det = False, det + [f'{wid}: {g} db {exp}']
record('F3', 'functional', '15 sampled Aramaic words: group + language=aramaic', ok, det[:4] or f'{min(15,len(aram))} sampled of {len(aram)}')
amb = [(833, 235), (67372, 1047), (101532, 1040)]
ok, det = True, []
for wid, exp_g in amb:
    s, ct, b, _ = req(f'{ROOT}/by-word/{wid}')
    got = ((b or {}).get('group') or {}).get('id')
    if got != exp_g: ok, det = False, det + [f'{wid}: api {got} expected-hebrew-group {exp_g}']
record('F4', 'functional', 'ambiguous keys (root 2752): Hebrew words resolve to Hebrew group', ok, det or '235/1047/1040 as expected')
all_groups = [r[0] for r in sql("SELECT variant_group_id FROM hebrew_vowel_variant_group")]
ok, det = True, []
for gid in random.sample(all_groups, 25):
    exp = sorted(sql("""SELECT root_id, root_form_seq, vowel_seq FROM hebrew_vowel_variant_member
      WHERE variant_group_id=%s""", (gid,)))
    s, ct, b, _ = req(f'{ROOT}/{gid}')
    got = sorted((m['memberKey']['rootId'], m['memberKey']['rootFormSeq'], m['memberKey']['vowelSeq']) for m in b['group']['members']) if b and b.get('group') else None
    if got != [tuple(e) for e in exp]: ok, det = False, det + [f'group {gid} member set differs']
    else:
        for m in b['group']['members']:
            mk = m['memberKey']
            cnt = sql("""SELECT count(*) FROM words WHERE root_id=%s AND root_form_seq=%s
              AND root_vowel_seq=%s AND is_aramaic=(SELECT CASE WHEN is_aramaic THEN 1 ELSE 0 END
              FROM hebrew_vowel_variant_group WHERE variant_group_id=%s)""",
              (mk['rootId'], mk['rootFormSeq'], mk['vowelSeq'], gid))[0][0]
            if m['occurrenceCount'] != cnt: ok, det = False, det + [f'group {gid} member {mk} count api {m["occurrenceCount"]} db {cnt}']
record('F5', 'functional', '25 sampled groups: member sets + occurrenceCounts == DB', ok, det[:4] or '25/25 exact')
# pagination: largest member
big = sql("""SELECT m.variant_group_id, m.root_id, m.root_form_seq, m.vowel_seq, count(*) c
  FROM hebrew_vowel_variant_member m JOIN words w ON w.root_id=m.root_id AND w.root_form_seq=m.root_form_seq
  AND w.root_vowel_seq=m.vowel_seq AND (w.is_aramaic=1)=m.is_aramaic GROUP BY 1,2,3,4 ORDER BY c DESC LIMIT 1""")[0]
gid, rid, rfs, vs, total = big
seen, cursor, pages = [], None, 0
while True:
    p = f'{ROOT}/{gid}/members/{rid}/{rfs}/{vs}/occurrences?limit=100' + (f'&cursor={cursor}' if cursor else '')
    s, ct, b, _ = req(p)
    if s != 200: break
    seen += [o['wordId'] for o in b['occurrences']]; pages += 1
    cursor = b.get('nextCursor')
    if not cursor or pages > 30: break
db_all = sorted(r[0] for r in sql("""SELECT word_id FROM words WHERE root_id=%s AND root_form_seq=%s
  AND root_vowel_seq=%s AND is_aramaic=%s""", (rid, rfs, vs, 1 if sql("SELECT is_aramaic FROM hebrew_vowel_variant_member WHERE variant_group_id=%s AND root_id=%s AND root_form_seq=%s AND vowel_seq=%s", (gid, rid, rfs, vs))[0][0] else 0)))
record('F6', 'functional', f'cursor walk of largest member (group {gid}, {total} occ, {pages} pages): set == DB, no dupes',
       sorted(seen) == db_all and len(seen) == len(set(seen)), f'api {len(seen)} db {len(db_all)}')
# occurrence verse fields vs DB
s, ct, b, _ = req(f'{ROOT}/504/members/21384/3/1/occurrences?limit=100')
ok, det = True, []
for o in (b or {}).get('occurrences', []):
    row = sql("""SELECT b.name_en, v.chapter, v.verse, w.word_pos, w.pointed FROM words w
      JOIN verses v ON v.verse_id=w.verse_id JOIN books b ON b.book_id=v.book_id WHERE w.word_id=%s""", (o['wordId'],))
    if not row or o['verse']['book'] != row[0][0] or o['verse']['chapter'] != row[0][1] or o['verse']['verse'] != row[0][2] or o['wordPosition'] != row[0][3] or o['pointed'] != row[0][4]:
        ok, det = False, det + [f"word {o['wordId']} field mismatch"]
record('F7', 'functional', 'occurrence verse/position/pointed fields == DB (member 504/(21384,3,1))', ok, det or 'all fields match')

# ---------- NEGATIVE / BOUNDARY ----------
def expect(tid, desc, path, want_status, want_err=None, token='valid'):
    s, ct, b, raw = req(path, token=token)
    okk = s in want_status and (want_err is None or (b and b.get('error') == want_err))
    record(tid, 'negative', desc, okk, f'{s} {b if b else raw[:80]}')
expect('N1', 'by-word/0 -> 400 Invalid wordId', ROOT + '/by-word/0', [400], 'Invalid wordId')
expect('N2', 'by-word/-1 -> 400', ROOT + '/by-word/-1', [400], 'Invalid wordId')
expect('N3', 'by-word/abc -> 400', ROOT + '/by-word/abc', [400], 'Invalid wordId')
expect('N4', 'by-word/264218 (nonexistent) -> 404 Source word not found', ROOT + '/by-word/264218', [404], 'Source word not found')
expect('N5', 'by-word/99999999999999999999 (overflow) -> 400, no 500', ROOT + '/by-word/99999999999999999999', [400], 'Invalid wordId')
expect('N6', 'by-word/000238432 (leading zeros) -> 400', ROOT + '/by-word/000238432', [400], 'Invalid wordId')
expect('N7', 'group/0 -> 400 Invalid variantGroupId', ROOT + '/0', [400], 'Invalid variantGroupId')
expect('N8', 'group/3350 (nonexistent) -> 404 Variant group not found', ROOT + '/3350', [404], 'Variant group not found')
expect('N9', 'group/abc -> 400', ROOT + '/abc', [400], 'Invalid variantGroupId')
expect('N10', 'occurrences for member not in group 504 -> 404', ROOT + '/504/members/1/1/1/occurrences', [404], 'Variant group or member not found')
expect('N11', 'occurrences limit=0 -> 400', ROOT + '/504/members/6627/4/11/occurrences?limit=0', [400], 'limit must be between 1 and 100')
expect('N12', 'occurrences limit=101 -> 400', ROOT + '/504/members/6627/4/11/occurrences?limit=101', [400], 'limit must be between 1 and 100')
expect('N13', 'occurrences limit=abc -> 400 Invalid limit', ROOT + '/504/members/6627/4/11/occurrences?limit=abc', [400], 'Invalid limit')
expect('N14', 'occurrences garbage cursor -> 400 Invalid cursor', ROOT + '/504/members/6627/4/11/occurrences?cursor=zzz!!!', [400], 'Invalid cursor')
s, ct, b, _ = req(f'{ROOT}/504/members/6627/4/11/occurrences?limit=1')
cur1 = (b or {}).get('nextCursor')
if cur1:
    expect('N15', 'cursor minted for member A used on member B -> 400 Invalid cursor', ROOT + f'/504/members/21384/3/1/occurrences?cursor={cur1}', [400], 'Invalid cursor')
else:
    record('N15', 'negative', 'cursor cross-member reuse', False, 'no cursor minted (member has <=1 occurrence at limit 1?)')
expect('N16', 'bare route (no id) with token -> 404', ROOT, [404])
expect('N17', 'by-word with extra path segment -> 404', ROOT + '/by-word/238432/extra', [404])
s, ct, b, _ = req(ROOT + '/by-word/238432?unused=param')
record('N18', 'negative', 'unknown query param ignored -> 200 group 504', s == 200 and (b or {}).get('group', {}).get('id') == 504, f'{s}')
s, ct, b, raw = req(ROOT + '/by-word/238432', method='POST')
record('N19', 'negative', 'POST to by-word route -> not routed (404)', s == 404, f'{s} {raw[:60]}')
s, ct, b, _ = req(ROOT + '/by-word/238432/')
record('N20', 'negative', 'trailing slash on by-word -> record behavior', s in (200, 404), f'status {s}')

# ---------- STRUCTURE ----------
s, ct, b, _ = req(ROOT + '/by-word/238432')
record('S1', 'structure', '200 response Content-Type is JSON', 'application/json' in ct, ct)
record('S2', 'structure', 'group payload has id/language/relation/dataset with all dataset fields',
       bool(b) and {'id', 'language', 'relation', 'dataset'} <= set(b['group']) and
       {'algorithmVersion', 'normalizationForm', 'sourceSnapshotId', 'validation'} <= set(b['group']['dataset']), '')
s, ct, b, _ = req(ROOT + '/504')
record('S3', 'structure', 'group response carries interpretiveLimit + members with pointedForm/root/rootForm',
       bool(b) and 'interpretiveLimit' in b['group'] and all('pointedForm' in m and 'root' in m and 'rootForm' in m for m in b['group']['members']), '')
s, ct, b, _ = req(ROOT + '/by-word/0')
record('S4', 'structure', 'error bodies are JSON {"error": ...}', 'application/json' in ct and isinstance(b, dict) and 'error' in b, f'{ct} {b}')

# ---------- INVARIANTS ----------
g = sql("SELECT count(*) FROM hebrew_vowel_variant_group")[0][0]
m = sql("SELECT count(*) FROM hebrew_vowel_variant_member")[0][0]
u = sql("SELECT count(DISTINCT (root_id, root_form_seq, vowel_seq)) FROM hebrew_vowel_variant_member")[0][0]
o = sql("""SELECT count(*) FROM words w WHERE EXISTS (SELECT 1 FROM hebrew_vowel_variant_member mm
  WHERE mm.root_id=w.root_id AND mm.root_form_seq=w.root_form_seq AND mm.vowel_seq=w.root_vowel_seq
  AND mm.is_aramaic=(w.is_aramaic=1))""")[0][0]
record('I1', 'invariants', 'DB counts == API EXPECTED (3349/7148/7145/32676)', (g, m, u, o) == (3349, 7148, 7145, 32676), f'{g}/{m}/{u}/{o}')
s, ct, b, _ = req(ROOT + '/by-word/238432')
record('I2', 'invariants', 'dataset.validation == runtime-invariants-passed (live)', bool(b) and b['group']['dataset']['validation'] == 'runtime-invariants-passed', '')
mm = sql("""SELECT count(*) FROM (SELECT root_id, root_form_seq, vowel_seq, is_aramaic
  FROM hebrew_vowel_variant_member GROUP BY 1,2,3,4 HAVING count(DISTINCT variant_group_id)>1) d""")[0][0]
record('I3', 'invariants', 'no (key, language) member assigned to multiple groups', mm == 0, f'{mm}')

conn.close()
summary = {'total': len(results), 'pass': sum(1 for r in results if r['status'] == 'PASS'),
           'fail': sum(1 for r in results if r['status'] == 'FAIL')}
print('SUMMARY', summary)
with open('/root/shadow_battery_results.json', 'w') as f:
    json.dump({'summary': summary, 'results': results}, f, indent=1, ensure_ascii=False)
