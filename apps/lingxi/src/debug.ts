// 调试台 ("debug console"): one window that exposes every axis the renderer has - all action
// clips, all expressions, every camera angle, every theme - plus the HTTP surface an external
// agent uses to drive the same things.
//
// Everything on this page is built from `get_capabilities`, which the companion window pushes
// up at startup from its OWN clip library (see renderer.describeCapabilities). That indirection
// is the point: a debug console hand-listing 40 clip ids would be wrong the first time someone
// edits actions.json, and a debug console that lies is worse than none.
import './debug.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const BRIDGE = 'http://127.0.0.1:47811';

interface Capabilities {
  actions?: { id: string; name: string; category: string; duration: number; expression: string; description: string }[];
  expressions?: string[];
  skins?: { id: string; name: string; description: string }[];
  performances?: { id: string; name: string; description: string; durationMs: number }[];
  toys?: { kind: string; name: string; description: string }[];
  cameras?: { id: string; name: string; description: string; elevationDeg: number }[];
}

interface Status {
  scale: number;
  visible: boolean;
  mode: string;
  skin: string;
  camera: string;
}

interface PerceptionSnapshot {
  petState?: string;
  mode?: string;
  petPosition?: { x: number; y: number };
  action?: string | null;
  toy?: { kind: string } | null;
}

const PET_STATE_LABELS: Record<string, string> = {
  idle: '站着',
  play_toy: '玩玩具',
  wander: '游走中',
  follow_cursor: '追鼠标',
  dragged: '被抓着',
  ai_directed: 'Agent 引导中',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setupTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((other) => other.classList.toggle('active', other === tab));
      document.querySelectorAll<HTMLElement>('.panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === `panel-${tab.dataset.tab}`);
      });
    });
  });
}

/** Clips grouped by their authored category, because "which 动作 exist" is a question people
 *  ask per category (清洁, 玩耍, 休息...), never as one flat list of forty. */
function renderActions(capabilities: Capabilities) {
  const host = document.getElementById('action-groups');
  if (!host) return;
  const actions = capabilities.actions ?? [];
  const byCategory = new Map<string, typeof actions>();
  for (const action of actions) {
    const key = action.category || '未分类';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(action);
  }
  host.replaceChildren(
    ...[...byCategory.entries()].map(([category, group]) => {
      const section = el('div', 'group');
      section.append(el('h2', undefined, `${category} · ${group.length}`));
      const grid = el('div', 'card-grid');
      for (const action of group) {
        const button = el('button', 'card');
        button.append(
          el('b', undefined, action.name),
          el('span', undefined, `${action.duration.toFixed(1)}s · ${action.expression}`),
          el('span', 'muted', action.description || action.id),
        );
        button.addEventListener('click', () => {
          void invoke('play_action', { id: action.id });
          flash(button);
        });
        grid.append(button);
      }
      section.append(grid);
      return section;
    }),
  );
  if (!actions.length) {
    host.replaceChildren(
      el('p', 'hint', '还没收到动作清单——说明桌宠窗口还没启动完成，或者它被隐藏了。等一两秒再打开这个窗口。'),
    );
  }
}

function renderExpressions(capabilities: Capabilities) {
  const host = document.getElementById('expression-grid');
  if (!host) return;
  host.replaceChildren(
    ...(capabilities.expressions ?? []).map((name) => {
      const chip = el('button', 'chip', name);
      chip.addEventListener('click', () => {
        void invoke('play_expression', { name, holdMs: 4000 });
        flash(chip);
      });
      return chip;
    }),
  );
}

function renderCameras(capabilities: Capabilities, active: string) {
  const host = document.getElementById('camera-grid');
  if (!host) return;
  host.replaceChildren(
    ...(capabilities.cameras ?? []).map((preset) => {
      const card = el('button', 'card');
      card.classList.toggle('active', preset.id === active);
      card.append(
        el('b', undefined, preset.id === 'auto' ? preset.name : `${preset.name} · ${preset.elevationDeg}°`),
        el('span', 'muted', preset.description),
      );
      card.addEventListener('click', () => void invoke('set_camera', { camera: preset.id }));
      return card;
    }),
  );
}

function renderSkins(capabilities: Capabilities, active: string) {
  const host = document.getElementById('skin-grid');
  if (!host) return;
  host.replaceChildren(
    ...(capabilities.skins ?? []).map((skin) => {
      const card = el('button', 'card');
      card.classList.toggle('active', skin.id === active);
      card.append(el('b', undefined, skin.name), el('span', 'muted', skin.description));
      card.addEventListener('click', () => void invoke('set_skin', { skin: skin.id }));
      return card;
    }),
  );
}

