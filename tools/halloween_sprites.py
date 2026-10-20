import math, urllib.parse
PAL = {
 'o':'#ff8a1f','O':'#c9540a','y':'#ffd23f','Y':'#ffb21f','g':'#6cc04a','G':'#3e8a2a','k':'#14081f',
 'p':'#9b5de5','P':'#6a37b8','w':'#f6efff','s':'#cdbdf0','b':'#2b1647','r':'#ff4a4a','n':'#8a5a2b',
}
SPR = {}
def grid(w, h): return [['.'] * w for _ in range(h)]
def tostr(g): return [''.join(r) for r in g]

def make_pumpkin():
    W, H = 18, 16; g = grid(W, H)
    cx, cy = (W - 1) / 2, 9.0
    for y in range(3, H):
        for x in range(W):
            dx, dy = (x - cx) / 8.6, (y - cy) / 6.6
            if dx * dx + dy * dy <= 1.0: g[y][x] = 'o'
    for y in range(3, H):
        for x in (4, 8, 9, 13):
            if g[y][x] == 'o': g[y][x] = 'O'
    for y in range(3, H):
        for x in range(W):
            if g[y][x] == 'o' and (y >= H - 2 or x <= 1 or x >= W - 2): g[y][x] = 'O'
    for (x, y) in [(8, 0), (9, 0), (8, 1), (9, 1), (7, 1), (8, 2), (9, 2), (10, 2), (7, 2)]: g[y][x] = 'g'
    g[0][9] = 'G'; g[1][9] = 'G'; g[2][10] = 'G'
    L=[(5,5),(4,6),(5,6),(6,6),(3,7),(4,7),(5,7),(6,7),(7,7)]
    for (x, y) in L: g[y][x] = 'y'; g[y][W-1-x] = 'y'
    g[9][8] = 'y'; g[9][9] = 'y'; g[8][8]='y'; g[8][9]='y'
    for x in range(3, 15): g[11][x] = 'y'
    for x in range(4, 14): g[12][x] = 'y'
    for x in range(6, 12): g[13][x] = 'y'
    for x in (5, 8, 9, 12): g[11][x] = 'O'
    for x in (7, 10): g[12][x] = 'O'
    return tostr(g)
SPR['pumpkin'] = make_pumpkin()

SPR['bat_a'] = """
P.............P
PP...P...P...PP
PPP.PPP.PPP.PPP
PPPPPPPPPPPPPPP
.PPPPPyPyPPPPP.
..PPPPPPPPPPP..
...PP.PPP.PP...
....P.....P....
""".strip().split('\n')
SPR['bat_b'] = """
...............
...............
.PP.P.....P.PP.
PPPPPP.P.PPPPPP
.PPPPPyPyPPPPP.
..PPPPPPPPPPP..
...PPP.P.PPP...
....P.....P....
""".strip().split('\n')
SPR['ghost'] = """
...wwwww...
..wwwwwww..
.wwwwwwwww.
wwwkkwwkkww
wwwkkwwkkww
wwwwwwwwwww
wwwwwkkwwww
wwwwwkkwwww
wwwwwwwwwww
wwwwwwwwwww
wwwwwwwwwww
ww.www.www.
""".strip().split('\n')
SPR['spider'] = """
s.........s
.s..PPP..s.
..sPPPPPs..
ssPPrPrPPss
..PPPPPPP..
.sPPPPPPPs.
s..PPPPP..s
s..s...s..s
.s.......s.
""".strip().split('\n')

def make_web(N=30):
    g = grid(N, N)
    def line(x0, y0, x1, y1):
        dx, dy = abs(x1 - x0), abs(y1 - y0); sx = 1 if x0 < x1 else -1; sy = 1 if y0 < y1 else -1; err = dx - dy
        while True:
            if 0 <= x0 < N and 0 <= y0 < N: g[y0][x0] = 's'
            if x0 == x1 and y0 == y1: break
            e2 = 2 * err
            if e2 > -dy: err -= dy; x0 += sx
            if e2 < dx: err += dx; y0 += sy
    angs = [0, 18, 36, 54, 72, 90]
    R = N - 1
    pts = lambda r, a: (round(r * math.cos(math.radians(a))), round(r * math.sin(math.radians(a))))
    for a in angs: line(0, 0, *pts(R, a))
    for r in (7, 14, 21, 28):
        for i in range(len(angs) - 1):
            x0, y0 = pts(r, angs[i]); x1, y1 = pts(r * 0.86, (angs[i] + angs[i + 1]) / 2); x2, y2 = pts(r, angs[i + 1])
            line(x0, y0, x1, y1); line(x1, y1, x2, y2)
    return tostr(g)
SPR['web'] = make_web()
SPR['candy'] = """
...w...
..www..
..yyy..
.yyyyy.
.YYYYY.
.YYYYY.
YooooY.
oooooo.
.oooo..
""".strip().split('\n')
SPR['skull'] = """
..wwwwwww..
.wwwwwwwww.
wwwwwwwwwww
wwkkwwwkkww
wwkkwwwkkww
wwwwwkwwwww
.wwwwwwwww.
..wkwkwkw..
..wkwkwkw..
...wwwww...
""".strip().split('\n')
SPR['hat'] = """
......P......
......PP.....
.....PPP.....
.....PPPP....
....PPPPP....
....PPPPPP...
...PPPPPPP...
..PPPPPPPPP..
..ooooyoooo..
.PPPPPPPPPPP.
PPPPPPPPPPPPP
""".strip().split('\n')

def rects(rows):
    out = []
    for y, row in enumerate(rows):
        x = 0
        while x < len(row):
            c = row[x]
            if c == '.': x += 1; continue
            j = x
            while j < len(row) and row[j] == c: j += 1
            out.append((x, y, j - x, c)); x = j
    return out

def _paths(frames):
    by = {}
    for i, f in enumerate(frames):
        W = max(len(r) for r in f)
        for x, y, l, c in rects(f): by.setdefault(c, []).append('M%d %dh%dv1h-%dz' % (x + i * W, y, l, l))
    return ''.join('<path fill="%s" d="%s"/>' % (PAL[c], ''.join(v)) for c, v in by.items())

def svg(rows, extra=''):
    W = max(len(r) for r in rows); H = len(rows)
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" shape-rendering="crispEdges"%s>%s</svg>' % (W, H, W, H, extra, _paths([rows]))

def svg_multi(frames):
    W = max(len(r) for f in frames for r in f); H = len(frames[0])
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" shape-rendering="crispEdges">%s</svg>' % (W * len(frames), H, W * len(frames), H, _paths(frames))

def uri(s): return "url('data:image/svg+xml," + urllib.parse.quote(s, safe="/:=;,()' ").replace('%22', "'").replace("'", '%27') + "')"

if __name__ == '__main__':
    from PIL import Image, ImageDraw
    sc = 5
    img = Image.new('RGB', (900, 320), (26, 10, 40))
    d = ImageDraw.Draw(img); x = 10
    for n in SPR:
        rows = SPR[n]
        for yy, r in enumerate(rows):
            for xx, c in enumerate(r):
                if c != '.': d.rectangle([x + xx * sc, 10 + yy * sc, x + xx * sc + sc - 1, 10 + yy * sc + sc - 1], fill=PAL[c])
        x += len(rows[0]) * sc + 14
    img = img.resize((1800, 640), Image.NEAREST); img.save('sprites-preview.png')
