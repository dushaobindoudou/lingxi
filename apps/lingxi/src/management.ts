// Management window ("主界面"): the tray's primary entry point. Talks to the same
// Rust-side state (TrayState in src-tauri/src/lib.rs) as the tray menu, via commands +
// events, so changing something here updates the tray's checkmarks and vice versa.
// docs/18-main-interface-design.md (v2) is the IA this file implements: 5 sidebar pages + a
// global top bar. Every control is wired to something real EXCEPT where the markup itself
// says otherwise (badges like "未实现"/"即将生效") - that ◐/⬜ honesty is deliberate, not
// left over from a TODO.
import './management.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TaskStore } from '../../../packages/contracts/src/index.mjs';
// The renderer owns the viewing-angle catalogue and skins.json owns the theme catalogue;
// importing both here rather than re-listing them keeps this window from drifting out of sync
// with what the companion window can actually render.
import { CAMERA_PRESETS } from './rig/cameras.ts';
import skinCatalogue from './data/skins.json';
import actionCatalogue from './data/actions.json';
import { BUILT_IN_EXPRESSIONS } from './rig/art.ts';
import { ASSETS_README } from './rig/custom-assets.ts';
import homeSceneUrl from '../../../assets/tray-menu/v1/window-desk-scene.png';
import homeCatUrl from '../../../assets/tray-menu/v1/lingxi-resting-cat.png';
// The MCP tool table is rendered from the server package's own catalogue rather than typed into
// management.html, so the page cannot describe a tool surface that does not exist - which is
// precisely what it did before: six invented tool names under a heading announcing that no MCP
// server had been written, while packages/mcp-server was serving thirteen real ones.
// packages/mcp-server/test/catalogue.test.mjs pins the catalogue to the live definitions.
import { catalogue as MCP_TOOLS } from '../../../packages/mcp-server/src/catalogue.mjs';

interface SkinCard {
  /** True for a theme that came from the user's own assets/skins.json rather than the bundle. */
  custom?: boolean;
  id: string;
  name: string;
  description: string;
  materials: Record<string, string>;
}
const BUILT_IN_SKINS = skinCatalogue as SkinCard[];
/**
 * Built-ins plus whatever the user has authored, refreshed from the running renderer.
 *
 * This page used to build its cards straight from the compile-time JSON, which by definition
 * cannot contain a theme the user wrote after the build. So "改完点重新加载即可生效" was true
 * for actions and expressions and simply false for themes: the file loaded, the id appeared in
 * GET /capabilities, and the appearance page still had no card to click. There was no entry
 * point at all - the user was told to reload, reloaded, and nothing visibly happened.
 */
let SKINS: SkinCard[] = [...BUILT_IN_SKINS];
/** The theme showing right now, so a rebuild of the card list keeps the right one marked. */
let activeSkinId = BUILT_IN_SKINS[0]?.id ?? '';

/** Pull the live catalogue from the renderer and merge it over the built-ins. */
async function refreshSkinCatalogue(): Promise<void> {
  try {
    const capabilities = await invoke<{ skins?: { id: string; name: string; description?: string; source?: string }[] }>(
      'get_capabilities',
    );
    const live = capabilities?.skins ?? [];
    if (!live.length) return; // renderer has not reported yet - keep the built-ins rather than blanking the page
    const byId = new Map(BUILT_IN_SKINS.map((skin) => [skin.id, skin]));
    for (const entry of live) {
      const existing = byId.get(entry.id);
      if (existing) continue;
      // A custom theme has no swatch colours here (they live in the renderer's own copy), so
      // it borrows the default's for the chips and is labelled as the user's own.
      byId.set(entry.id, {
        ...BUILT_IN_SKINS[0],
        id: entry.id,
        name: entry.name ?? entry.id,
        description: entry.description ?? '来自你的 assets/skins.json',
        custom: true,
      } as SkinCard);
    }
    SKINS = [...byId.values()];
  } catch {
    // Leave the built-ins in place; an appearance page with nine themes beats an empty one.
  }
}

type Trait = 'independence' | 'curiosity' | 'gentleness' | 'playfulness' | 'sleepiness';
type PersonalityTraits = Record<Trait, number>;
type BehaviorPreset = 'quiet' | 'balanced' | 'lively';

interface Status {
  scale: number;
  visible: boolean;
  mode: string;
  catName: string;
  catPersonality: string;
  activeAgent: string;
  knownAgents: string[];
  accessibilityTrusted: boolean;
  personalityTraits: PersonalityTraits;
  behaviorPreset: BehaviorPreset;
  knownBehaviorPresets: BehaviorPreset[];
  avoidRadius: number;
  skin: string;
  camera: string;
}

/** Mirrors src-tauri's `TaskEvent` struct / packages/contracts' `TaskEvent` interface. */
interface TaskEvent {
  schemaVersion: 1;
  provider: string;
  sourceId: string;
  taskId: string;
  eventId: string;
  state: string;
  sequence: number;
  observedAt: number;
  summary?: string;
}

/** Shape of what main.ts pushes via report_perception - see
 *  packages/perception-contract's PerceptionSnapshot. Every field optional: the companion
 *  window may not have reported yet (first couple of seconds after launch), or the whole
 *  object may still be `{}`. */
interface PerceptionSnapshot {
  petState?: string;
  mode?: string;
  activity?: {
    idleMs: number | null;
    cursorNearPetMs: number;
    clicksOnPet: number;
    dragCount: number;
  };
  growth?: {
    engagementScore: number;
    lifetimeInteractionCount: number;
  };
}