function renderToys(capabilities: Capabilities) {
  const host = document.getElementById('toy-grid');
  if (!host) return;
  const cards = (capabilities.toys ?? []).map((toy) => {
    const card = el('button', 'card');
    card.append(el('b', undefined, toy.name), el('span', 'muted', toy.description));
    card.addEventListener('click', () => {
      void invoke('set_toy', { kind: toy.kind });
      flash(card);
    });
    return card;
  });
  const away = el('button', 'card');
  away.append(el('b', undefined, '收起玩具'), el('span', 'muted', '猫下一帧就回到它自己的行为'));
  away.addEventListener('click', () => {
    void invoke('clear_toy');
    flash(away);
  });
  host.replaceChildren(...cards, away);
}

function renderPerformances(capabilities: Capabilities) {
  const host = document.getElementById('performance-grid');
  if (!host) return;
  host.replaceChildren(
    ...(capabilities.performances ?? []).map((entry) => {
      const card = el('button', 'card');
      card.append(
        el('b', undefined, entry.name),
        el('span', 'muted', entry.description),
        el('span', undefined, `${(entry.durationMs / 1000).toFixed(1)}s`),
      );
      card.addEventListener('click', () => {
        void invoke('perform', { id: entry.id });
        flash(card);
      });
      return card;
    }),
  );
}

function renderScales(active: number) {
  const host = document.getElementById('scale-grid');
  if (!host) return;
  host.replaceChildren(
    ...[0.25, 0.5, 1].map((scale) => {
      const chip = el('button', 'chip', `${scale}x`);
      chip.classList.toggle('active', Math.abs(scale - active) < 1e-9);
      chip.addEventListener('click', () => void invoke('set_scale', { scale }));
      return chip;
    }),
  );
}

/** Momentary highlight - the only feedback for "did my click reach the cat", since the cat
 *  itself lives in another window that may well be behind this one. */
function flash(node: HTMLElement) {
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 320);
}

interface ApiExample {
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  body?: unknown;
}

const API: ApiExample[] = [
  { method: 'GET', path: '/capabilities', summary: '全部动作 / 表情 / 主题 / 视角的清单。Agent 应该先读它，再用里面的 id。' },
  { method: 'GET', path: '/status', summary: '当前大小、显隐、模式、主题、视角。' },
  { method: 'GET', path: '/perception', summary: '实时快照：光标、位置、行为状态、活跃度统计。' },
  { method: 'POST', path: '/control', summary: '播放一个动作', body: { action: 'stretch-long' } },
  { method: 'POST', path: '/control', summary: '摆一个表情（4 秒后自动交还）', body: { expression: '开心', holdMs: 4000 } },
  { method: 'POST', path: '/control', summary: '换视角 + 换主题（可任意组合字段）', body: { camera: 'eye-level', skin: 'calico-poem' } },
  { method: 'POST', path: '/control', summary: '放一个毛线球（"none" 收起）', body: { toy: 'yarn' } },
  { method: 'POST', path: '/control', summary: '演一段特效：冲过来抓屏幕', body: { perform: 'angry-claw' } },
  { method: 'POST', path: '/control', summary: '让它说一句话（头顶气泡）', body: { say: '我在这儿呢' } },
  { method: 'POST', path: '/intent', summary: '建议它走到某个点（到期自动放弃，不是接管）', body: { targetPoint: { x: 400, y: 300 }, holdMs: 4000 } },
];

