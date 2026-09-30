// The tool surface an agent sees.
//
// Kept deliberately small. An agent driving a desktop pet does not need forty knobs; it needs
// to be able to answer "what can this thing do", "what is it doing", and then to express
// something. Every tool here maps to one intention, and the descriptions are written for the
// agent rather than for a human reading source - they are the only documentation the model gets.
import { bridge, autoStartNotice } from './bridge.mjs';

/** Trim a tool result to something a model can actually read without burning its context. */
function ok(summary, data) {
  return { summary, ...(data === undefined ? {} : { data }) };
}

/**
 * Append the attribution warning, if the server could not register the identity it speaks for.
 *
 * Silent degradation is the thing to avoid: a reaction that shows up with the neutral two-letter
 * fallback badge instead of the caller's own looks, from the model's side, exactly like success.
 */
function attributed(summary) {
  const notes = [];
  // Said once, on the first result after we started the app. The model should know the cat was
  // not there a moment ago - it changes whether "no reaction" is a bug or a cold start, and it
  // is the sort of thing worth mentioning to the user once rather than silently doing.
  const started = autoStartNotice();
  if (started) notes.push(started);
  const warning = bridge.identityWarning();
  if (warning) notes.push(warning);
  return notes.length ? `${summary} (${notes.join('; ')})` : summary;
}

/**
 * The `priority` knob, mirroring the field the app reads on POST /control.
 *
 * The app quietly rewrites an unrecognised value to "status"; declaring the enum here means a
 * typo is refused by the schema the model reads instead of being silently downgraded. Every
 * stage-contending tool defaults to the priority that fits it, so the common case needs no
 * thought - pass one only when this particular reaction is unusually urgent or unusually cheap.
 */
