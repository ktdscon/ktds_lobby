#!/usr/bin/env python3
"""
타사교육과정.csv 를 읽어 표를 만든다.

  python3 news/build_table.py          → news/타사교육과정.html 생성
  python3 news/build_table.py --md     → 마크다운 표를 화면에 출력 (채팅에 붙여넣기용)

CSV만 고치면 된다. HTML은 손으로 고치지 말 것 — 이 스크립트가 덮어쓴다.
"""
import csv, html, io, os, sys
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, '타사교육과정.csv')
HTML_PATH = os.path.join(HERE, '타사교육과정.html')

# 확인수준 → (표시 문구, 색 키). 데이터를 얼마나 믿을 수 있는지 한눈에 보이게 한다.
TRUST = OrderedDict([
    ('원문확인',      ('원문 확인', 'ok')),
    ('기사인용',      ('기사 인용', 'mid')),
    ('기사+검색요약', ('기사+검색', 'mid')),
    ('검색요약',      ('검색 요약', 'low')),
])

# 표에 넣을 순서 (구분별로 묶어서 보여준다)
GROUP_ORDER = ['정부 훈련', '공공·협회', '기업교육(B2B)', '대기업 사내', '대학']


def load():
    with io.open(CSV_PATH, encoding='utf-8') as f:
        rows = [r for r in csv.DictReader(f) if (r.get('기관') or '').strip()]
    rows.sort(key=lambda r: (
        GROUP_ORDER.index(r['구분']) if r['구분'] in GROUP_ORDER else len(GROUP_ORDER),
        r['기관'],
    ))
    return rows


def to_markdown(rows):
    cols = ['기관', '과정명', '대상', '기간·시수', '특징', '확인']
    out = ['| ' + ' | '.join(cols) + ' |', '|' + '---|' * len(cols)]
    for r in rows:
        feat = r['특징·커리큘럼']
        if len(feat) > 60:
            feat = feat[:58] + '…'
        out.append('| ' + ' | '.join([
            r['기관'],
            '[%s](%s)' % (r['과정명'], r['출처']) if r['출처'] else r['과정명'],
            r['대상'],
            r['기간·시수'],
            feat.replace('|', '/'),
            TRUST.get(r['확인수준'], (r['확인수준'], ''))[0],
        ]) + ' |')
    return '\n'.join(out)


def to_html(rows):
    e = html.escape
    groups = OrderedDict()
    for r in rows:
        groups.setdefault(r['구분'], []).append(r)

    dates = sorted({r['확인일'] for r in rows if r['확인일']})
    asof = dates[-1] if dates else ''
    low = sum(1 for r in rows if r['확인수준'] == '검색요약')

    body = []
    for g, items in groups.items():
        body.append('<h2>%s <span class="n">%d</span></h2>' % (e(g), len(items)))
        body.append('<div class="tw"><table><thead><tr>'
                    '<th>기관</th><th>과정명</th><th>대상</th><th>기간·시수</th>'
                    '<th>특징 · 커리큘럼</th><th>확인</th></tr></thead><tbody>')
        for r in items:
            label, cls = TRUST.get(r['확인수준'], (r['확인수준'], 'low'))
            name = e(r['과정명'])
            if r['출처']:
                name = '<a href="%s" target="_blank" rel="noopener">%s</a>' % (e(r['출처']), name)
            body.append(
                '<tr><td class="org">%s</td><td>%s</td><td>%s</td><td class="nw">%s</td>'
                '<td class="feat">%s</td><td><span class="tag %s">%s</span></td></tr>' % (
                    e(r['기관']), name, e(r['대상']), e(r['기간·시수']),
                    e(r['특징·커리큘럼']), cls, e(label)))
        body.append('</tbody></table></div>')

    return TEMPLATE % {
        'asof': e(asof), 'total': len(rows), 'low': low, 'body': '\n'.join(body),
    }


TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>타사 교육과정 — 정리</title>
<style>
  :root{--bg:#faf9f7;--card:#fff;--ink:#1c1b19;--muted:#6b6862;--line:#e6e3dd;
        --accent:#1a5fb4;--head:#f2f0ec;
        --ok-b:#e4f2e6;--ok-i:#1d6b33;--mid-b:#fdf1dc;--mid-i:#8a5a11;--low-b:#f0eeea;--low-i:#6b6862;}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
    --bg:#16151a;--card:#1e1d23;--ink:#ece9e4;--muted:#9a958d;--line:#302e36;
    --accent:#7cadea;--head:#26252c;
    --ok-b:#1e3a26;--ok-i:#8fd3a2;--mid-b:#3a2f1a;--mid-i:#e2b872;--low-b:#2a2930;--low-i:#9a958d;}}
  :root[data-theme="dark"]{
    --bg:#16151a;--card:#1e1d23;--ink:#ece9e4;--muted:#9a958d;--line:#302e36;
    --accent:#7cadea;--head:#26252c;
    --ok-b:#1e3a26;--ok-i:#8fd3a2;--mid-b:#3a2f1a;--mid-i:#e2b872;--low-b:#2a2930;--low-i:#9a958d;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);line-height:1.55;
    font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Malgun Gothic",system-ui,sans-serif;
    -webkit-text-size-adjust:100%%;}
  .wrap{max-width:1080px;margin:0 auto;padding-block:28px 64px;padding-left:18px;padding-right:18px}
  h1{font-size:1.45rem;margin:0 0 6px;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:.9rem;margin:0 0 4px}
  .note{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--accent);
        border-radius:8px;padding:12px 14px;margin:18px 0 4px;font-size:.87rem;color:var(--muted)}
  h2{font-size:.95rem;margin:30px 0 10px;letter-spacing:-.005em}
  h2 .n{color:var(--muted);font-weight:400;font-size:.85em;margin-left:4px}
  .tw{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
  table{border-collapse:collapse;width:100%%;min-width:760px;font-size:.86rem}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:var(--head);font-weight:650;font-size:.8rem;color:var(--muted);white-space:nowrap}
  tbody tr:last-child td{border-bottom:none}
  td.org{font-weight:600;white-space:nowrap}
  td.nw{white-space:nowrap;color:var(--muted)}
  td.feat{color:var(--muted);min-width:280px}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  .tag{display:inline-block;font-size:.72rem;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}
  .tag.ok{background:var(--ok-b);color:var(--ok-i)}
  .tag.mid{background:var(--mid-b);color:var(--mid-i)}
  .tag.low{background:var(--low-b);color:var(--low-i)}
  footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
  footer p{margin:0 0 6px}
</style>
</head>
<body>
<div class="wrap">
<h1>타사 교육과정</h1>
<p class="sub">기준일 %(asof)s · 총 %(total)d건</p>

<div class="note">
  <strong>확인</strong> 칸을 먼저 보세요. <span class="tag ok">원문 확인</span> 은 해당 기관 페이지에서 직접 확인한 것,
  <span class="tag mid">기사 인용</span> 은 언론 보도 기준, <span class="tag low">검색 요약</span> 은 검색 결과 수준이라
  과정명·구성이 실제와 다를 수 있습니다. 지금 %(low)d건이 검색 요약 단계입니다.
  <strong>대외 문서에 인용하기 전에는 반드시 원문을 확인하세요.</strong>
</div>

%(body)s

<footer>
  <p>이 표는 <code>news/타사교육과정.csv</code> 에서 자동 생성됩니다. HTML을 직접 고치지 마세요 — 다시 만들면 덮어써집니다.</p>
  <p>다시 만들기: <code>python3 news/build_table.py</code> · 채팅용 표: <code>python3 news/build_table.py --md</code></p>
</footer>
</div>
</body>
</html>
"""


if __name__ == '__main__':
    rows = load()
    if '--md' in sys.argv:
        print(to_markdown(rows))
    else:
        with io.open(HTML_PATH, 'w', encoding='utf-8') as f:
            f.write(to_html(rows))
        print('%s 생성 (%d건)' % (HTML_PATH, len(rows)))
