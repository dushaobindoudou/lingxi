// Central icon source for the management window ("主界面").
//
// Two families, one module, so every surface in this window agrees on what an icon looks like:
//
// 1. UI glyphs — Lucide v1.48.0 (ISC License, https://lucide.dev), stroke icons inlined as
//    strings so they inherit `currentColor`. Only the glyphs this window actually uses are
//    vendored here; add a new one by copying its inner markup from lucide-static's icons/
//    directory into LUCIDE_PATHS.
// 2. Agent brand marks — the same SVG files the host integrations ship under
//    integrations/hosts/*, imported as build-time asset URLs, so the main window and the
//    installed plugin present one identity per host. Codex and DSH previously had no mark
//    anywhere; theirs are simple-icons (CC0 4.0, https://simpleicons.org) with the brand
//    colour baked in, stored beside the others.
//
// Marks render as <img>, not inline markup — deliberately the same choice the bubble marks
// made (stage-fx.ts): an <img> is a hard sandbox for SVG, and every mark file is
// self-coloured so it needs no CSS recolouring to stay legible. Each mark pairs with a chip
// (`chip`) that the caller paints as the element's background — Cursor's near-white cube
// needs the dark ink chip, the others sit on tints of their own brand colour.
//
// `agentMark(id)` resolves an arbitrary agent id (registry id, event provider, ...) to a
// known host by the same substring heuristic the row navigation already uses (agentTarget in
// management.ts) - so "claude", "Claude Code" and "LINGXI_AGENT=claude" all land on one mark.
// Unknown ids have no mark; callers fall back to the two-letter badge they already render.

import claudeMarkUrl from '../../../../integrations/hosts/claude/assets/claude-mark.svg';
import codexMarkUrl from '../../../../integrations/hosts/codex/codex-mark.svg';
import cursorMarkUrl from '../../../../integrations/hosts/cursor/cursor-mark.svg';
import dshMarkUrl from '../../../../integrations/hosts/dsh/dsh-mark.svg';
import workbuddyMarkUrl from '../../../../integrations/hosts/workbuddy/workbuddy-mark.svg';

export type IconName =
  | 'house'
  | 'bot'
  | 'heart'
  | 'gamepad-2'
  | 'palette'
  | 'settings'
  | 'chevron-down'
  | 'chevron-right';

/** Inner markup of Lucide v1.48.0 stroke icons, wrapped in the shared shell below. */
const LUCIDE_PATHS: Record<IconName, string> = {
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
  bot: '<path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />',
  heart: '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />',
  'gamepad-2': '<line x1="6" x2="10" y1="11" y2="11" /><line x1="8" x2="8" y1="9" y2="13" /><line x1="15" x2="15.01" y1="12" y2="12" /><line x1="18" x2="18.01" y1="10" y2="10" /><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />',
  palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" />',
  'chevron-down': '<path d="m6 9 6 6 6-6" />',
  'chevron-right': '<path d="m9 18 6-6-6-6" />',
};

/** A Lucide glyph as a standalone SVG that inherits `currentColor`. */
export function uiIcon(name: IconName): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE_PATHS[name]}</svg>`;
}

export interface AgentMark {
  /** Substring matched (case-insensitively) against agent ids and provider names. */
  key: string;
  /** Human label, for title/alt text. */
  label: string;
  /** Chip background behind the mark. */
  chip: string;
  /** Build-time asset URL of the self-coloured mark SVG. */
  url: string;
}

const AGENT_MARKS: AgentMark[] = [
  { key: 'claude', label: 'Claude Code', chip: '#F6E3D6', url: claudeMarkUrl },
  { key: 'codex', label: 'Codex', chip: '#ECEAE6', url: codexMarkUrl },
  { key: 'dsh', label: 'DeepSeek Harness', chip: '#E7ECFF', url: dshMarkUrl },
  { key: 'cursor', label: 'Cursor', chip: '#2F2A33', url: cursorMarkUrl },
  { key: 'workbuddy', label: 'WorkBuddy', chip: '#0AC89F', url: workbuddyMarkUrl },
];

/** The mark for a known host agent, or undefined - callers keep their letter-badge fallback. */
export function agentMark(id: string): AgentMark | undefined {
  const normalized = id.toLowerCase();
  return AGENT_MARKS.find(
    (mark) =>
      normalized.includes(mark.key) ||
      (mark.key === 'dsh' && (normalized.includes('deepseek') || normalized.includes('harness'))),
  );
}

/** What an agent is shown as, anywhere - the bubble on the cat and every row in 主界面. */
export interface AgentLook {
  /** The display name: a known host's own name ("Claude Code") over a bare id ("claude"). */
  name: string;
  /** Image source for the icon, or null when only the letter badge is available. */
  src: string | null;
  /** Background behind the icon or badge. */
  chip: string;
  /** Up to two characters, for when there is no image (or it fails to load). */
  badge: string;
}

export interface AgentLookInput {
  id: string;
  provider?: string;
  name?: string;
  badge?: string;
  logo?: string | null;
  color?: string;
}

/**
 * The ONE rule for how an agent looks, so the cat's bubble and 主界面 can never disagree:
 *
 *   1. a known host (Claude Code, Codex, ...) -> the mark this app ships for it. A registered
 *      logo does not override it: registration is self-description, and it has already been
 *      wrong in practice (Claude registered wearing WorkBuddy's penguin from a shared file);
 *   2. any other agent -> the logo it registered, if it registered one;
 *   3. otherwise -> its two-letter badge on its colour.
 */
export function agentLook(input: AgentLookInput): AgentLook {
  const mark = agentMark(input.id) ?? (input.provider ? agentMark(input.provider) : undefined);
  const raw = input.name?.trim() ?? '';
  const bareId = !raw || raw === input.id || (mark !== undefined && raw.toLowerCase() === mark.key);
  const name = mark && bareId ? mark.label : raw || input.id;
  const badge = (input.badge?.trim() || input.id.slice(0, 2)).slice(0, 2);
  if (mark) return { name, src: mark.url, chip: mark.chip, badge };
  if (input.logo) {
    const src = input.logo.startsWith('data:')
      ? input.logo
      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(input.logo)}`;
    return { name, src, chip: input.color || '#EFE6DA', badge };
  }
  return { name, src: null, chip: input.color || '#8b7865', badge };
}

/**
 * The icon for a look, as a round chip element: an <img> (a sandbox for agent-supplied SVG, as
 * on the bubble) that falls back to the letter badge if the image cannot be decoded.
 */
export function agentChip(look: AgentLook, className: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = className;
  chip.title = look.name;
  chip.style.backgroundColor = look.chip;
  const letters = () => {
    chip.replaceChildren(look.badge);
    chip.classList.add('agent-chip-letters');
  };
  if (look.src) {
    const img = document.createElement('img');
    img.src = look.src;
    img.alt = '';
    img.draggable = false;
    img.addEventListener('error', letters);
    chip.append(img);
  } else {
    letters();
  }
  return chip;
}
