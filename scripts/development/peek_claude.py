#!/usr/bin/env python3
"""窥一眼 Claude 无头会话的最近动作。用法: python3 peek_claude.py <jsonl> [n]"""
import json
import sys

p = sys.argv[1]
k = int(sys.argv[2]) if len(sys.argv) > 2 else 12
rows = []
for line in open(p):
    try:
        rows.append(json.loads(line))
    except Exception:
        continue
print("rows", len(rows))
for d in rows[-k:]:
    t = d.get("type")
    ts = (d.get("timestamp") or "")[11:19]
    m = d.get("message", {}) or {}
    c = m.get("content")
    if isinstance(c, list):
        for x in c:
            if not isinstance(x, dict):
                continue
            if x.get("type") == "text" and x.get("text", "").strip():
                print("[%s] TXT %s" % (ts, x["text"].strip()[:400].replace("\n", " | ")))
            elif x.get("type") == "tool_use":
                s = json.dumps(x.get("input"), ensure_ascii=False)[:260]
                print("[%s] USE %s %s" % (ts, x.get("name"), s))
            elif x.get("type") == "tool_result":
                s = json.dumps(x.get("content"), ensure_ascii=False)[:260]
                print("[%s] RES %s" % (ts, s))
            elif x.get("type") == "thinking":
                print("[%s] THK %s" % (ts, (x.get("thinking") or "")[:160].replace("\n", " | ")))
    elif isinstance(c, str) and c.strip():
        print("[%s] %s TXT %s" % (ts, t, c.strip()[:300].replace("\n", " | ")))
    else:
        print("[%s] %s" % (ts, t))
