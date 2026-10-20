"""Write `review.html` into a round directory: its renders next to another round's, plus the numbers.

The published B4 page showed round-b4b two code rounds after the code had moved on, and the user
read it as "nothing changed since yesterday". This page is generated from the round directory
itself - whatever is in `views/`, `poses/`, `faces/`, `knobs.txt`, `review-parts.json` and
`review-clips.json` - so it can only show what that round's code rendered. Image paths are
relative, so the page works opened straight from the folder (and from a copy of the v6 tree).

  python3 v6_round_page.py ROUND_DIR [--vs OTHER_ROUND_DIR] [--title TEXT] [--note TEXT]

Standard library only: it runs under any python3, no Blender needed.
"""
import argparse
import html
import json
import os
from pathlib import Path

VIEWS = ['front', 'side', 'threequarter', 'back', 'face', 'face34', 'paws']
CLIPS = ['Idle', 'Walk', 'Run', 'Jump', 'LieDown', 'SideLie', 'Sleep', 'Curious', 'Happy',
         'Yawn', 'Lick', 'Bite', 'Knead', 'Stretch', 'PawPlay']
FACES = ['idle', 'blink', 'happy', 'yawn']
FACE_LABEL = {'idle': 'Idle 睁眼 (f1)', 'blink': 'Idle 眨眼 (f47)', 'happy': 'Happy 闭眼 (f441)',
              'yawn': 'Yawn 峰值 (f495)'}

CSS = """
:root{--bg:#111215;--panel:#1a1b20;--line:#2d2e36;--text:#e9e7e4;--dim:#9b98a2;--accent:#e0a458;--good:#7fb069;--bad:#d0605e}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:15px/1.65 -apple-system,"PingFang SC","Helvetica Neue",sans-serif;padding:0 0 60px}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px}
h1{font-size:24px;margin:28px 0 4px}h2{font-size:19px;margin:34px 0 8px}h3{font-size:15px;margin:18px 0 6px;color:var(--accent)}
.sub,.note{color:var(--dim);font-size:13.5px}
code,pre{font:12.5px/1.5 ui-monospace,Menlo,monospace;background:var(--panel);border:1px solid var(--line);border-radius:6px}
code{padding:1px 5px}pre{padding:10px 12px;overflow-x:auto;white-space:pre-wrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px}
.pair figure,.one figure{margin:0}.pair img,.one img{width:100%;display:block;border-radius:4px;background:#000}
figcaption{font-size:12px;color:var(--dim);text-align:center;padding:2px 0}
.cell .t{font-size:13px;font-weight:600;margin:0 0 4px 2px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0}
th,td{border-bottom:1px solid var(--line);padding:5px 7px;text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}th{color:var(--dim);font-weight:500}
.tbl{overflow-x:auto}.bad{color:var(--bad)}.good{color:var(--good)}
@media (max-width:700px){.grid{grid-template-columns:1fr}.wrap{padding:0 12px}h1{font-size:20px}}
"""


