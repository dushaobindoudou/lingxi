// The tool surface an agent sees.
//
// Kept deliberately small. An agent driving a desktop pet does not need forty knobs; it needs
// to be able to answer "what can this thing do", "what is it doing", and then to express
// something. Every tool here maps to one intention, and the descriptions are written for the
// agent rather than for a human reading source - they are the only documentation the model gets.
import { bridge } from './bridge.mjs';

/** Trim a tool result to something a model can actually read without burning its context. */
function ok(summary, data) {
  return { summary, ...(data === undefined ? {} : { data }) };
}

export const tools = [
  {
    name: 'lingxi_capabilities',
    description:
      'List everything the cat can be asked to do: every action clip (with its category and ' +
      'duration), every expression, every theme, every camera angle, every toy and every ' +
      'full-screen performance. CALL THIS FIRST and use ids from it - the library is ' +
      'user-editable, so ids differ between installs and hardcoding them will fail.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const caps = await bridge.capabilities();
      return ok('The cat\'s current capability set.', {
        actions: (caps.actions ?? []).map((a) => ({ id: a.id, name: a.name, category: a.category, duration: a.duration, source: a.source })),
        // `source` says which of these the USER wrote. It matters because actions.json and
        // expressions.json are replaced wholesale: an agent adding a clip has to start from the
        // user's file if there is one, or it silently deletes everything they authored.
        expressions: caps.expressions ?? [],
        assets: caps.assets ?? null,
        performances: (caps.performances ?? []).map((p) => ({ id: p.id, name: p.name, description: p.description })),
        toys: caps.toys ?? [],
        cameras: (caps.cameras ?? []).map((c) => c.id),
        skins: (caps.skins ?? []).map((s) => ({ id: s.id, name: s.name, source: s.source })),
      });
    },
  },
  {
    name: 'lingxi_state',
    description:
      'What the cat is doing right now: where it is on screen, whether it is walking, resting, ' +
      'playing with a toy or being dragged, which clip is playing, and how engaged the user has ' +
      'been. Use it to avoid interrupting - do not fire a full-screen performance at someone ' +
      'who is mid-drag.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const [status, perception] = await Promise.all([bridge.status(), bridge.perception()]);
      return ok('Current state.', { status, perception });
    },
  },
  {
    name: 'lingxi_say',
    description:
      'Put one short line in a comic speech bubble above the cat\'s head. This is the cat ' +
      'talking, so write it as the cat: short, warm, first person. Not a place for status dumps ' +
      '- one sentence, and never more than about 40 characters if you want it read at a glance.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What the cat says. Max 140 chars; shorter is better.' },
        seconds: { type: 'number', description: 'How long to leave it up. Defaults to a length-based guess.' },
      },
      required: ['text'],
    },
    async run({ text, seconds }) {
      const result = await bridge.control({ say: text, ...(seconds ? { sayMs: Math.round(seconds * 1000) } : {}) });
      // The bridge reports what it actually did with the text, including any truncation. This
      // used to echo the caller's own string back unconditionally, so a 150-character line came
      // back in full while the cat displayed 140 - the model then told the user something the
      // cat never said.
      return ok(`Said: ${result.saidText ?? text}${result.truncated ? ` (truncated to ${result.saidText.length} characters - the bubble holds no more)` : ''}`);
    },
  },
  {
    name: 'lingxi_express',
    description:
      'Set the cat\'s face and/or play one action clip. This is the main way to reflect how work ' +
      'is going without saying anything: 认真 while building, 开心 on a green test run, 不爽 on a ' +
      'failure. Use ids from lingxi_capabilities.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Expression name, e.g. 开心 / 认真 / 不爽.' },
        action: { type: 'string', description: 'Action clip id, e.g. paw-wave / stretch-front.' },
        seconds: { type: 'number', description: 'How long to hold the expression.' },
      },
    },
    async run({ expression, action, seconds }) {
      if (!expression && !action) throw new Error('Give an expression, an action, or both.');
      const result = await bridge.control({
        ...(expression ? { expression, holdMs: Math.round((seconds ?? 4) * 1000) } : {}),
        ...(action ? { action } : {}),
      });
      return ok(`Applied: ${result.applied?.join(', ')}`);
    },
  },
  {
    name: 'lingxi_perform',
    description:
      'Run one of the scripted full-screen set pieces (it charges the screen, speed lines, ' +
      'impact flash, the lot). These take over the screen for several seconds, so save them for ' +
      'moments that earn it - a long build finally going green, not every file write.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Performance id from lingxi_capabilities.' } },
      required: ['id'],
    },
    async run({ id }) {
      const result = await bridge.control({ perform: id });
      return ok(`Performing ${id}.`);
    },
  },
  {
    name: 'lingxi_play',
    description:
      'Put a toy on the desktop or take it away. The cat drops what it is doing and plays with ' +
      'it: the yarn ball arrives on the pointer to be thrown, the wand is chased and jumped at, ' +
      'the laser is chased and never caught. Good for "you have been at this for two hours".',
    inputSchema: {
      type: 'object',
      properties: { toy: { type: 'string', enum: ['yarn', 'feather', 'laser', 'none'] } },
      required: ['toy'],
    },
    async run({ toy }) {
      const result = await bridge.control({ toy });
      return ok(toy === 'none' ? 'Put the toy away.' : `Put out the ${toy}.`);
    },
  },
  {
    name: 'lingxi_remember',
    description:
      'Write one thing the cat should remember about its owner. This is what makes it feel like ' +
      'it knows them over time. Write ONE fact per call, in plain language, as an observation: ' +
      '"prefers TypeScript over JS", "works late on Thursdays", "gets frustrated by flaky tests". ' +
      'Do not store secrets, credentials, or anything the user would not want written to a plain ' +
      'file on their disk - this is saved as readable JSON they can open.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'One fact, one sentence.' },
        kind: {
          type: 'string',
          enum: ['owner', 'project', 'preference', 'moment'],
          description: 'owner = about the person, project = about what they are building, preference = how they like to work, moment = something that happened.',
        },
      },
      required: ['text'],
    },
    async run({ text, kind }) {
      await bridge.remember(text, kind ?? 'moment');
      return ok(`Remembered: ${text}`);
    },
  },
  {
    name: 'lingxi_recall',
    description:
      'Everything the cat currently remembers about its owner, plus how many tasks it has seen ' +
      'through with them. Read this before deciding how to greet them or what to bring up.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const memory = await bridge.memory();
      return ok(`${memory.notes?.length ?? 0} notes, ${memory.completed_tasks ?? 0} tasks completed together.`, memory);
    },
  },
  {
    name: 'lingxi_remind',
    description:
      'Have the cat bring something up later. It surfaces as the cat looking up and saying the ' +
      'line, not as a system notification - so phrase it as the cat would. Use it for the thing ' +
      'the user said they would come back to and probably will not.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What the cat should say when the time comes.' },
        inMinutes: { type: 'number', description: 'How long from now. Use this OR dueAt.' },
        dueAt: { type: 'number', description: 'Unix milliseconds. Use this OR inMinutes.' },
      },
      required: ['text'],
    },
    async run({ text, inMinutes, dueAt }) {
      if (inMinutes == null && dueAt == null) throw new Error('Give inMinutes or dueAt.');
      const result = await bridge.remind(text, dueAt != null ? { dueAt } : { inMinutes });
      return ok(`Reminder set (${result.id}).`);
    },
  },
  {
    name: 'lingxi_look',
    description:
      'Change how the cat is framed: camera angle and theme. Mostly cosmetic, but the camera ' +
      'genuinely changes how much of its face you can see - 仰视 and 平视 read as eye contact, ' +
      'game and overhead read as watching it go about its business.',
    inputSchema: {
      type: 'object',
      properties: {
        camera: { type: 'string', description: 'Camera preset id from lingxi_capabilities.' },
        skin: { type: 'string', description: 'Theme id from lingxi_capabilities.' },
      },
    },
    async run({ camera, skin }) {
      if (!camera && !skin) throw new Error('Give a camera, a skin, or both.');
      const result = await bridge.control({ ...(camera ? { camera } : {}), ...(skin ? { skin } : {}) });
      return ok(`Applied: ${result.applied?.join(', ')}`);
    },
  },
  {
    name: 'lingxi_register',
    description:
      'Register yourself with the cat, once, at the start of a session. Pick ONE emoji and a '
      + 'colour that represent you and keep using them - that badge is how the user tells your '
      + "reactions apart from another agent's when several drive the same cat. Call this first.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Stable id for you, e.g. "claude-code".' },
        name: { type: 'string', maxLength: 24, description: 'Display name.' },
        badge: { type: 'string', description: 'One emoji you choose for yourself.' },
        color: { type: 'string', description: 'Badge ring colour, #rgb or #rrggbb.' },
      },
      required: ['id'],
    },
    async run({ id, name, badge, color }) {
      const result = await bridge.register({ id, name, badge, color });
      return ok(`Registered as ${result.agent?.badge ?? ''} ${result.agent?.name ?? id}.`, result.agent);
    },
  },
  {
    name: 'lingxi_task',
    description:
      'Report what your work is DOING and let the cat decide how to show it. Preferred over '
      + 'picking expressions yourself: the user can retune the state-to-reaction mapping once '
      + 'and have it apply to every agent, and you do not need to know the clip library. Send '
      + 'one whenever a task changes state.',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          enum: ['queued', 'running', 'blocked', 'needs_input', 'completed', 'failed', 'cancelled'],
        },
        kind: {
          type: 'string',
          enum: ['build', 'test', 'deploy', 'review', 'search', 'write', 'chat', 'other'],
        },
        taskId: { type: 'string', description: 'Stable id for this piece of work.' },
        summary: { type: 'string', maxLength: 240, description: "One line, in the user's language." },
        agent: { type: 'string', description: 'Your registered id.' },
      },
      required: ['state'],
    },
    async run({ state, kind, taskId, summary, agent }) {
      const result = await bridge.taskEvent({
        state,
        kind,
        taskId,
        summary,
        agent,
        provider: agent ?? 'mcp',
      });
      return ok(
        result.recorded === false
          ? `Not recorded: ${result.reason ?? 'unrecognised event'}`
          : `Reported ${kind ?? 'other'} ${state}.`,
      );
    },
  },
  {
    name: 'lingxi_reload_assets',
    description:
      "Re-read the user's assets folder after writing actions.json / expressions.json / "
      + 'skins.json / reactions.json, and report what loaded and what failed validation. '
      + 'IMPORTANT: actions.json and expressions.json are replaced WHOLESALE - check '
      + 'lingxi_capabilities for source:"custom" first and build on the user\'s existing file '
      + 'if there is one, or you will delete their work.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      await bridge.reloadAssets();
      await new Promise((resolve) => { setTimeout(resolve, 600); }); // the reload is asynchronous
      const status = await bridge.assets();
      return ok(
        status.lastErrors?.length
          ? `Reloaded with ${status.lastErrors.length} problem(s).`
          : 'Reloaded cleanly.',
        status,
      );
    },
  },
];

export const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
