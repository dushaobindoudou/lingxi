// A custom actions.json REPLACES the built-in library - it has to, or deleting a clip would be
// impossible. So the only way to add one clip of your own is to copy the whole library and
// append to it, and that is exactly what an agent does. The copy then freezes every built-in
// clip at the version it was taken from, and every later fix to a built-in silently stops
// reaching that machine.
//
// That is not hypothetical. The jump retune in f1c0d0f never played on the machine it was
// written for: its assets/actions.json was the 2026-09-19 library, all 49 built-ins byte for
// byte, plus four WorkBuddy clips. The cat went on jumping the old way and the fix read as
// having done nothing.
//
// The rule here is the one package managers use for config files. A built-in clip in a custom
// library that is IDENTICAL to a version the app itself once shipped was never edited - it
// follows the current bundled clip. Change a single number and it is yours, and it is left alone.
import supersededData from '../data/superseded-clips.json' with { type: 'json' };
import type { Motion } from './motion.ts';

/** Clip id -> fingerprints of every earlier bundled version of it. */
export type ClipHistory = Readonly<Record<string, readonly string[]>>;

export const SUPERSEDED: ClipHistory = (supersededData as { clips: Record<string, string[]> }).clips;

/** Key order is not content: a clip re-saved by another tool must fingerprint the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** cyrb53 over the canonical JSON. Identity, not security: nobody forges a keyframe. */
export function clipFingerprint(clip: unknown): string {
  const text = canonical(clip);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Swap every unedited stale copy of a built-in for the current bundled clip. Order, custom-only
 * clips and edited built-ins are untouched; a built-in the custom library omits stays omitted.
 */
export function followBundled(
  custom: readonly Motion[],
  bundled: readonly Motion[],
  history: ClipHistory = SUPERSEDED,
): { actions: Motion[]; upgraded: string[] } {
  const current = new Map(bundled.map((clip) => [clip.id, clip]));
  const upgraded: string[] = [];
  const actions = custom.map((clip) => {
    const latest = current.get(clip.id);
    if (!latest) return clip;
    const print = clipFingerprint(clip);
    if (print === clipFingerprint(latest) || !history[clip.id]?.includes(print)) return clip;
    upgraded.push(clip.id);
    return structuredClone(latest);
  });
  return { actions, upgraded };
}
