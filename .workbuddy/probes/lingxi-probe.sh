#!/bin/bash
# 灵犀 HTTP 桥边界测试。只读 + 可恢复，不改任何持久化数据以外的东西。
B=http://127.0.0.1:47811
# Loopback only - never via a proxy, which curl would otherwise do whenever http_proxy is
# exported. See the same note in integrations/cli/lingxi.
NOPROXY=(--noproxy '*')
probe() {  # probe <标签> <方法> <路径> <body>
  local label="$1" method="$2" path="$3" body="${4:-}"
  local out code
  if [ -n "$body" ]; then
    out=$(curl -s "${NOPROXY[@]}" --max-time 4 -o /tmp/_p.json -w '%{http_code}' -X "$method" "$B$path" -H 'Content-Type: application/json' -d "$body")
  else
    out=$(curl -s "${NOPROXY[@]}" --max-time 4 -o /tmp/_p.json -w '%{http_code}' -X "$method" "$B$path")
  fi
  code="$out"
  printf '%-34s %-4s %s\n' "$label" "$code" "$(head -c 190 /tmp/_p.json | tr -d '\n')"
}

echo "=========== A. /control 输入校验 ==========="
probe "A1 空对象 {}"            POST /control '{}'
probe "A2 非法 JSON"            POST /control '{not json'
probe "A3 未知字段"             POST /control '{"nonsense":1}'
probe "A4 空 say"               POST /control '{"say":"   "}'
probe "A5 say 200 字"           POST /control "{\"say\":\"$(python3 -c 'print("啊"*200)')\"}"
probe "A6 holdMs 负数"          POST /control '{"expression":"开心","holdMs":-99999}'
probe "A7 holdMs 字符串"        POST /control '{"expression":"开心","holdMs":"abc"}'
probe "A8 holdMs 极大"          POST /control '{"expression":"开心","holdMs":99999999}'
probe "A9 scale 非法"           POST /control '{"scale":0.77}'
probe "A10 scale 字符串"        POST /control '{"scale":"big"}'
probe "A11 visible 非布尔"      POST /control '{"visible":"yes"}'
probe "A12 action 空串"         POST /control '{"action":""}'
probe "A13 expression null"     POST /control '{"expression":null}'
probe "A14 非对象(数组)"        POST /control '[1,2,3]'

echo ""
echo "=========== B. /memory 与 /reminders ==========="
probe "B1 memory 空 text"       POST /memory '{"text":"  "}'
probe "B2 memory 缺 text"       POST /memory '{"kind":"owner"}'
probe "B3 memory 非法 kind"     POST /memory '{"text":"测试非法kind","kind":"hack"}'
probe "B4 memory 2000 字"       POST /memory "{\"text\":\"$(python3 -c 'print("测"*2000)')\"}"
probe "B5 remind 缺时间"        POST /reminders '{"text":"没给时间"}'
probe "B6 remind 缺 text"       POST /reminders '{"inMinutes":5}'
probe "B7 remind 负数分钟"      POST /reminders '{"text":"过去的提醒","inMinutes":-30}'
probe "B8 remind 200 字"        POST /reminders "{\"text\":\"$(python3 -c 'print("提"*200)')\",\"inMinutes\":5}"
probe "B9 remind 两者都给"      POST /reminders '{"text":"两个都给","inMinutes":5,"dueAt":99999999999999}'
probe "B10 remind dueAt 字符串" POST /reminders '{"text":"字符串时间","dueAt":"later"}'

echo ""
echo "=========== C. 路由与其他 ==========="
probe "C1 未知路径"             GET  /nope
probe "C2 根路径"               GET  /
probe "C3 /intent 空对象"       POST /intent '{}'
probe "C4 /task-event 非JSON"   POST /task-event 'garbage'
probe "C5 /task-event 空对象"   POST /task-event '{}'
