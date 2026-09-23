/** Platform-independent domain contracts. Runtime validation is mandatory at the boundary. */
// The eight states the Rust host, the MCP tool schema and the adapters speak. This list used
// to lag them: `waiting_for_user` and `unknown` were never emitted by anything, while
// `needs_approval` - the single most urgent state an agent can raise - was rejected HERE, at
// the validation boundary, so the plugin path's permission prompts threw out of
// TaskStore.apply instead of reaching the management page. One vocabulary; this is the
// enforced one.
export const TASK_STATES = Object.freeze(['queued', 'running', 'blocked', 'needs_input', 'needs_approval', 'completed', 'failed', 'cancelled']);
const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (condition, message) => { if (!condition) throw new TypeError(message); };
const nonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export function validateTaskEvent(value) {
  assert(object(value) && value.schemaVersion === 1, 'Unsupported task event schema');
  assert(typeof value.provider === 'string' && ID.test(value.provider), 'Invalid provider');
  for (const field of ['sourceId', 'taskId', 'eventId']) assert(nonempty(value[field]), `Invalid ${field}`);
  assert(TASK_STATES.includes(value.state), 'Unknown task state');
  assert(Number.isSafeInteger(value.sequence) && value.sequence >= 0, 'Sequence must be a nonnegative integer');
  assert(Number.isFinite(value.observedAt) && value.observedAt >= 0, 'Invalid observedAt');
  assert(value.summary === undefined || (typeof value.summary === 'string' && value.summary.length <= 240), 'Summary too long');
  // Only normalized metadata crosses into the companion. Raw prompts and tool arguments stay out.
  return Object.freeze(Object.fromEntries(['schemaVersion', 'provider', 'sourceId', 'taskId', 'eventId', 'state', 'sequence', 'observedAt', 'summary'].filter(k => value[k] !== undefined).map(k => [k, value[k]])));
}
export const taskKey = e => JSON.stringify([e.provider, e.sourceId, e.taskId]);

/** Source IDs identify a stream epoch; adapters reconcile a snapshot before reconnect events. */
export class TaskStore {
  #tasks = new Map();
  apply(raw) {
    const event = validateTaskEvent(raw);
    const key = taskKey(event);
    const previous = this.#tasks.get(key);
    if (previous && (previous.eventId === event.eventId || previous.sequence >= event.sequence)) return false;
    // A sourceId is a stream EPOCH: adapters mint a new one when a connection is
    // re-established. Nothing ever calls forget(), so the old epoch's entry used to stay in
    // the store forever and the task list grew one ghost row per reconnect - all of them
    // stale except the newest. The new epoch's arrival retires its predecessors: same
    // provider, same task, superseded stream.
    for (const [k, e] of this.#tasks) {
      if (e.provider === event.provider && e.taskId === event.taskId && e.sourceId !== event.sourceId) this.#tasks.delete(k);
    }
    this.#tasks.set(key, event);
    return true;
  }
  snapshot(now, staleAfterMs = 60_000) {
    assert(Number.isFinite(now) && now >= 0 && Number.isFinite(staleAfterMs) && staleAfterMs > 0, 'Invalid freshness parameters');
    return [...this.#tasks.values()].map(event => ({ ...event, stale: now - event.observedAt > staleAfterMs }));
  }
  forget(provider, sourceId, taskId) { return this.#tasks.delete(JSON.stringify([provider, sourceId, taskId])); }
}

export function validateSkin(value) {
  assert(object(value) && value.schemaVersion === 1, 'Unsupported skin schema');
  for (const field of ['id', 'rigId']) assert(typeof value[field] === 'string' && ID.test(value[field]), `Invalid ${field}`);
  assert(nonempty(value.name), 'Skin name required');
  assert(object(value.materials) && Object.keys(value.materials).length > 0, 'Materials required');
  for (const color of Object.values(value.materials)) assert(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color), 'Invalid material color');
  assert(['planned', 'production'].includes(value.status), 'Skin status required');
  return structuredClone(value);
}
export function validatePersonality(value) {
  assert(object(value) && value.schemaVersion === 1 && typeof value.id === 'string' && ID.test(value.id), 'Invalid personality');
  assert(nonempty(value.name), 'Personality name required');
  assert(object(value.traits), 'Personality traits required');
  for (const field of ['independence', 'curiosity', 'gentleness', 'playfulness', 'sleepiness']) assert(unit(value.traits[field]), `Invalid trait ${field}`);
  assert(Number.isFinite(value.interactionCooldownSeconds) && value.interactionCooldownSeconds >= 10, 'Cooldown must be at least 10 seconds');
  return structuredClone(value);
}
export function composeCompanion(skin, personality, rigId) {
  const validatedSkin = validateSkin(skin);
  assert(validatedSkin.rigId === rigId, 'Skin is incompatible with this rig');
  return { schemaVersion: 1, skin: validatedSkin, personality: validatePersonality(personality) };
}

/** No notification by default; completion/failure/user action may create one bounded cue. */
export function taskCue(event, { enabled = false, quiet = false, stale = false } = {}) {
  validateTaskEvent(event);
  if (!enabled || quiet || stale) return 'none';
  // needs_approval is at least as attention-worthy as needs_input: a tool call is blocked
  // RIGHT NOW, and it is the state an IM notification most needs to carry (see the Rust
  // TASK_STATES comment).
  return ({ completed: 'soft_glance', failed: 'attention_mark', needs_input: 'attention_mark', needs_approval: 'attention_mark' })[event.state] ?? 'none';
}
