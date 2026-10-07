// The tool surface, as the management window shows it to a human.
//
// Separate from tools.mjs on purpose, and not a second opinion about what exists. tools.mjs
// carries the executable definitions and its `description` strings are written FOR THE MODEL -
// long, English, full of guidance about when to prefer one tool over another. The 主界面 needs
// the opposite: one short Chinese line per tool, plus a risk column, in a table a person scans.
//
// It is also the only form the page can consume at all: tools.mjs imports bridge.mjs, which
// reaches for node:fs and node:os to read the bridge token, so pulling it into the webview
// bundle would not build. This file imports nothing.
//
// The part that matters is that it cannot drift: packages/mcp-server/test/catalogue.test.mjs
// asserts this list and `tools` name-for-name, in order. Adding a tool without describing it
// here - or leaving a row behind after removing one - fails `npm test`. That guard is the whole
// reason a second list is acceptable, because the page's previous static table is exactly what
// happens without it: six invented names (`get_perception`, `play_emote`, `write_settings`…)
// that never existed, every one of them labelled 未实现, sitting under a heading that said no
// MCP server had been written - while thirteen real tools shipped in this package.
//
// `risk` is a judgement about what the tool can do to the user, not about how it is implemented:
//   低 = cosmetic or read-only, undone by the cat's next move
//   中 = takes over the screen, or touches what the cat remembers about its owner
export const catalogue = [
  { name: 'lingxi_capabilities',  purpose: '列出猫会的全部动作、表情、主题和特效',       risk: '低' },
  { name: 'lingxi_state',         purpose: '读当前状态：位置、在做什么、心情',           risk: '低' },
  { name: 'lingxi_say',           purpose: '让猫在头顶气泡里说一句话',                   risk: '低' },
  { name: 'lingxi_express',       purpose: '设置表情',                                   risk: '低' },
  { name: 'lingxi_perform',       purpose: '播放全屏特效（会短暂占据整个屏幕）',         risk: '中' },
  { name: 'lingxi_play',          purpose: '放出或收走玩具，猫会去玩',                   risk: '低' },
  { name: 'lingxi_remember',      purpose: '写入一条关于主人的记忆（会落盘）',           risk: '中' },
  { name: 'lingxi_recall',        purpose: '读回猫记住的关于主人的事',                   risk: '中' },
  { name: 'lingxi_remind',        purpose: '让猫过一会儿提醒你一件事',                   risk: '低' },
  { name: 'lingxi_look',          purpose: '改变取景：视角与主题',                       risk: '低' },
  { name: 'lingxi_register',      purpose: '登记自己的名字、徽章和颜色',                 risk: '低' },
  { name: 'lingxi_task',          purpose: '汇报任务状态，由猫决定怎么表现',             risk: '低' },
  { name: 'lingxi_reload_assets', purpose: '重新加载用户自定义资源',                     risk: '低' },
];
