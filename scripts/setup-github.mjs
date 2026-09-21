/** Idempotently configure Lingxi's roadmap and capture read-back evidence using gh. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const repo = process.argv[2] ?? 'dushaobindoudou/lingxi';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Expected owner/repo');
function api(path, body) {
 const args=['api',path]; if(body)args.push('--method','POST','--input','-');
 const raw=execFileSync('gh',args,{input:body?JSON.stringify(body):undefined,encoding:'utf8'});
 return raw.trim()?JSON.parse(raw):null;
}
const milestones=[
 ['P0 · 角色与实时桌面验证','校正主猫参考，制作可变形角色，验证真实3D透明桌面与性能，不以预渲染替代目标。'],
 ['M1 · 安静陪伴','生活行为、动作过渡、抚摸、位置与设置恢复、一周体验验证。'],
 ['M2 · Agent 观察与个性化','正式换肤与性格、Codex/Claude/DSH只读任务观察与克制提醒。'],
];
const existingMilestones=api(`repos/${repo}/milestones?state=all&per_page=100`);
const ids=new Map(existingMilestones.map(m=>[m.title,m.number]));
for(const [title,description] of milestones)if(!ids.has(title))ids.set(title,api(`repos/${repo}/milestones`,{title,description}).number);
const tasks=[
 ['校正灵犀角色视图并完成可变形母版',0,'以原始概念板主猫为唯一身份基准，校正多视图姿态/比例/花纹，制作四足拓扑、眼睑与基础骨骼。\n\n验收：正侧背比例对齐；趴/抬头无破面；原图对照保持灰棕虎斑与白爪；交付可编辑 .blend。'],
 ['验证运行时毛发与真实3D桌面透明窗口',0,'执行 ADR 001，使用真实网格与骨骼，不用图片平面替代。\n\n验收：目标机256/384/512px、眼睛与毛发对照、连续呼吸注视；透明区穿透、不抢焦点、拖动退出可用；附CPU/GPU/内存与能耗口径。'],
 ['完成六片段生活闭环与安静陪伴验证',1,'完成趴着、入睡、睡眠、醒来、注视、抚摸及入口出口衔接。\n\n验收：无跳姿态、连续输入不排队、离线可运行、睡眠恢复正常，完成一周目标用户试用并记录关闭原因。'],
 ['接入生产皮肤与可切换性格',2,'在现有独立契约上实现受约束资产加载、rig版本检查、原子换肤与性格平滑过渡。\n\n验收：至少两套真实皮肤和两种性格可任意组合；失败保留旧皮肤；拒绝路径越界与可执行脚本；不重置关系记忆。'],
 ['实现 Codex、Claude、DSH 只读任务观察适配器',2,'按 docs/09-extension-architecture.md 接入真实平台，DSH 优先复用 dsh-acp 的只读方法。\n\n验收：快照/增量/重连去重、新鲜度、来源隔离；真实平台端到端证据；不批准或执行任务；Stop不冒充长期目标完成；不采集任务正文。'],
 ['完善图标尺寸、菜单栏符号与设计系统应用',0,'沿用用户纠正后的灰棕虎斑暖白主猫，细化当前v2图标；实现暖白燕麦设计系统。\n\n验收：16/32/128/512px实际预览、菜单栏单色符号、图标平台格式、控件焦点/对比/减少动态；用户视觉反馈闭环。'],
];
const existingIssues=api(`repos/${repo}/issues?state=all&per_page=100`);
for(const [title,index,body]of tasks)if(!existingIssues.some(i=>i.title===title))api(`repos/${repo}/issues`,{title,body,milestone:ids.get(milestones[index][0]),labels:['enhancement']});
const settings=api(`repos/${repo}`);
let protection;
try {protection=api(`repos/${repo}/branches/main/protection`);}catch(error) {if(!String(error.stderr).includes('HTTP 403'))throw error;protection={enabled:false,reason:'GitHub returned HTTP 403: private repository branch protection requires GitHub Pro or public visibility. Repository remains private.'};}
const report={checkedAt:new Date().toISOString(),repository:{url:settings.html_url,visibility:settings.visibility,defaultBranch:settings.default_branch,issues:settings.has_issues,wiki:settings.has_wiki,squashMerge:settings.allow_squash_merge,mergeCommit:settings.allow_merge_commit,rebaseMerge:settings.allow_rebase_merge,deleteBranchOnMerge:settings.delete_branch_on_merge,topics:settings.topics},branchProtection:protection,dependencySecurity:{vulnerabilityAlertsEnabled:api(`repos/${repo}/vulnerability-alerts`)===null,automatedFixes:api(`repos/${repo}/automated-security-fixes`)},milestones:api(`repos/${repo}/milestones?state=all&per_page=100`).map(m=>({title:m.title,url:m.html_url})),issues:api(`repos/${repo}/issues?state=all&per_page=100`).filter(i=>!i.pull_request).map(i=>({number:i.number,title:i.title,url:i.html_url})),runs:api(`repos/${repo}/actions/runs?per_page=5`).workflow_runs.map(r=>({id:r.id,sha:r.head_sha,status:r.status,conclusion:r.conclusion,url:r.html_url}))};
writeFileSync('docs/evidence/github-settings.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
