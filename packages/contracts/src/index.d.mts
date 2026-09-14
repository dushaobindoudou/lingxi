export type TaskState = 'queued' | 'running' | 'waiting_for_user' | 'completed' | 'failed' | 'cancelled' | 'unknown';
export interface TaskEvent {
  schemaVersion: 1; provider: string; sourceId: string; taskId: string; eventId: string;
  state: TaskState; sequence: number; observedAt: number; summary?: string;
}
export interface ObserverCapabilities { snapshots: boolean; liveEvents: boolean; approvals: boolean; }
/** Observer is read-only: approval, resume, cancel and execution are deliberately absent. */
export interface TaskObserver {
  readonly provider: string;
  readonly capabilities: ObserverCapabilities;
  connect(signal: AbortSignal): Promise<void>;
  snapshot(): Promise<readonly TaskEvent[]>;
  events(signal: AbortSignal): AsyncIterable<TaskEvent>;
  disconnect(): Promise<void>;
}
export interface SkinManifest {
  schemaVersion: 1; id: string; name: string; rigId: string; status: 'planned' | 'production';
  materials: Record<string, string>;
}
export interface PersonalityManifest {
  schemaVersion: 1; id: string; name: string;
  traits: Record<'independence' | 'curiosity' | 'gentleness' | 'playfulness' | 'sleepiness', number>;
  interactionCooldownSeconds: number;
}
export function validateTaskEvent(value: unknown): Readonly<TaskEvent>;
export function taskKey(event: TaskEvent): string;
export class TaskStore {
  apply(value: unknown): boolean;
  snapshot(now: number, staleAfterMs?: number): Array<TaskEvent & { stale: boolean }>;
  forget(provider: string, sourceId: string, taskId: string): boolean;
}
export function validateSkin(value: unknown): SkinManifest;
export function validatePersonality(value: unknown): PersonalityManifest;
export function composeCompanion(skin: unknown, personality: unknown, rigId: string): { schemaVersion: 1; skin: SkinManifest; personality: PersonalityManifest };
export function taskCue(event: TaskEvent, settings?: { enabled?: boolean; quiet?: boolean; stale?: boolean }): 'none' | 'soft_glance' | 'attention_mark';
export const TASK_STATES: readonly TaskState[];
