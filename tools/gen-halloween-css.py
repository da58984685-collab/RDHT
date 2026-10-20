#!/usr/bin/env python3
"""[THEME:HALLOWEEN] halloween.css 를 만듭니다. (원본 index.html 은 건드리지 않습니다.)
  1) index.html 의 CSS 에서 '붉은 계열 색'만 찾아 주황(밝은 색)·보라(어두운 색)로 바꾼 규칙을 모으고
  2) 픽셀아트(tools/halloween_sprites.py)와 장식 규칙(tools/halloween_decor.css)을 붙입니다.
사용: python3 tools/gen-halloween-css.py   → 프로젝트 맨 위에 halloween.css 가 만들어집니다.
"""
import importlib.util
import re, colorsys, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
css = src[src.index('<style>') + 7: src.index('</style>')]

def clamp(x): return max(0.0, min(1.0, x))
def is_red(h): return h >= 340 or h <= 22
def map_rgb(r, g, b):
    """r,g,b: 0~255 → 바뀐 (r,g,b) 또는 None(바꾸지 않음)"""
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    hd = h * 360
    if not is_red(hd) or l > 0.97 or l < 0.015: return None
    if l < 0.33:                                   # 어두운 붉은색 → 보라
        if s < 0.10: return None
        nh, ns, nl = 268, clamp(s * 1.25) if s > .2 else s * 1.8, clamp(l * 1.08)
    else:                                          # 밝은 붉은색 → 주황
        if s < 0.22: return None
        nh = 27 if l < 0.7 else (31 if l < 0.88 else 34)
        ns, nl = clamp(s * (1.0 if l < .7 else .95)), clamp(l + (0.04 if l < .6 else 0))
    nr, ng, nb = colorsys.hls_to_rgb(nh / 360, nl, ns)
    return round(nr * 255), round(ng * 255), round(nb * 255)

HEX = re.compile(r'#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])')
RGBA = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)')
def conv_value(v):
    def hx(m):
        t = m.group(1)
        if len(t) in (3, 4): t = ''.join(c * 2 for c in t)
        r, g, b = int(t[0:2], 16), int(t[2:4], 16), int(t[4:6], 16)
        n = map_rgb(r, g, b)
        if not n: return m.group(0)
        return '#%02x%02x%02x%s' % (n + (t[6:8],))
    def rg(m):
        r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
        n = map_rgb(r, g, b)
        if not n: return m.group(0)
        a = m.group(4)
        return ('rgba(%d,%d,%d,%s)' % (n + (a,))) if a is not None else ('rgb(%d,%d,%d)' % n)
    return RGBA.sub(rg, HEX.sub(hx, v))

def split_top(s, sep):
    out, depth, cur, q = [], 0, '', None
    for ch in s:
        if q:
            cur += ch
            if ch == q: q = None
            continue
        if ch in '"\'': q = ch; cur += ch; continue
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == sep and depth == 0: out.append(cur); cur = ''
        else: cur += ch
    if cur.strip(): out.append(cur)
    return out

def parse_blocks(s):
    """최상위 {} 블록들을 (머리글, 내용) 으로 나눕니다."""
    i, n, res = 0, len(s), []
    while i < n:
        j = s.find('{', i)
        if j < 0: break
        head = s[i:j].strip()
        d, k = 1, j + 1
        while k < n and d:
            if s[k] == '{': d += 1
            elif s[k] == '}': d -= 1
            k += 1
        res.append((head, s[j + 1:k - 1]))
        i = k
    return res

def conv_rule(head, body):
    keep, decls = [], []
    for d in split_top(body, ';'):
        if ':' not in d: continue
        p, v = d.split(':', 1)
        decls.append((p.strip(), v.strip()))
        nv = conv_value(v)
        if nv != v: keep.append(p.strip() + ':' + nv.strip())
    # 'background' 줄임 표기를 다시 쓰면 background-clip 등 따로 적힌 값이 지워지므로, 같은 규칙의 background-* 도 다시 적어 줍니다.
    if any(k.split(':')[0] == 'background' for k in keep):
        done = set(k.split(':')[0] for k in keep)
        keep += [p + ':' + v for p, v in decls if (p.startswith('background-') or p.startswith('-webkit-background-')) and p not in done]
    return (head + '{' + ';'.join(keep) + '}') if keep else ''

def conv_block(head, body):
    if head.startswith('@keyframes') or head.startswith('@-webkit-keyframes'):
        inner = parse_blocks(body)
        new = ''.join(h + '{' + ';'.join(x.strip() for x in split_top(b, ';') if x.strip()).replace('\n', '') + '}' for h, b in inner)
        conv = conv_value(new)
        return (head + '{' + conv + '}') if conv != new else ''
    if head.startswith('@media') or head.startswith('@supports'):
        inner = ''.join(conv_block(h, b) for h, b in parse_blocks(body))
        return (head + '{' + inner + '}') if inner else ''
    if head.startswith('@'): return ''
    return conv_rule(head, body)

out = []
for h, b in parse_blocks(re.sub(r'/\*.*?\*/', '', css, flags=re.S)):
    r = conv_block(h, b)
    if r: out.append(r)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import halloween_sprites as S
decor = open(os.path.join(ROOT, 'tools', 'halloween_decor.css'), encoding='utf-8').read()
vals = {
  'PUMPKIN': S.uri(S.svg(S.SPR['pumpkin'])), 'GHOST': S.uri(S.svg(S.SPR['ghost'])), 'SPIDER': S.uri(S.svg(S.SPR['spider'])),
  'WEB': S.uri(S.svg(S.SPR['web'])), 'CANDY': S.uri(S.svg(S.SPR['candy'])), 'SKULL': S.uri(S.svg(S.SPR['skull'])), 'HAT': S.uri(S.svg(S.SPR['hat'])),
  'BATS': S.uri(S.svg_multi([S.SPR['bat_a'], S.SPR['bat_b']])),
}
for k in vals: decor = decor.replace('{{' + k + '}}', 'var(--hw-' + k.lower() + ')')
decor = ':root{' + ';'.join('--hw-' + k.lower() + ':' + v for k, v in vals.items()) + '}\n' + decor
text = ('/* [THEME:HALLOWEEN] 할로윈 테마 — 자동 생성 파일 (tools/gen-halloween-css.py). 이 파일은 halloween.js 가 이벤트 중에만 불러옵니다. */\n'
        '/* ── 1부: index.html 의 붉은색 → 주황·보라 ── */\n' + '\n'.join(out) + '\n/* ── 2부: 장식 ── */\n' + decor)
open(os.path.join(ROOT, 'halloween.css'), 'w', encoding='utf-8').write(text)
print('rules', len(out), 'bytes', len(text.encode()))