const TOYS = [
  { kind: 'yarn', name: '毛线球', description: '会滚会反弹，猫拍一爪又飞出去，能自己玩下去' },
  { kind: 'feather', name: '逗猫棒', description: '跟着鼠标走，但慢半拍——需要你来逗' },
  { kind: 'laser', name: '激光笔', description: '钉死在光标上，拍到也抓不住' },
] as const;

const PERFORMANCES = [
  { id: 'angry-claw', name: '愤怒抓屏', description: '炸毛冲到屏幕中间，对着你连抓两爪，留下爪痕并震屏' },
  { id: 'kiss-rush', name: '飞奔亲亲', description: '从另一头跑过来，闭眼亲一下，爱心飘满屏' },
  { id: 'zoomies', name: '半夜暴走', description: '贴着四角疯跑一圈，跑完自己坐下喘气' },
] as const;

const PET_STATE_LABELS: Record<string, string> = {
  idle: '安静待着',
  play_toy: '玩玩具中',
  wander: '四处走走',
  follow_cursor: '追着光标玩',
  dragged: '被抓着呢',
  ai_directed: '被建议引导中',
};

const TASK_STATE_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  blocked: '卡住了',
  needs_input: '等你回答',
  needs_approval: '等你批准',
  completed: '✓ 完成',
  failed: '✗ 失败',
  cancelled: '已取消',
};

function setupNav() {
  const navButtons = document.querySelectorAll<HTMLButtonElement>('.nav-item');
  const titles: Record<string, string> = {
    home: '此刻', agent: 'Agent 接入', personality: '性格行为', play: '玩法', appearance: '外观', settings: '设置',
  };
  function showPage(pageName: string) {
    navButtons.forEach((button) => {
      const active = button.dataset.page === pageName;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.querySelectorAll<HTMLElement>('.page').forEach((page) => {
      page.classList.toggle('active', page.id === `page-${pageName}`);
    });
    const title = document.getElementById('page-title');
    if (title) title.textContent = titles[pageName] ?? '灵犀';
  }
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => showPage(btn.dataset.page ?? 'home'));
  });
  document.getElementById('home-agent-summary')?.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>('.home-agent-row');
    if (row) {
      const target = row.dataset.agentTarget;
      if (!target) return;
      showPage('agent');
      const panel = document.querySelector<HTMLElement>(`[data-agent-panel="${target}"]`);
      panel?.classList.add('open');
      panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

function setupHomeHero() {
  const hero = document.getElementById('home-hero');
  const cat = document.getElementById('home-cat-image') as HTMLImageElement | null;
  if (hero) hero.style.backgroundImage = `url("${homeSceneUrl}")`;
  if (cat) cat.src = homeCatUrl;
  document.getElementById('home-play')?.addEventListener('click', async () => {
    const result = document.getElementById('home-play-result');
    try {
      await invoke('set_toy', { kind: 'feather' });
      if (result) result.textContent = '逗猫棒放好了，等你来逗。';
    } catch (error) {
      if (result) result.textContent = `暂时没放好：${String(error)}`;
    }
  });
}

function setupAccordion() {
  document.querySelectorAll<HTMLButtonElement>('.accordion-header').forEach((header) => {
    header.addEventListener('click', () => {
      header.closest('.accordion-item')?.classList.toggle('open');
    });
  });
  // Claude is the one real adapter - open its panel by default so "一键接入" is visible
  // without an extra click, matching docs/18 §6.2's own mockup ("默认全部折叠、展开一个").
  document.querySelector('[data-agent-panel="claude"]')?.classList.add('open');
}

// Two separate button groups show the same "current size" - the global top bar (every
// page) and the 外观 page's own, larger control.
const SIZE_BUTTON_GROUPS = ['#topbar-sizes button', '#size-options button'];

function setActiveSizeButton(scale: number) {
  for (const selector of SIZE_BUTTON_GROUPS) {
    document.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.scale) === scale);
    });
  }
}

function setVisibilityButtonLabel(visible: boolean) {
  const btn = document.getElementById('toggle-visibility');
  if (btn) btn.textContent = visible ? '隐藏' : '显示';
}

function setIdentityFields(name: string, personality: string) {
  const nameInput = document.getElementById('cat-name-input') as HTMLInputElement | null;
  const personalityInput = document.getElementById('cat-personality-input') as HTMLTextAreaElement | null;
  const sidebarName = document.getElementById('sidebar-cat-name');
  const homeName = document.getElementById('home-cat-name');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = name;
  if (personalityInput && document.activeElement !== personalityInput) personalityInput.value = personality;
  if (sidebarName) sidebarName.textContent = name;
  if (homeName) homeName.textContent = name;
  const personalityLine = document.getElementById('home-cat-personality-line');
  if (personalityLine) personalityLine.textContent = `性格：${personality.trim() || '还没设定'}`;
}

function setTraitSliders(traits: PersonalityTraits) {
  document.querySelectorAll<HTMLElement>('.trait-slider').forEach((row) => {
    const trait = row.dataset.trait as Trait | undefined;
    if (!trait) return;
    const input = row.querySelector('input') as HTMLInputElement;
    if (document.activeElement !== input) input.value = String(Math.round(traits[trait] * 100));
  });
}

function readTraitSliders(): PersonalityTraits {
  const traits = {} as PersonalityTraits;
  document.querySelectorAll<HTMLElement>('.trait-slider').forEach((row) => {
    const trait = row.dataset.trait as Trait | undefined;
    if (!trait) return;
    const input = row.querySelector('input') as HTMLInputElement;
    traits[trait] = Number(input.value) / 100;
  });
  return traits;
}

function setActiveBehaviorPreset(preset: BehaviorPreset) {
  document.querySelectorAll<HTMLButtonElement>('#behavior-preset-options button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.preset === preset);
  });
}