const PRIORITY = {
  type: 'string',
  enum: ['ambient', 'status', 'report', 'alert'],
  description:
    'How much the user needs to see this, when another agent is already driving the cat. ' +
    'ambient = atmosphere, droppable; status = something changed; report = something finished; ' +
    'alert = the user must look now. Defaults to the right one for this tool. A reaction that ' +
    'does not outrank what is already playing is DROPPED rather than queued - that is intended, ' +
    'do not retry it.',
};

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
        priority: PRIORITY,
      },
      required: ['text'],
    },
    async run({ text, seconds, priority }) {
      const result = await bridge.control({
        say: text,
        ...(seconds ? { sayMs: Math.round(seconds * 1000) } : {}),
        priority: priority ?? 'status',
      });
      // The bridge reports what it actually did with the text, including any truncation. This
      // used to echo the caller's own string back unconditionally, so a 150-character line came
      // back in full while the cat displayed 140 - the model then told the user something the
      // cat never said.
      return ok(
        attributed(
          `Said: ${result.saidText ?? text}${result.truncated ? ` (truncated to ${result.saidText.length} characters - the bubble holds no more)` : ''}`,
        ),
      );
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
        priority: PRIORITY,
      },
    },
    async run({ expression, action, seconds, priority }) {
      if (!expression && !action) throw new Error('Give an expression, an action, or both.');
      const result = await bridge.control({
        ...(expression ? { expression, holdMs: Math.round((seconds ?? 4) * 1000) } : {}),
        ...(action ? { action } : {}),
        priority: priority ?? 'status',
      });
      return ok(attributed(`Applied: ${result.applied?.join(', ')}`));
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
      properties: {
        id: { type: 'string', description: 'Performance id from lingxi_capabilities.' },
        priority: PRIORITY,
      },
      required: ['id'],
    },
    async run({ id, priority }) {
      await bridge.control({ perform: id, priority: priority ?? 'report' });
      return ok(attributed(`Performing ${id}.`));
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
      properties: {
        toy: { type: 'string', enum: ['yarn', 'feather', 'laser', 'none'] },
        priority: PRIORITY,
      },
      required: ['toy'],
    },
    async run({ toy, priority }) {
      await bridge.control({ toy, priority: priority ?? 'status' });
      return ok(attributed(toy === 'none' ? 'Put the toy away.' : `Put out the ${toy}.`));
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
      'line, not as a system notification - so phrase it as the cat would. Set one without being ' +
      'asked when the user says they will do something later ("等下", "明天", "开完会"), when you ' +
      'see something with a deadline (a meeting, an expiring cert), or after hours of unbroken ' +
      'work (a tender 45-minute break). Tell them you set it. A reminder that comes due while ' +
      'nobody is at the machine waits until they are back. For a standing one ("every day at ' +
      '09:30", "every hour") give dueAt for the first time and repeatEveryMinutes; it keeps its ' +
      'own schedule.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'What the cat should say when the time comes.' },
        inMinutes: { type: 'number', description: 'How long from now. Use this OR dueAt.' },
        dueAt: { type: 'number', description: 'Unix milliseconds. Use this OR inMinutes.' },
        mood: {
          type: 'string',
          enum: ['focused', 'proud', 'tender', 'sad', 'frustrated', 'anxious', 'weary', 'playful', 'curious'],
          description: 'The tone it is delivered in: tender for "drink some water", anxious for "taxes are due".',
        },
        repeatEveryMinutes: {
          type: 'number',
          description: 'Make it a standing reminder that re-arms itself (minimum 5). 1440 = daily at the same time.',
        },
      },
      required: ['text'],
    },
    async run({ text, inMinutes, dueAt, mood, repeatEveryMinutes }) {
      if (inMinutes == null && dueAt == null) throw new Error('Give inMinutes or dueAt.');
      const when = dueAt != null ? { dueAt } : { inMinutes };
      const extra = {
        ...(mood ? { mood } : {}),
        ...(repeatEveryMinutes ? { repeatEveryMinutes } : {}),
      };
      const result = await bridge.remind(text, { ...when, ...extra });
      const due = new Date(dueAt ?? Date.now() + inMinutes * 60_000).toLocaleString();
      return ok(
        `Reminder set (${result.id}) for ${due}` +
          (repeatEveryMinutes ? `, repeating every ${repeatEveryMinutes} min` : '') + '.',
      );
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
      'Register yourself with the cat: a name, a badge emoji and a colour. That badge is how the '
      + 'user tells your reactions apart from another agent\'s when several drive the same cat, '
      + "so pick ONE emoji and keep it. If this server has a configured id to speak as "
      + '(~/.lingxi/agent.json, or LINGXI_AGENT), registration already happens automatically '
      + 'before every reaction and you do not need to call this - reach for it only to change '
      + 'that identity or to set a logo.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Stable id for you, e.g. "claude-code". Defaults to the id this server is configured with (~/.lingxi/agent.json), which is the one your reactions are already signed with.' },
        name: { type: 'string', maxLength: 24, description: 'Display name.' },
        badge: { type: 'string', description: 'One emoji you choose for yourself. Max 2 characters.' },
        color: { type: 'string', description: 'Badge ring colour, #rgb or #rrggbb.' },
        logo: {
          type: 'string',
          description:
            'A mark to show next to the cat when it speaks for you: a small flat SVG document ' +
            '(starting with <svg) or a data:image/(svg+xml|png|webp) URI. No <script>, no external ' +
            'hrefs, no <image> - they are refused. Readable at 22px.',
        },
      },
    },
    async run({ id, name, badge, color, logo }) {
      const target = (id ?? bridge.agentId() ?? '').trim();
      if (!target) throw new Error('Give an id, or configure one for this server in ~/.lingxi/agent.json.');
      const result = await bridge.register({ id: target, name, badge, color, logo });
      return ok(
        `Registered as ${result.agent?.badge ?? ''} ${result.agent?.name ?? target}.`,
        result.agent,
      );
    },
  },
  {
    name: 'lingxi_task',
    description:
      'Report what your work is DOING and let the cat decide how to show it. Preferred over '
      + 'picking expressions yourself: the user can retune the state-to-reaction mapping once '
      + 'and have it apply to every agent, and you do not need to know the clip library. Send '
      + 'one whenever a task changes state. Sending `mood` alongside is what separates a status '
      + 'light from a pet - it is the one thing only you can supply.',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          type: 'string',
          // The same eight the app, the schema and the adapter speak - `needs_approval` was
          // added everywhere but here, and a model reading only this enum would never send
          // the one state that means "a tool call is blocked on the user, right now".
          enum: ['queued', 'running', 'blocked', 'needs_input', 'needs_approval', 'completed', 'failed', 'cancelled'],
        },
        kind: {
          type: 'string',
          enum: ['build', 'test', 'deploy', 'review', 'search', 'write', 'chat', 'other'],
        },
        mood: {
          type: 'string',
          enum: ['focused', 'proud', 'tender', 'sad', 'frustrated', 'anxious', 'weary', 'playful', 'curious'],
          description:
            'How the work FEELS, in one word. This is the dimension that makes the cat answer a ' +
            'person rather than a process - and you are the only one who can judge it, because ' +
            'you have the content. Send it whenever you can. The cat does not mirror the mood: ' +
            'frustrated is met with comfort, weary with an invitation to stop, anxious with ' +
            'steadiness. Only the good moods are joined.',
        },
        taskId: { type: 'string', description: 'Stable id for this piece of work.' },
        summary: { type: 'string', maxLength: 240, description: "One line, in the user's language." },
        agent: { type: 'string', description: 'Override who this is reported as. Defaults to the id this server is configured with - only set it to speak as someone else.' },
      },
      required: ['state'],
    },
    async run({ state, kind, mood, taskId, summary, agent }) {
      const who = agent ?? bridge.agentId();
      const result = await bridge.taskEvent({
        state,
        kind,
        mood,
        taskId,
        summary,
        agent,
        provider: who ?? 'mcp',
      });
      return ok(
        attributed(
          result.recorded === false
            ? `Not recorded: ${result.reason ?? 'unrecognised event'}`
            : `Reported ${kind ?? 'other'} ${state}${mood ? ` (${mood})` : ''}.`,
        ),
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