def load(p):
    try:
        return json.loads(Path(p).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def rel(target, base):
    return os.path.relpath(target, base).replace(os.sep, '/')


def figure(src, cap):
    if src is None:
        return f'<figure><figcaption>{html.escape(cap)}：无</figcaption></figure>'
    return (f'<figure><a href="{html.escape(src)}"><img loading="lazy" src="{html.escape(src)}" '
            f'alt="{html.escape(cap)}"></a><figcaption>{html.escape(cap)}</figcaption></figure>')


def pair(title, here, there, here_name, there_name):
    inner = figure(here, here_name) + (figure(there, there_name) if there_name else '')
    cls = 'pair' if there_name else 'one'
    return f'<div class="cell"><div class="t">{html.escape(title)}</div><div class="{cls}">{inner}</div></div>'


def img_or_none(d, *parts):
    p = Path(d, *parts)
    return p if p.exists() else None


def num(v, nd=1):
    return '–' if v is None else (f'{v:.{nd}f}' if isinstance(v, (int, float)) else html.escape(str(v)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('round')
    ap.add_argument('--vs')
    ap.add_argument('--title')
    ap.add_argument('--note', default='')
    # the comparison round re-measured with today's rulers (its own json predates new fields)
    ap.add_argument('--vs-parts')
    ap.add_argument('--vs-clips')
    a = ap.parse_args()
    rd = Path(a.round).resolve()
    vs = Path(a.vs).resolve() if a.vs else None
    me, other = rd.name, (vs.name if vs else None)

    def src(d, *parts):
        p = img_or_none(d, *parts) if d else None
        return rel(p, rd) if p else None

    out = [f'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
           f'<meta name="viewport" content="width=device-width,initial-scale=1">'
           f'<title>{html.escape(a.title or me)}</title><style>{CSS}</style></head><body><div class="wrap">']
    out.append(f'<h1>{html.escape(a.title or me)}</h1>')
    out.append(f'<p class="sub">本页由 <code>scripts/lookdev-v6/v6_round_page.py</code> 从 <code>{me}/</code> 生成；'
               f'左＝<b>{me}</b>' + (f'，右＝<b>{other}</b>（对照）' if other else '') + '。点图看原图。</p>')
    if a.note:
        out.append(f'<p class="note">{html.escape(a.note)}</p>')
    knobs = Path(rd, 'knobs.txt')
    if knobs.exists():
        out.append('<h3>构建 / 渲染旋钮（knobs.txt）</h3><pre>' + html.escape(knobs.read_text(encoding='utf-8')) + '</pre>')

    faces = [f for f in FACES if img_or_none(rd, 'faces', f + '.png')]
    if faces:
        out.append('<h2>闭眼近景</h2><div class="grid">')
        for f in faces:
            out.append(pair(FACE_LABEL[f], src(rd, 'faces', f + '.png'),
                            src(vs, 'faces', f + '.png') if vs else None, me, other))
        out.append('</div>')

    views = [v for v in VIEWS if img_or_none(rd, 'views', v + '.png')]
    if views:
        out.append('<h2>视图</h2><div class="grid">')
        for v in views:
            out.append(pair(v, src(rd, 'views', v + '.png'), src(vs, 'views', v + '.png') if vs else None, me, other))
        out.append('</div>')

    clips = [c for c in CLIPS if img_or_none(rd, 'poses', c + '.png')]
    if clips:
        out.append('<h2>15 个动作（渲染器自动选的最有表现力的一帧）</h2><div class="grid">')
        for c in clips:
            out.append(pair(c, src(rd, 'poses', c + '.png'), src(vs, 'poses', c + '.png') if vs else None, me, other))
        out.append('</div>')

    # --- numbers ---
    parts = load(Path(rd, 'review-parts.json'))
    vparts = load(Path(a.vs_parts)) if a.vs_parts else (load(Path(vs, 'review-parts.json')) if vs else None)
    if parts:
        out.append('<h2>部件实测（v6_part_audit.py）</h2>')
        out.append('<h3>爪：每个趾露出体表的顶点比例 / 最大探出</h3><div class="tbl"><table><tr><th>爪</th>'
                   f'<th>{me} 露出 %</th><th>{me} 探出 mm</th>'
                   + (f'<th>{other} 露出 %</th><th>{other} 探出 mm</th>' if vparts else '') + '</tr>')
        for k, v in parts.get('paws', {}).items():
            t = v.get('toes') or {}
            row = [', '.join(num(x['outside_vertex_pct'], 0) for x in t.values()),
                   ', '.join(num(x['max_proud_mm'], 0) for x in t.values())]
            if vparts:
                tv = (vparts.get('paws', {}).get(k) or {}).get('toes') or {}
                row += [', '.join(num(x['outside_vertex_pct'], 0) for x in tv.values()),
                        ', '.join(num(x['max_proud_mm'], 0) for x in tv.values())]
            out.append(f'<tr><td>{k}</td>' + ''.join(f'<td>{c}</td>' for c in row) + '</tr>')
        out.append('</table></div>')
        tc = parts.get('toe_clefts')
        if tc:
            vtc = (vparts or {}).get('toe_clefts') or {}
            out.append('<h3>趾缝深度 mm（每爪三条，正＝两侧趾冠之后的沟；负＝没有沟，只是往后退的台阶）</h3>'
                       '<p class="note">' + html.escape(str(tc.get('target', ''))) + '</p>'
                       f'<div class="tbl"><table><tr><th>爪</th><th>{me}</th>' + (f'<th>{other}</th>' if vtc else '') + '</tr>')
            for k in ('Front.L', 'Front.R', 'Rear.L', 'Rear.R'):
                v, w = tc.get(k) or {}, vtc.get(k) or {}
                out.append(f'<tr><td>{k}</td><td>{v.get("cleft_depth_sym_mm")}</td>'
                           + (f'<td>{w.get("cleft_depth_sym_mm")}</td>' if vtc else '') + '</tr>')
            out.append('</table></div>')
        pc = parts.get('paw_coat')
        if pc:
            vpc = (vparts or {}).get('paw_coat') or {}
            keys = ['toe_coat_mm', 'paw_back_coat_mm', 'leg_low_coat_mm', 'leg_mid_coat_mm', 'leg_top_coat_mm']
            out.append('<h3>爪与腿的毛长（中位数 mm）</h3><div class="tbl"><table><tr><th></th>'
                       + ''.join(f'<th>{k}</th>' for k in keys) + '<th>躯干</th></tr>')
            for nm, d in ((me, pc), (other, vpc)):
                if not d:
                    continue
                for leg in ('Front.L', 'Rear.L'):
                    row = d.get(leg) or {}
                    out.append(f'<tr><td>{nm} {leg}</td>' + ''.join(f'<td>{num(row.get(k))}</td>' for k in keys)
                               + f'<td>{num(d.get("torso_coat_mm"))}</td></tr>')
            out.append('</table></div>')
        ear = parts.get('ears', {}).get('L')
        if ear:
            vear = (vparts or {}).get('ears', {}).get('L') if vparts else None
            out.append('<h3>耳（左）</h3><div class="tbl"><table><tr><th></th><th>高 mm</th><th>宽 mm</th><th>w/h</th></tr>'
                       f'<tr><td>{me}</td><td>{num(ear["height_mm"])}</td><td>{num(ear["base_width_mm"])}</td><td>{num(ear["wh_ratio"], 3)}</td></tr>'
                       + (f'<tr><td>{other}</td><td>{num(vear["height_mm"])}</td><td>{num(vear["base_width_mm"])}</td><td>{num(vear["wh_ratio"], 3)}</td></tr>' if vear else '')
                       + '<tr><td>目标（代码注释）</td><td>135</td><td>112</td><td>0.83</td></tr></table></div>')
        mo = parts.get('mouth')
        if mo:
            vmo = (vparts or {}).get('mouth') if vparts else None
            keys = ['nose_w_over_E', 'mouth_w_over_E', 'lip_below_nose_over_E', 'lip_below_nose_mm']
            out.append('<h3>口鼻（以瞳距 E 归一）</h3><div class="tbl"><table><tr><th></th>'
                       + ''.join(f'<th>{k}</th>' for k in keys) + '</tr>'
                       f'<tr><td>{me}</td>' + ''.join(f'<td>{num(mo.get(k), 3)}</td>' for k in keys) + '</tr>'
                       + (f'<tr><td>{other}</td>' + ''.join(f'<td>{num(vmo.get(k), 3)}</td>' for k in keys) + '</tr>' if vmo else '')
                       + '</table></div>')
        lids = parts.get('lids')
        if lids:
            vlids = (vparts or {}).get('lids') if vparts else None
            out.append('<h3>闭眼（Happy 中帧对 Idle 第 1 帧）</h3><p class="note">' + html.escape(lids.get('how', '')) + '</p>')
            rows = [('眼角位移 mm（最大）', 'corner_shift_mm', 'target_corner'),
                    ('睑缘带拉伸比（深色睑缘）', 'margin_stretch', 'target_margin'),
                    ('整条睑带拉伸比（内缘→外缘）', 'band_stretch', 'target_band'),
                    ('上下睑交叉量 mm（下睑跑到上睑前面）', 'crossing_mm', 'target_crossing'),
                    ('闭合线：中点高于眼心 mm', 'closure_centre_mm', 'target_closure'),
                    ('闭合线：两眼角高于眼心 mm', 'closure_corners_mm', None),
                    ('闭合线是拱形（从眼角单调升到中点）', 'closure_is_arch', None),
                    ('闭眼时露出眼球的射线比例', 'eye_visible_pct', 'target_visible')]
            out.append('<div class="tbl"><table><tr><th></th><th>' + me + '</th>' + (f'<th>{other}</th>' if vlids else '')
                       + '<th>目标</th></tr>')
            for label, k, tk in rows:
                out.append(f'<tr><td>{label}</td><td>{num(lids.get(k), 2)}</td>'
                           + (f'<td>{num(vlids.get(k), 2)}</td>' if vlids else '')
                           + f'<td>{html.escape(str(lids.get(tk, "")) if tk else "")}</td></tr>')
            out.append('</table></div>')

    rc = load(Path(rd, 'review-clips.json'))
    vrc = None
    if vs:
        vrc = (load(Path(a.vs_clips)) if a.vs_clips else None) or load(Path(vs, 'review-clips.json')) or load(Path(vs, 'review-clips-fix.json'))
    if rc:
        vmap = {r['name']: r for r in (vrc or [])}
        out.append('<h2>动作实测（v6_clip_review.py）</h2><p class="note">最低点＝真实顶点（不含毛）离地 mm，负数＝穿地；'
                   '爪行程＝该动作里任一只爪的最大位移；离 Idle 距离＝全部骨骼转角的欧氏距离（度）。</p>'
                   '<div class="tbl"><table><tr><th>动作</th>'
                   f'<th>最低点 {me}</th>' + (f'<th>最低点 {other}</th>' if vrc else '') +
                   '<th>最低的部件</th>'
                   f'<th>爪行程 {me}</th>' + (f'<th>爪行程 {other}</th>' if vrc else '') +
                   f'<th>离 Idle {me}</th>' + (f'<th>离 Idle {other}</th>' if vrc else '') + '</tr>')

        def travel(r):
            t = r.get('paw_travel_mm')
            return max(t.values()) if isinstance(t, dict) and t else t

        for r in rc:
            o = vmap.get(r['name'], {})
            lo = r.get('lowest_mm')
            cls = ' class="bad"' if isinstance(lo, (int, float)) and lo < -3 else ''
            parts_s = ', '.join(k.replace('LX_', '') for k in list((r.get('lowest_parts') or {}))[:2])
            out.append(f'<tr><td>{r["name"]}</td><td{cls}>{num(lo)}</td>' + (f'<td>{num(o.get("lowest_mm"))}</td>' if vrc else '')
                       + f'<td>{html.escape(parts_s)}</td><td>{num(travel(r))}</td>' + (f'<td>{num(travel(o) if o else None)}</td>' if vrc else '')
                       + f'<td>{num(r.get("distance_to_idle"))}</td>' + (f'<td>{num(o.get("distance_to_idle"))}</td>' if vrc else '') + '</tr>')
        out.append('</table></div>')
        if any('posture' in r for r in rc):
            out.append('<h3>体态与步态（代表帧；毛面＝护毛每 10 mm 一格的 97 分位）</h3><p class="note">'
                       '头露出＝头顶（不含耳）比身体最高点高多少；镜头＝动作渲染那台 15° 俯视正交相机看到的同一量。'
                       '抬爪＝爪尖竖直行程（前 / 后），步幅＝爪尖前后行程，着地速度差＝四只着地爪往后滑的速度之差（0＝不打滑）。</p>'
                       '<div class="tbl"><table><tr><th>动作</th>'
                       + ''.join(f'<th>{h} {n}</th>' for h in ('头露出 毛面', '头露出 镜头', '抬爪 前/后', '步幅 前/后', '着地速度差')
                                 for n in ([me, other] if vrc else [me])) + '</tr>')

            def cells(r):
                p_, t, st = r.get('posture') or {}, r.get('paw_travel_mm') or {}, r.get('paw_stride_mm') or {}
                fb = lambda d: (f'{num(max(d.get("FrontPaw.L", 0), d.get("FrontPaw.R", 0)), 0)} / '
                                f'{num(max(d.get("RearPaw.L", 0), d.get("RearPaw.R", 0)), 0)}') if d else '—'
                return [num(p_.get('head_clear_coat_mm')), num(p_.get('head_clear_cam_mm')), fb(t), fb(st),
                        num(r.get('stance_speed_spread_mm_per_frame'), 2)]
            for r in rc:
                if r['name'] not in ('Idle', 'Walk', 'Run', 'Happy', 'Curious', 'Knead', 'PawPlay', 'Bite'):
                    continue
                a_, b_ = cells(r), cells(vmap.get(r['name'], {})) if vrc else None
                row = [x for pair_ in zip(a_, b_) for x in pair_] if b_ else a_
                out.append(f'<tr><td>{r["name"]}</td>' + ''.join(f'<td>{c}</td>' for c in row) + '</tr>')
            out.append('</table></div>')
    out.append('</div></body></html>')
    Path(rd, 'review.html').write_text('\n'.join(out), encoding='utf-8')
    print('wrote', Path(rd, 'review.html'))


if __name__ == '__main__':
    main()