/**
 * 外观 / 主题: the theme cards are generated from the same catalogue the renderer paints from
 * (src/data/skins.json), not hand-written markup. That file is the single source of truth for
 * what themes exist, so a page built from it can never again claim a theme is "planned" when
 * the asset is right there, or offer one that was removed.
 */
function renderSkinCards(activeId: string) {
  activeSkinId = activeId;
  const container = document.getElementById('skin-options');
  if (!container) return;
  container.replaceChildren(
    ...SKINS.map((skin) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'skin-card';
      card.dataset.skin = skin.id;
      card.classList.toggle('active', skin.id === activeId);

      const name = document.createElement('strong');
      name.textContent = skin.name;

      const swatches = document.createElement('div');
      swatches.className = 'skin-swatches';
      for (const key of ['fur', 'pattern', 'cream', 'iris', 'nose'] as const) {
        const chip = document.createElement('i');
        chip.style.background = skin.materials[key];
        swatches.append(chip);
      }

      const note = document.createElement('span');
      note.textContent = skin.id === activeId ? '使用中' : skin.description;
      if (skin.custom) {
        card.classList.add('skin-card-custom');
        card.title = '你自己定义的主题（assets/skins.json）';
      }

      card.append(name, swatches, note);
      card.addEventListener('click', () => void invoke('set_skin', { skin: skin.id }));
      return card;
    }),
  );
  const hint = document.getElementById('skin-hint');
  const active = SKINS.find((skin) => skin.id === activeId);
  if (hint) {
    hint.textContent =
      `共 ${SKINS.length} 款主题（内置 ${BUILT_IN_SKINS.length} 款` +
      `${SKINS.length > BUILT_IN_SKINS.length ? ` + 你自己的 ${SKINS.length - BUILT_IN_SKINS.length} 款` : ''}）。` +
      (active ? `当前：${active.name} — ${active.description}。` : '') +
      '切换即时生效，不用重启，并且会记住。';
  }
}

function renderCameraOptions(activeId: string) {
  const container = document.getElementById('camera-options');
  if (!container) return;
  container.replaceChildren(
    ...CAMERA_PRESETS.map((preset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.camera = preset.id;
      button.classList.toggle('active', preset.id === activeId);
      const label = document.createElement('b');
      label.textContent = preset.id === 'auto' ? preset.name : `${preset.name} · ${preset.elevationDeg}°`;
      const note = document.createElement('span');
      note.textContent = preset.description;
      button.append(label, note);
      button.addEventListener('click', () => void invoke('set_camera', { camera: preset.id }));
      return button;
    }),
  );
}

/** 玩法 page. Same shape as the camera picker - a labelled card per option, no fake state:
 *  neither a toy nor a performance is a persistent setting, so nothing here shows as "active". */
function renderPlayPage() {
  const toys = document.getElementById('toy-options');
  if (toys) {
    toys.replaceChildren(
      ...TOYS.map((toy) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.append(
          Object.assign(document.createElement('b'), { textContent: toy.name }),
          Object.assign(document.createElement('span'), { textContent: toy.description }),
        );
        button.addEventListener('click', () => void invoke('set_toy', { kind: toy.kind }));
        return button;
      }),
    );
  }
  const shows = document.getElementById('performance-options');
  if (shows) {
    shows.replaceChildren(
      ...PERFORMANCES.map((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.append(
          Object.assign(document.createElement('b'), { textContent: entry.name }),
          Object.assign(document.createElement('span'), { textContent: entry.description }),
        );
        button.addEventListener('click', () => void invoke('perform', { id: entry.id }));
        return button;
      }),
    );
  }
  document.getElementById('clear-toy')?.addEventListener('click', () => void invoke('clear_toy'));
  const sayInput = document.getElementById('say-input') as HTMLInputElement | null;
  const say = () => {
    const text = sayInput?.value ?? '';
    if (text.trim()) void invoke('say', { text });
  };
  document.getElementById('say-button')?.addEventListener('click', say);
  sayInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') say();
  });
  document.getElementById('stop-performance')?.addEventListener('click', () => void invoke('stop_performance'));
}

function renderPerception(snapshot: PerceptionSnapshot) {
  const stateEl = document.getElementById('home-cat-state');
  if (stateEl) {
    const label = snapshot.petState ? (PET_STATE_LABELS[snapshot.petState] ?? snapshot.petState) : '还没收到状态';
    stateEl.textContent = `现在，${label}`;
  }
}

/** 首页 polls the same snapshot GET /perception serves, over `invoke` instead of HTTP -
 *  see get_perception's doc comment in src-tauri/src/lib.rs. Paused while the window isn't
 *  visible (docs/18 §6.1's "页面不可见时暂停") since a hidden management window polling
 *  every 2s is pure waste. */
