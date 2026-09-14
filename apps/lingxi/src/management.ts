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

type Trait = 'independence' | 'curiosity' | 'gentleness' | 'playfulness' | 'sleepiness';
type PersonalityTraits = Record<Trait, number>;
type BehaviorPreset = 'quiet' | 'balanced' | 'lively';

interface Status {
  scale: number;
  visible: boolean;
  mode: 'auto' | 'play';
  catName: string;
  catPersonality: string;
  activeAgent: string;
  knownAgents: string[];
  accessibilityTrusted: boolean;
  personalityTraits: PersonalityTraits;
  behaviorPreset: BehaviorPreset;
  knownBehaviorPresets: BehaviorPreset[];
  avoidRadius: number;
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
  mode?: 'auto' | 'play';
  activity?: {
    idleMs: number;
    cursorNearPetMs: number;
    clicksOnPet: number;
    dragCount: number;
  };
  growth?: {
    engagementScore: number;
    lifetimeInteractionCount: number;
  };
}

const PET_STATE_LABELS: Record<string, string> = {
  idle: '安静待着',
  wander: '四处走走',
  follow_cursor: '追着光标玩',
  dragged: '被抓着呢',
  ai_directed: '被建议引导中',
};

const TASK_STATE_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  waiting_for_user: '等待你',
  completed: '✓ 完成',
  failed: '✗ 失败',
  cancelled: '已取消',
  unknown: '未知',
};

function setupNav() {
  const navButtons = document.querySelectorAll<HTMLButtonElement>('.nav-item');
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navButtons.forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll<HTMLElement>('.page').forEach((page) => {
        page.classList.toggle('active', page.id === `page-${btn.dataset.page}`);
      });
    });
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

function setModeButtonLabel(mode: 'auto' | 'play') {
  const btn = document.getElementById('topbar-mode');
  if (btn) btn.textContent = mode === 'play' ? '切换到工作模式' : '切换到逗猫模式';
  const label = mode === 'play' ? '逗猫模式' : '工作模式';
  const badge = document.getElementById('home-mode-badge');
  if (badge) badge.textContent = label;
  const sidebarStatus = document.getElementById('sidebar-status');
  if (sidebarStatus) sidebarStatus.textContent = label;
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

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return '不到 1 分钟';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`;
}

function renderPerception(snapshot: PerceptionSnapshot) {
  const stateEl = document.getElementById('home-cat-state');
  if (stateEl) {
    const label = snapshot.petState ? (PET_STATE_LABELS[snapshot.petState] ?? snapshot.petState) : '还没收到状态';
    stateEl.textContent = `状态：${label}`;
  }
  const growthEl = document.getElementById('home-growth-line');
  if (growthEl && snapshot.growth) {
    const level = Math.max(1, Math.floor(snapshot.growth.engagementScore / 20) + 1);
    growthEl.textContent = `成长：Lv.${level} · 参与度 ${Math.round(snapshot.growth.engagementScore)}/100`;
  }
  const activityEl = document.getElementById('home-activity-line');
  if (activityEl && snapshot.activity) {
    const a = snapshot.activity;
    activityEl.textContent =
      `互动 ${a.clicksOnPet} 次 · 拖拽 ${a.dragCount} 次 · ` +
      `靠近陪伴 ${formatDuration(a.cursorNearPetMs)} · 距上次互动 ${formatDuration(a.idleMs)}`;
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
  const priority = (s: string) => (s === 'failed' || s === 'waiting_for_user' ? 0 : 1);
  const sorted = [...events].sort((a, b) => priority(a.state) - priority(b.state) || b.observedAt - a.observedAt);
  list.innerHTML = sorted
    .slice(0, 20)
    .map((e) => {
      const time = new Date(e.observedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const label = TASK_STATE_LABELS[e.state] ?? e.state;
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
        const homeLine = document.getElementById('home-agent-line');
        if (homeLine) {
          const label = TASK_STATE_LABELS[event.payload.state] ?? event.payload.state;
          homeLine.innerHTML = `Claude Code：<span class="badge">● 已连接</span> · 最新：${label}`;
        }
      }
    } catch {
      // validateTaskEvent rejected it (shouldn't happen - src-tauri only emits shapes it
      // built itself) - drop silently rather than crash the whole management window
    }
  });
}

async function main() {
  setupNav();
  setupAccordion();

  const status = await invoke<Status>('get_status');
  setActiveSizeButton(status.scale);
  setVisibilityButtonLabel(status.visible);
  setModeButtonLabel(status.mode);
  setIdentityFields(status.catName, status.catPersonality);
  setTraitSliders(status.personalityTraits);
  setActiveBehaviorPreset(status.behaviorPreset);
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

  document.getElementById('topbar-mode')?.addEventListener('click', async () => {
    const current = await invoke<Status>('get_status');
    void invoke('set_interaction_mode', { mode: current.mode === 'play' ? 'auto' : 'play' });
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
  void listen<'auto' | 'play'>('set-interaction-mode', (event) => setModeButtonLabel(event.payload));
  void listen<{ name: string; personality: string }>('set-cat-identity', (event) => {
    setIdentityFields(event.payload.name, event.payload.personality);
  });
  void listen<PersonalityTraits>('set-personality-traits', (event) => setTraitSliders(event.payload));
  void listen<{ preset: BehaviorPreset; avoidRadius: number }>('set-behavior-preset', (event) =>
    setActiveBehaviorPreset(event.payload.preset),
  );

  startPerceptionPolling();
  void initClaudeAdapter();
}

main().catch((error) => {
  console.error('[lingxi-management] startup error', error);
});