function renderApi(capabilities: Capabilities) {
  const host = document.getElementById('api-list');
  const output = document.getElementById('api-output');
  if (!host || !output) return;
  // Use a real clip id from the live catalogue for the example, rather than one hardcoded here
  // that may not exist in this build.
  const sampleAction = capabilities.actions?.[0]?.id;
  const examples = API.map((entry) =>
    sampleAction && entry.body && typeof entry.body === 'object' && 'action' in (entry.body as object)
      ? { ...entry, body: { action: sampleAction } }
      : entry,
  );

  host.replaceChildren(
    ...examples.map((entry) => {
      const row = el('div', 'api-row');
      const head = el('div', 'api-head');
      head.append(
        el('code', `method ${entry.method.toLowerCase()}`, entry.method),
        el('code', 'path', entry.path),
        el('span', 'muted', entry.summary),
      );
      const curl = entry.body
        ? `curl -s -X POST ${BRIDGE}${entry.path} -H 'Content-Type: application/json' -d '${JSON.stringify(entry.body)}'`
        : `curl -s ${BRIDGE}${entry.path}`;
      const pre = el('pre', 'curl', curl);
      const run = el('button', 'ghost', '试一下');
      run.addEventListener('click', async () => {
        output.textContent = '请求中…';
        try {
          const response = await fetch(`${BRIDGE}${entry.path}`, {
            method: entry.method,
            headers: entry.body ? { 'Content-Type': 'application/json' } : undefined,
            body: entry.body ? JSON.stringify(entry.body) : undefined,
          });
          const text = await response.text();
          let pretty = text;
          try {
            pretty = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            // not JSON - show it raw rather than hiding the real response
          }
          output.textContent = `${entry.method} ${entry.path} → ${response.status}\n\n${pretty}`;
        } catch (error) {
          output.textContent = `请求失败：${String(error)}`;
        }
      });
      const actions = el('div', 'api-actions');
      actions.append(run);
      row.append(head, pre, actions);
      return row;
    }),
  );
}

function renderLiveState(status: Status, snapshot: PerceptionSnapshot) {
  const host = document.getElementById('live-state');
  if (!host) return;
  const state = PET_STATE_LABELS[snapshot.petState ?? ''] ?? snapshot.petState ?? '—';
  const position = snapshot.petPosition
    ? `(${Math.round(snapshot.petPosition.x)}, ${Math.round(snapshot.petPosition.y)})`
    : '—';
  host.textContent =
    `${state} · ${position}` +
    `${snapshot.action ? ` · 正在播放 ${snapshot.action}` : ''}` +
    `${snapshot.toy ? ` · 玩具 ${snapshot.toy.kind}` : ''} · ` +
    `${status.scale}x · 视角 ${status.camera} · 主题 ${status.skin}${status.visible ? '' : ' · 已隐藏'}`;
}

async function main() {
  setupTabs();

  let capabilities = await invoke<Capabilities>('get_capabilities');
  let status = await invoke<Status>('get_status');

  function renderAll() {
    renderActions(capabilities);
    renderExpressions(capabilities);
    renderCameras(capabilities, status.camera);
    renderSkins(capabilities, status.skin);
    renderScales(status.scale);
    renderToys(capabilities);
    renderPerformances(capabilities);
    renderApi(capabilities);
  }
  renderAll();

  // The companion window may still have been booting when this window opened, in which case
  // the capability catalogue was empty. Re-ask until it isn't, rather than making the user
  // close and reopen the console.
  if (!capabilities.actions?.length) {
    const retry = setInterval(async () => {
      capabilities = await invoke<Capabilities>('get_capabilities');
      if (capabilities.actions?.length) {
        clearInterval(retry);
        renderAll();
      }
    }, 800);
    setTimeout(() => clearInterval(retry), 20000);
  }

  document.getElementById('reset-position')?.addEventListener('click', () => void invoke('reset_position'));
  document.getElementById('stop-performance')?.addEventListener('click', () => void invoke('stop_performance'));

  const sayInput = document.getElementById('say-text') as HTMLInputElement | null;
  const sendLine = () => {
    const text = sayInput?.value ?? '';
    if (!text.trim()) return;
    void invoke('say', { text });
  };
  document.getElementById('say-send')?.addEventListener('click', sendLine);
  sayInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendLine();
  });
  document.getElementById('say-hush')?.addEventListener('click', () => void invoke('say', { text: ' ' }));


  const refreshStatus = async () => {
    status = await invoke<Status>('get_status');
    renderCameras(capabilities, status.camera);
    renderSkins(capabilities, status.skin);
    renderScales(status.scale);
  };
  void listen('set-camera', refreshStatus);
  void listen('set-skin', refreshStatus);
  void listen('set-scale', refreshStatus);

  setInterval(async () => {
    try {
      const snapshot = await invoke<PerceptionSnapshot>('get_perception');
      renderLiveState(status, snapshot ?? {});
    } catch {
      // the companion window hasn't reported yet - leave the last line up rather than blanking
    }
  }, 500);
}

main().catch((error) => {
  console.error('[lingxi-debug] startup error', error);
  const host = document.getElementById('live-state');
  if (host) host.textContent = `调试台启动失败：${String(error)}`;
});