function startPerceptionPolling() {
  let timer: ReturnType<typeof setInterval> | null = null;
  async function poll() {
    try {
      renderPerception(await invoke<PerceptionSnapshot>('get_perception'));
    } catch {
      // companion window hasn't reported yet, or invoke failed transiently - next poll
      // picks it back up, nothing worth showing the user for a single missed tick
    }
  }
  function start() {
    if (timer != null) return;
    void poll();
    timer = setInterval(poll, 2000);
  }
  function stop() {
    if (timer == null) return;
    clearInterval(timer);
    timer = null;
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  if (!document.hidden) start();
}

// --- Agent 接入 · Claude Code (the one real adapter this round - docs/18 决策 8) ---

const claudeTasks = new TaskStore();

function renderClaudeTaskList() {
  const list = document.getElementById('claude-task-list');
  if (!list) return;
  const events = claudeTasks.snapshot(Date.now(), 10 * 60_000); // 10 min staleness window
  if (events.length === 0) {
    list.innerHTML = '<li class="task-list-empty">还没有任务事件。</li>';
    return;
  }
  // Most recent first; failed/waiting pinned to the top (docs/18 §6.1's own rule for the
  // task flow, applied here too since this is the only task list in the app right now).
  // "Waiting" means the three states where the USER is the blocker - a question, a permission
  // prompt, or being stuck - not just one of them.
  const priority = (s: string) => (s === 'failed' || s === 'needs_input' || s === 'needs_approval' || s === 'blocked' ? 0 : 1);
  const sorted = [...events].sort((a, b) => priority(a.state) - priority(b.state) || b.observedAt - a.observedAt);
  list.innerHTML = sorted
    .slice(0, 20)
    .map((e) => {
      const time = new Date(e.observedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const label = e.provider === 'codex' && e.state === 'completed'
        ? '本轮回复结束' : (TASK_STATE_LABELS[e.state] ?? e.state);
      const staleNote = e.stale ? '（过期，未推断完成）' : '';
      const summary = e.summary ? escapeHtml(e.summary) : '';
      return `<li class="task-list-item"><span class="task-time">${time}</span><span class="task-label">${label}${staleNote}</span><span class="task-summary">${summary}</span></li>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function setClaudeConnectedUi(connected: boolean, hasLiveEvent: boolean) {
  const badge = document.getElementById('claude-status-badge');
  const detail = document.getElementById('claude-status-detail');
  const connectBtn = document.getElementById('claude-connect') as HTMLButtonElement | null;
  const disconnectBtn = document.getElementById('claude-disconnect') as HTMLButtonElement | null;
  if (badge) {
    badge.textContent = hasLiveEvent ? '● 已连接' : connected ? '◐ 已接入 · 等待事件' : '○ 未接入';
    badge.classList.toggle('badge-muted', !connected);
  }
  if (detail) {
    detail.textContent = hasLiveEvent
      ? '正在接收真实任务事件。'
      : connected
        ? 'hooks 已安装，等待 Claude Code 触发第一个事件（提交一轮对话即可）。'
        : '还没有安装 hooks。';
  }
  if (connectBtn) connectBtn.hidden = connected;
  if (disconnectBtn) disconnectBtn.hidden = !connected;
}

interface BridgeInfo {
  port: number;
  authRequired: boolean;
  tokenFile: string | null;
  agents: { id: string; name: string; badge: string; color: string }[];
}

/**
 * Fill the MCP and bridge cards from what the bridge actually is at this moment.
 *
 * Everything these two cards used to say was written by hand and then left behind by the code:
 * the access-token line claimed 未启用 and "同机进程目前都能直接调用" for as long as the bridge
 * had been minting a token, storing it 0600 and rejecting anonymous callers - a page telling the
 * user a security property was absent while it was being enforced. The fix is not a better
 * sentence, it is asking: get_bridge_info reads the same BridgeToken and AgentRegistry the bridge
 * serves from, so these lines cannot outlive the thing they describe.
 *
 * Failure is quiet on purpose. This is descriptive text on a settings page - if the command is
 * unavailable the cards keep their "检查中…" placeholder, which is honest, rather than blanking
 * or claiming a state nothing confirmed.
 */
async function renderBridgeInfo(): Promise<void> {
  // The tool table does not depend on the app being reachable - it is a fact about the repo -
  // so it is rendered first and unconditionally.
  const rows = document.getElementById('mcp-tool-rows');
  if (rows) {
    rows.innerHTML = '';
    for (const tool of MCP_TOOLS) {
      const tr = document.createElement('tr');
      const code = document.createElement('code');
      code.textContent = tool.name;
      const nameCell = document.createElement('td');
      nameCell.append(code);
      const purposeCell = document.createElement('td');
      purposeCell.textContent = tool.purpose;
      const riskCell = document.createElement('td');
      riskCell.textContent = tool.risk;
      tr.append(nameCell, purposeCell, riskCell);
      rows.append(tr);
    }
  }
  const mcpBadge = document.getElementById('mcp-status-badge');
  const mcpDetail = document.getElementById('mcp-status-detail');
  if (mcpBadge) mcpBadge.textContent = `${MCP_TOOLS.length} 个工具`;
  if (mcpDetail) {
    mcpDetail.textContent =
      'MCP server 随仓库提供（packages/mcp-server），通过下面的本机桥说话。' +
      '它是个独立进程，由你的 agent 宿主启动，所以这里看不到它是否正在运行——' +
      '能看到的是下面「已登记的 agent」：有名字出现，就说明真的有东西接上了。';
  }

  let info: BridgeInfo;
  try {
    info = await invoke<BridgeInfo>('get_bridge_info');
  } catch (error) {
    console.error('[lingxi-management] get_bridge_info failed', error);
    return;
  }

  const address = document.getElementById('bridge-address');
  if (address) address.textContent = `127.0.0.1:${info.port}`;

  const authBadge = document.getElementById('bridge-auth-badge');
  const authDetail = document.getElementById('bridge-auth-detail');
  if (authBadge) {
    authBadge.textContent = info.authRequired ? '已启用' : '未启用';
    authBadge.classList.toggle('badge-muted', !info.authRequired);
  }
  if (authDetail) {
    authDetail.textContent = info.authRequired
      ? info.tokenFile
        // Naming the file is the actionable half: it is what a user checks when an agent cannot
        // connect, and what they delete to revoke every client at once.
        ? `每个请求都要带令牌，没有就拒绝。令牌存在 ${info.tokenFile}，权限 0600，只有你这个账户能读。`
        : '每个请求都要带令牌，没有就拒绝。这次没能写入配置目录，所以令牌只存在于内存里——应用重启后会换一个。'
      : '这个构建没有启用令牌校验。';
  }

  const agentsLine = document.getElementById('mcp-agents-line');
  if (agentsLine) {
    agentsLine.textContent = info.agents.length
      ? `已登记的 agent：${info.agents.map((agent) => `${agent.badge} ${agent.name}`).join('、')}`
      : '已登记的 agent：还没有。agent 第一次调用 lingxi_register 或 POST /agents 后会出现在这里。';
  }
}

interface AgentRow {
  id: string;
  name: string;
  badge: string;
  color: string;
  lastSeen: number;
  claims: number;
  permission: string;
  /** False for an agent that has a saved grant but has not called yet this session. */
  seen: boolean;
}

interface AgentCall {
  at: number;
  agent: string;
  surface: string;
  asked: string;
  outcome: 'applied' | 'rejected' | 'denied' | 'throttled';
  reason?: string;
}

interface HomeActivity {
  provider: string;
  agent?: string;
  taskId: string;
  state: string;
  kind: string;
  summary: string;
  updatedAt: number;
  busy: boolean;
  name?: string;
  badge?: string;
  color?: string;
}

interface AgentActivity {
  agents: AgentRow[];
  activity?: HomeActivity[];
  log: AgentCall[];
  permissions: string[];
  writeLimit: number;
  writeWindowMs: number;
  settingsFields: string[];
}

const OUTCOME_LABEL: Record<AgentCall['outcome'], string> = {
  applied: '已执行',
  rejected: '被拒',
  denied: '无权限',
  throttled: '频控',
};

function relativeTime(at: number): string {
  if (!at) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`;
  return `${Math.round(seconds / 86400)} 天前`;
}

function agentTarget(id: string): string | undefined {
  const normalized = id.toLowerCase();
  if (normalized.includes('dsh') || normalized.includes('deepseek')) return 'dsh';
  if (normalized.includes('claude')) return 'claude';
  if (normalized.includes('codex')) return 'codex';
  return undefined;
}

function activityStateLabel(activity: HomeActivity): string {
  const state = TASK_STATE_LABELS[activity.state] ?? activity.state;
  const summary = activity.summary.trim();
  if (activity.state === 'completed' && activity.kind === 'chat') {
    if (!summary || summary === '本轮回复结束' || summary.startsWith('本轮回复完成')) return '本轮回复结束';
    return summary;
  }
  if (activity.state === 'completed' && summary) return `已完成：${summary}`;
  if (activity.state === 'failed' && summary) return `失败：${summary}`;
  if (summary) return `${state}：${summary}`;
  return state;
}

function renderHomeAgents(data: AgentActivity) {
  const container = document.getElementById('home-agent-summary');
  if (!container) return;
  container.replaceChildren();
  const activities = [...(data.activity ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const registered = data.agents.filter((agent) => agent.seen);
  const dshBadge = document.getElementById('dsh-status-badge');
  const dshActivity = (data.activity ?? []).find((activity) =>
    agentTarget(activity.agent || activity.provider) === 'dsh',
  );
  const dshRegistered = registered.some((agent) => agentTarget(agent.id) === 'dsh');
  if (dshBadge) {
    dshBadge.textContent = dshActivity ? `最近报告 · ${relativeTime(dshActivity.updatedAt)}` : dshRegistered ? '已登记 · 暂无任务' : '尚无报告';
    dshBadge.classList.toggle('badge-muted', !dshActivity);
  }
  const represented = new Set<string>();
  const rows: { id: string; name: string; badge: string; color: string; detail: string }[] = [];
  for (const activity of activities) {
    const id = activity.agent || activity.provider;
    represented.add(id);
    const registeredAgent = registered.find((agent) => agent.id === id || agent.id === activity.provider);
    rows.push({
      id,
      name: activity.name || registeredAgent?.name || activity.provider,
      badge: activity.badge || registeredAgent?.badge || activity.provider.slice(0, 2).toUpperCase(),
      color: activity.color || registeredAgent?.color || '#8b7865',
      detail: `${activityStateLabel(activity)} · ${relativeTime(activity.updatedAt)}`,
    });
  }
  for (const agent of registered) {
    if (represented.has(agent.id)) continue;
    rows.push({
      id: agent.id,
      name: agent.name,
      badge: agent.badge,
      color: agent.color,
      detail: `已登记 · 暂无实时任务 · 最近 ${relativeTime(agent.lastSeen)}`,
    });
  }
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'home-empty';
    empty.textContent = '还没有 Agent 接入；接入后，最近任务会出现在这里。';
    container.append(empty);
    return;
  }
  for (const row of rows.slice(0, 4)) {
    const button = document.createElement('button');
    button.className = 'home-agent-row';
    button.type = 'button';
    button.dataset.agentTarget = agentTarget(row.id) ?? '';
    button.title = button.dataset.agentTarget ? `打开 ${row.name} 接入详情` : `${row.name}（暂无专属详情页）`;
    const badge = document.createElement('span');
    badge.className = 'home-agent-badge';
    badge.textContent = row.badge;
    badge.style.backgroundColor = row.color;
    const copy = document.createElement('span');
    copy.className = 'home-agent-copy';
    const name = document.createElement('strong');
    name.textContent = row.name;
    const detail = document.createElement('span');
    detail.className = 'home-agent-detail';
    detail.textContent = row.detail;
    copy.append(name, detail);
    const arrow = document.createElement('span');
    arrow.className = 'home-agent-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = button.dataset.agentTarget ? '›' : '';
    button.append(badge, copy, arrow);
    container.append(button);
  }
}

/**
 * The per-agent permission table and the call log.
 *
 * Both halves are here because neither works alone. A tier the user cannot see the consequences
 * of is a setting they will never touch; a log with nothing to change in response to it is a
 * wall of text. Granting `trusted` and then watching the next few calls land is the actual
 * workflow this is for.
 */
async function initAgentPermissions(): Promise<void> {
  const rows = document.getElementById('agent-permission-rows');
  const logRows = document.getElementById('agent-log-rows');
  const result = document.getElementById('agent-permission-result');
  const fieldsLabel = document.getElementById('perm-settings-fields');
  const logNote = document.getElementById('agent-log-note');

  function renderAgents(data: AgentActivity) {
    if (!rows) return;
    rows.innerHTML = '';
    if (!data.agents.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = '还没有 agent 调用过。接上一个之后它会出现在这里。';
      tr.append(td);
      rows.append(tr);
      return;
    }
    // Most recently active first - the one you are about to make a decision about is almost
    // always the one that just did something.
    const sorted = [...data.agents].sort((a, b) => b.lastSeen - a.lastSeen);
    for (const agent of sorted) {
      const tr = document.createElement('tr');

      const who = document.createElement('td');
      who.textContent = `${agent.badge} ${agent.name}`;
      if (!agent.seen) {
        const note = document.createElement('span');
        note.className = 'hint';
        note.textContent = '（本次运行还没来过）';
        who.append(note);
      }

      const tier = document.createElement('td');
      const select = document.createElement('select');
      for (const value of data.permissions) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        if (value === agent.permission) {
          option.selected = true;
          // Reflected as an attribute as well as a property. The property alone is what the
          // browser acts on, but it does not serialise - so the rendered page would not say
          // which tier is in force, and a permissions UI whose state cannot be read back is
          // one nobody can check.
          option.setAttribute('selected', '');
        }
        select.append(option);
      }
      select.addEventListener('change', async () => {
        try {
          const message = await invoke<string>('set_agent_permission', {
            id: agent.id,
            permission: select.value,
          });
          if (result) {
            result.textContent = message;
            result.hidden = false;
          }
        } catch (error) {
          if (result) {
            result.textContent = String(error);
            result.hidden = false;
          }
        }
        await refresh();
      });
      tier.append(select);

      const claims = document.createElement('td');
      claims.textContent = String(agent.claims);
      const seen = document.createElement('td');
      seen.textContent = relativeTime(agent.lastSeen);

      tr.append(who, tier, claims, seen);
      rows.append(tr);
    }
  }

  function renderLog(data: AgentActivity) {
    if (!logRows) return;
    logRows.innerHTML = '';
    if (!data.log.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = '还没有调用。';
      tr.append(td);
      logRows.append(tr);
      return;
    }
    for (const call of data.log.slice(0, 60)) {
      const tr = document.createElement('tr');
      for (const text of [
        relativeTime(call.at),
        call.agent,
        call.surface,
        call.asked,
        OUTCOME_LABEL[call.outcome] ?? call.outcome,
      ]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      // The reason is the whole point of a refused row - without it the log says an integration
      // stopped working and not why.
      if (call.reason) tr.title = call.reason;
      logRows.append(tr);
    }
  }

  async function refresh() {
    try {
      const data = await invoke<AgentActivity>('get_agent_activity');
      renderAgents(data);
      renderLog(data);
      renderHomeAgents(data);
      if (fieldsLabel) fieldsLabel.textContent = data.settingsFields.join(' / ');
      if (logNote) {
        logNote.textContent =
          `最近 ${data.log.length} 条（最多留 200），内存里，重启清空。只记要了什么字段和结果，不记内容——`
          + `你写给猫的话、猫记住的事，都不在这里。设置写入限速：每 ${Math.round(data.writeWindowMs / 1000)} 秒 ${data.writeLimit} 次。`;
      }
    } catch (error) {
      console.error('[lingxi-management] get_agent_activity failed', error);
      const homeSummary = document.getElementById('home-agent-summary');
      if (homeSummary) {
        const note = document.createElement('p');
        note.className = 'home-empty';
        note.textContent = '暂时读不到 Agent 状态，请稍后再看。';
        homeSummary.replaceChildren(note);
      }
    }
  }

  await refresh();
  // The log is the live half of this page: a user who just granted a tier is watching for the
  // next call to land.
  window.setInterval(() => void refresh(), 4000);
}

interface CodexStatus {
  state: 'installed' | 'not_installed' | 'conflict' | 'unparsable' | 'unavailable';
  configPath?: string;
  configExists?: boolean;
  mcpInstalled?: boolean;
  existingNotify?: string;
  reason?: string;
}

/**
 * The Codex panel.
 *
 * Structurally the same as Claude Code's, with one state Claude Code cannot have: `conflict`.
 * Codex's `notify` is a single TOML key, so a machine that already has one is a machine where
 * installing would delete someone else's integration - silently, because Codex just stops
 * calling it. That is not "cannot install", it is "installing would break something", and the
 * panel has to make the difference visible: the button goes away and the other tool's command
 * is shown verbatim so the user can see whose it is.
 */
async function initCodexAdapter(): Promise<void> {
  const badge = document.getElementById('codex-status-badge');
  const detail = document.getElementById('codex-status-detail');
  const connect = document.getElementById('codex-connect') as HTMLButtonElement | null;
  const disconnect = document.getElementById('codex-disconnect') as HTMLButtonElement | null;
  const result = document.getElementById('codex-connect-result');
  const conflict = document.getElementById('codex-conflict');
  const conflictExisting = document.getElementById('codex-conflict-existing');
  const mcpHint = document.getElementById('codex-mcp-hint');
  const mcpSnippet = document.getElementById('codex-mcp-snippet');

  function render(status: CodexStatus) {
    const installed = status.state === 'installed';
    if (badge) {
      badge.textContent = {
        installed: '● 已接入',
        not_installed: '○ 未接入',
        conflict: '⚠ 有冲突',
        unparsable: '⚠ 配置读不了',
        unavailable: '— 不可用',
      }[status.state];
      badge.classList.toggle('badge-muted', !installed);
    }
    if (detail) {
      detail.textContent = {
        installed: `已写入 ${status.configPath}。重启 Codex 后，每个回合结束猫都会有反应。`,
        not_installed: status.configExists
          ? `${status.configPath} 里还没有 notify。`
          : `还没有 ${status.configPath}——接入时会建一个。`,
        conflict: '没有改动你的配置。原因见下。',
        unparsable: `${status.configPath} 不是合法的 TOML，所以这里不会去写它——先修好文件再来。`,
        unavailable: status.reason ?? '读不到 Codex 配置。',
      }[status.state];
    }
    // Installing is offered only when it is actually safe to write.
    if (connect) connect.hidden = status.state !== 'not_installed';
    if (disconnect) disconnect.hidden = !installed;
    if (conflict) conflict.hidden = status.state !== 'conflict';
    if (conflictExisting) conflictExisting.textContent = status.existingNotify ?? '';
    // The MCP half is only worth showing once the deterministic half is in place - before that
    // it is one more thing to read on a panel where nothing is connected yet.
    const showMcp = installed && !status.mcpInstalled;
    if (mcpHint) mcpHint.hidden = !showMcp;
    if (mcpSnippet) mcpSnippet.hidden = !showMcp;
  }

  async function refresh() {
    try {
      render(await invoke<CodexStatus>('codex_integration_status'));
    } catch (error) {
      console.error('[lingxi-management] codex_integration_status failed', error);
      render({ state: 'unavailable', reason: String(error) });
    }
  }

  async function act(command: 'install_codex_notify' | 'uninstall_codex_notify') {
    try {
      const message = await invoke<string>(command);
      if (result) {
        result.textContent = message;
        result.hidden = false;
      }
    } catch (error) {
      if (result) {
        // The refusal text explains what is in the way and how to keep both - show it as it
        // is rather than flattening it to "失败".
        result.textContent = String(error);
        result.hidden = false;
      }
    }
    await refresh();
  }

  connect?.addEventListener('click', () => void act('install_codex_notify'));
  disconnect?.addEventListener('click', () => void act('uninstall_codex_notify'));
  await refresh();
}

async function initClaudeAdapter() {
  let connected = false;
  try {
    connected = await invoke<boolean>('claude_hooks_installed');
  } catch {
    // command unavailable for some reason - leave connected=false, UI shows "未接入"
  }
  let hasLiveEvent = false;
  try {
    const events = await invoke<TaskEvent[]>('get_claude_task_events');
    for (const e of events) {
      try {
        if (claudeTasks.apply(e)) hasLiveEvent = true;
      } catch {
        // a malformed stored event shouldn't break the rest of the list
      }
    }
    renderClaudeTaskList();
  } catch {
    // no events yet - fine, list stays empty
  }
  setClaudeConnectedUi(connected, hasLiveEvent);

  document.getElementById('claude-connect')?.addEventListener('click', async () => {
    const resultEl = document.getElementById('claude-connect-result');
    try {
      const message = await invoke<string>('install_claude_hooks');
      if (resultEl) {
        resultEl.textContent = message;
        resultEl.hidden = false;
      }
      connected = true;
      setClaudeConnectedUi(connected, hasLiveEvent);
    } catch (error) {
      if (resultEl) {
        resultEl.textContent = `接入失败：${String(error)}`;
        resultEl.hidden = false;
      }
    }
  });

  document.getElementById('claude-disconnect')?.addEventListener('click', async () => {
    const resultEl = document.getElementById('claude-connect-result');
    try {
      const message = await invoke<string>('uninstall_claude_hooks');
      if (resultEl) {
        resultEl.textContent = message;
        resultEl.hidden = false;
      }
      connected = false;
      hasLiveEvent = false;
      setClaudeConnectedUi(connected, hasLiveEvent);
    } catch (error) {
      if (resultEl) {
        resultEl.textContent = `断开失败：${String(error)}`;
        resultEl.hidden = false;
      }
    }
  });

  void listen<TaskEvent>('claude-task-event', (event) => {
    try {
      if (claudeTasks.apply(event.payload)) {
        hasLiveEvent = true;
        connected = true; // a live event is proof hooks are installed even if the earlier check raced
        renderClaudeTaskList();
        setClaudeConnectedUi(connected, hasLiveEvent);
      }
    } catch {
      // validateTaskEvent rejected it (shouldn't happen - src-tauri only emits shapes it
      // built itself) - drop silently rather than crash the whole management window
    }
  });
}

async function main() {
  setupNav();
  setupHomeHero();
  setupAccordion();

  const status = await invoke<Status>('get_status');
  setActiveSizeButton(status.scale);
  setVisibilityButtonLabel(status.visible);
  setIdentityFields(status.catName, status.catPersonality);
  setTraitSliders(status.personalityTraits);
  setActiveBehaviorPreset(status.behaviorPreset);
  renderPlayPage();
  void refreshSkinCatalogue().then(() => renderSkinCards(status.skin));
  renderCameraOptions(status.camera);
  const accEl = document.getElementById('status-accessibility');
  if (accEl) accEl.textContent = status.accessibilityTrusted ? '已授权（未来功能用得上）' : '未授权（不影响当前功能）';

  for (const selector of SIZE_BUTTON_GROUPS) {
    document.querySelectorAll<HTMLButtonElement>(selector).forEach((btn) => {
      btn.addEventListener('click', () => {
        const scale = Number(btn.dataset.scale);
        void invoke('set_scale', { scale });
      });
    });
  }

  document.getElementById('toggle-visibility')?.addEventListener('click', async () => {
    const current = await invoke<Status>('get_status');
    void invoke('set_companion_visible', { visible: !current.visible });
  });


  document.getElementById('open-debug')?.addEventListener('click', () => void invoke('open_debug_window'));

  // --- 自定义资源 ---
  const assetStatus = document.getElementById('asset-status');
  // Set when a reload is awaiting the companion window's completion event, consumed by the
  // custom-assets-reloaded listener below. Null means nothing pending.
  let pendingAssetRefreshMessage: string | null = null;
  async function refreshAssetStatus(extra?: string) {
    if (!assetStatus) return;
    const errors = await invoke<string[]>('get_asset_errors').catch(() => [] as string[]);
    if (errors.length) {
      assetStatus.className = 'hint asset-error';
      assetStatus.textContent = `有 ${errors.length} 个文件没能生效（已保留内置版本）：\n${errors.join('\n')}`;
    } else {
      assetStatus.className = 'hint';
      assetStatus.textContent = extra ?? '当前没有检测到问题。';
    }
  }
  void refreshAssetStatus();

  document.getElementById('open-assets')?.addEventListener('click', () => {
    void invoke('open_assets_dir').catch((error) => {
      if (assetStatus) assetStatus.textContent = `打开失败：${String(error)}`;
    });
  });
  document.getElementById('install-templates')?.addEventListener('click', async () => {
    try {
      // The built-in data is sent from here rather than duplicated in Rust - one copy, so the
      // templates can never drift from what the app actually ships with.
      const dir = await invoke<string>('install_asset_templates', {
        actions: actionCatalogue,
        expressions: BUILT_IN_EXPRESSIONS,
        skins: skinCatalogue,
        readme: ASSETS_README,
        overwrite: false,
      });
      await refreshAssetStatus(`模板已写入：${dir}（已存在的文件不会被覆盖）`);
    } catch (error) {
      if (assetStatus) assetStatus.textContent = `导出失败：${String(error)}`;
    }
  });
  document.getElementById('reload-assets')?.addEventListener('click', async () => {
    try {
      await invoke('reload_custom_assets');
      // The companion window re-reads and reports asynchronously; asking immediately shows the
      // PREVIOUS load's theme list. Listen for its completion event instead of guessing a
      // delay: the 700ms guess raced a slow disk (stale list) and annoyed nobody on a fast one.
      pendingAssetRefreshMessage = '已重新加载。';
    } catch (error) {
      if (assetStatus) assetStatus.textContent = `重新加载失败：${String(error)}`;
    }
  });
  // Fired by the companion window (main.ts) once loadCustomAssets has actually finished; see
  // the emit in its reload-custom-assets listener.
  void listen('custom-assets-reloaded', () => {
    if (pendingAssetRefreshMessage !== null) {
      const message = pendingAssetRefreshMessage;
      pendingAssetRefreshMessage = null;
      void refreshAssetStatus(message);
    }
  });

  for (const id of ['reset-position', 'topbar-reset']) {
    document.getElementById(id)?.addEventListener('click', () => {
      void invoke('reset_position');
    });
  }

  document.getElementById('save-identity')?.addEventListener('click', () => {
    const name = (document.getElementById('cat-name-input') as HTMLInputElement).value;
    const personality = (document.getElementById('cat-personality-input') as HTMLTextAreaElement).value;
    void invoke('set_cat_identity', { name, personality });
    const hint = document.getElementById('identity-saved-hint');
    if (hint) {
      hint.hidden = false;
      setTimeout(() => { hint.hidden = true; }, 1500);
    }
  });

  // Committed on 'change' (pointer release), not every 'input' tick - these persist to
  // disk and broadcast an event on every call (see TrayState::persist), so firing on
  // every intermediate drag frame would mean dozens of disk writes per slider drag.
  document.querySelectorAll<HTMLInputElement>('.trait-slider input').forEach((input) => {
    input.addEventListener('change', () => {
      void invoke('set_personality_traits', { traits: readTraitSliders() });
    });
  });

  document.querySelectorAll<HTMLButtonElement>('#behavior-preset-options button').forEach((btn) => {
    btn.addEventListener('click', () => {
      void invoke('set_behavior_preset', { preset: btn.dataset.preset });
    });
  });

  void listen<number>('set-scale', (event) => setActiveSizeButton(event.payload));
  void listen<boolean>('companion-visibility', (event) => setVisibilityButtonLabel(event.payload));
  void listen<{ name: string; personality: string }>('set-cat-identity', (event) => {
    setIdentityFields(event.payload.name, event.payload.personality);
  });
  void listen<PersonalityTraits>('set-personality-traits', (event) => setTraitSliders(event.payload));
  void listen<string>('set-skin', (event) => renderSkinCards(event.payload));
  // A reload can add themes, so the card list has to be rebuilt after one - otherwise the user
  // reloads, is told it worked, and still sees no new card.
  void listen('custom-assets-reloaded', () => {
    void refreshSkinCatalogue().then(() => renderSkinCards(activeSkinId));
  });
  void listen<string>('set-camera', (event) => renderCameraOptions(event.payload));
  void listen<{ preset: BehaviorPreset; avoidRadius: number }>('set-behavior-preset', (event) =>
    setActiveBehaviorPreset(event.payload.preset),
  );

  startPerceptionPolling();
  void initClaudeAdapter();
  void initCodexAdapter();
  void initAgentPermissions();
  void renderBridgeInfo();
}

main().catch((error) => {
  console.error('[lingxi-management] startup error', error);
});
