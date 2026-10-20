#!/bin/bash
# 把 lingxi-desktop-cat 打成可直接上传到 WorkBuddy 开放平台的 zip。
#
# 用法：
#   ./pack.sh          # 官方结构：{skill-name}/SKILL.md（默认）
#   ./pack.sh --flat   # 扁平结构：SKILL.md 在 zip 第一层（官方结构解析失败时用）
#
# 打包前会做四项校验：必填 frontmatter、目录层级、体积、敏感信息。
# 任一项不过就退出 1，不产出半成品。

set -u

cd "$(dirname "$0")" || exit 1

SKILL_NAME="lingxi-desktop-cat"
SKILL_DIR="$SKILL_NAME"
DIST="dist"
FLAT=0

if [ "${1:-}" = "--flat" ]; then
  FLAT=1
fi

if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  echo "✗ 找不到 $SKILL_DIR/SKILL.md" >&2
  exit 1
fi

PY=""
for candidate in python3 /usr/bin/python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "✗ 需要 python3 来做校验" >&2
  exit 1
fi

VERSION="$("$PY" - "$SKILL_DIR/SKILL.md" <<'PY'
import re, sys
head = open(sys.argv[1], encoding='utf-8').read().split('---')[1]
m = re.search(r'^version:\s*(\S+)\s*$', head, re.M)
print(m.group(1) if m else '')
PY
)"

if [ -z "$VERSION" ]; then
  echo "✗ SKILL.md frontmatter 里没有 version" >&2
  exit 1
fi

echo "— 打包前校验（${SKILL_NAME} v${VERSION}）"

fail=0

# 1. frontmatter 必填字段
"$PY" - "$SKILL_DIR/SKILL.md" <<'PY' || fail=1
import sys
path = sys.argv[1]
raw = open(path, encoding='utf-8').read()
if not raw.startswith('---'):
    print('✗ SKILL.md 不是以 --- 开头的 frontmatter')
    sys.exit(1)
parts = raw.split('---', 2)
if len(parts) < 3:
    print('✗ frontmatter 没有闭合')
    sys.exit(1)
head = parts[1]
required = ['description', 'description_zh', 'description_en', 'version', 'author']
missing = [k for k in required if not any(
    line.startswith(k + ':') for line in head.splitlines())]
if missing:
    print('✗ 缺少必填字段: ' + ', '.join(missing))
    sys.exit(1)
name = [l.split(':', 1)[1].strip() for l in head.splitlines() if l.startswith('name:')]
print('  ✓ frontmatter 必填字段齐全' + (('，name=' + name[0]) if name else ''))
PY

# 2. 目录层级（SKILL.md 在第一层，其余最多再一层）
"$PY" - "$SKILL_DIR" <<'PY' || fail=1
import os, sys
root = sys.argv[1]
bad = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in ('.git', '__pycache__')]
    for f in filenames:
        if f in ('.DS_Store',):
            continue
        rel = os.path.relpath(os.path.join(dirpath, f), root)
        depth = rel.count(os.sep) + 1  # SKILL.md = 1
        if depth > 2:
            bad.append(rel)
if bad:
    print('✗ 目录层级超过两层: ' + ', '.join(bad))
    sys.exit(1)
print('  ✓ 目录层级不超过两层')
PY

# 3. 体积（平台硬限制 3 MB）
"$PY" - "$SKILL_DIR" <<'PY' || fail=1
import os, sys
root = sys.argv[1]
total = 0
for dirpath, dirnames, filenames in os.walk(root):
    for f in filenames:
        if f == '.DS_Store':
            continue
        total += os.path.getsize(os.path.join(dirpath, f))
mb = total / 1024 / 1024
if mb > 3:
    print('✗ 未压缩体积 %.2f MB，超过平台 3 MB 限制' % mb)
    sys.exit(1)
print('  ✓ 未压缩体积 %.1f KB（上限 3 MB）' % (total / 1024))
PY

# 4. 敏感信息（密钥、私钥、cookie、本机绝对路径）
"$PY" - "$SKILL_DIR" <<'PY' || fail=1
import os, re, sys
root = sys.argv[1]
patterns = [
    (re.compile(r'sk-[A-Za-z0-9]{16,}'), '疑似 API key'),
    (re.compile(r'AKID[A-Za-z0-9]{10,}'), '疑似腾讯云 SecretId'),
    (re.compile(r'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'), '私钥'),
    (re.compile(r'(?i)(api[_-]?key|secret|password|cookie)\s*[:=]\s*["\']?[A-Za-z0-9_\-]{12,}'), '疑似凭据'),
    (re.compile(r'/Users/[a-z0-9_.-]+/'), '本机用户绝对路径'),
]
hits = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in ('.git', '__pycache__')]
    for f in filenames:
        if f == '.DS_Store':
            continue
        p = os.path.join(dirpath, f)
        try:
            text = open(p, encoding='utf-8').read()
        except (UnicodeDecodeError, OSError):
            continue
        for pat, label in patterns:
            if pat.search(text):
                hits.append('%s（%s）' % (os.path.relpath(p, root), label))
if hits:
    print('✗ 发现可疑内容: ' + '; '.join(sorted(set(hits))))
    sys.exit(1)
print('  ✓ 未发现密钥、私钥、cookie 或本机路径')
PY

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "校验未通过，未生成 zip。" >&2
  exit 1
fi

# 打包
mkdir -p "$DIST"
if [ "$FLAT" -eq 1 ]; then
  ZIP="$DIST/$SKILL_NAME-v$VERSION-flat.zip"
else
  ZIP="$DIST/$SKILL_NAME-v$VERSION.zip"
fi
rm -f "$ZIP"

# 用 python 打包：路径里不会出现 ./ 前缀，两种结构只差一层
"$PY" - "$SKILL_DIR" "$ZIP" "$FLAT" <<'PY' || exit 1
import os, sys, zipfile

root, out, flat = sys.argv[1], sys.argv[2], sys.argv[3] == '1'
arcroot = '' if flat else os.path.basename(root.rstrip('/'))

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in ('.git', '__pycache__'))
        for f in sorted(filenames):
            if f == '.DS_Store':
                continue
            p = os.path.join(dirpath, f)
            rel = os.path.relpath(p, root)
            arc = rel if not arcroot else os.path.join(arcroot, rel)
            z.write(p, arc)
PY

if [ "$FLAT" -eq 1 ]; then
  echo "  · 结构：扁平（SKILL.md 在 zip 第一层）"
else
  echo "  · 结构：官方（$SKILL_NAME/SKILL.md）"
fi

SIZE="$(wc -c < "$ZIP" | tr -d ' ')"
echo ""
echo "— 产出"
echo "  $ZIP"
echo "  $(printf '%s' "$SIZE" | awk '{printf "%.1f KB", $1/1024}')"
echo ""
echo "  包内文件："
unzip -Z1 "$ZIP" | sed 's/^/    /'
echo ""
if [ "$FLAT" -eq 1 ]; then
  echo "  这是备选结构：官方结构解析失败时再传这个。"
else
  echo "  这是首选结构：先传这个。解析失败再跑 ./pack.sh --flat 换扁平版。"
fi
echo "  下一步：把 zip 连同 avatar-512.jpg 上传到 https://open.workbuddy.cn/ 的「发布管理 → 技能」"
