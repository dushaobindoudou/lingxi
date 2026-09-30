<!-- English translation of `docs/02-product-and-mvp.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Product and MVP

> Historical baseline (2026-09-10): the product is now named Lingxi, and the user requires real-time 3D as the goal. The latest decisions are in the [real-time 3D decision](decisions/001-realtime-desktop.md), [brand design](08-brand-and-design-system.md), and [extension architecture](09-extension-architecture.md). Older recommendations that conflict with the new decisions no longer apply.

Status: suggested scope, not yet approved. Phase names are in [Milestones](06-roadmap-and-decisions.md).

## 1. Experience principles

- Cat first: gentle, independent, lazy, curious. It does not suddenly turn into a customer-service-style assistant.
- Quiet by default: proactive interaction needs a reason, has a cooldown, and can be turned off. Care is not demanded through guilt.
- Continuous motion: playable transitions exist between poses. An interrupt must fit the current action.
- Do not interfere with work: the cat does not steal input focus, does not intercept unrelated areas, and can be hidden or quit at any time.
- It can still live with no network: time, basic interaction, and the behavior loop work locally.

The original line "companionship 70%, autonomous life 20%, interaction 8%, language 2%" has overlapping categories. It is kept as a direction for restrained expression, and is not implemented as an exact time allocation. If language is enabled later, "0–5 sentences a day" is only a candidate cap on proactive speech, not a quota that must be filled.

## 2. Scope layers

| Capability | P0: feasibility prototype | M1: companionship MVP | M2: relationship validation |
| --- | --- | --- | --- |
| Character | One test cat, same-source comparison samples | One identity-frozen Peipei | Keep the same character |
| Behavior | A closed loop of lying down, sleeping, waking, and looking | Add curiosity, self-grooming, and a light approach | Individual preferences and slow relationship change |
| Interaction | Local mouse stimulus | Head petting, drag to place, ignoring and cooldown | Expand body regions as needed |
| Desktop | Technical verification of transparency, always-on-top, and click-through | Settings, hide, quit, position restore | More desktop situations |
| Perception | Local time, input on the cat region | Same as the left; a global pointer is chosen only after validation passes | User-authorized activity summaries |
| Persistence | May be absent | Position, settings, basic life state | Semantic memory that can be viewed and deleted |
| LLM | None | Not required | Low-frequency intent and optional short lines |

The suggestion is to validate on macOS first, with Windows as a later target. This order is proposed from the current development environment. It is not an already settled platform commitment.

## 3. The concrete M1 experience

| Situation | User action or condition | What Peipei does | Done when |
| --- | --- | --- | --- |
| First launch | Open the app | Appears in a safe screen region and starts a quiet idle | Hide, quit, and settings can be found |
| Work companionship | The user does not interact with the cat | Sleeps, wakes, and watches on its own, with actions joining naturally | No proactive dialogue pops up, and focus is not stolen |
| Watching the mouse | The pointer enters a perceivable region | Occasionally looks in a limited direction, and is also allowed to ignore it | An action is not triggered on every pointer event |
| Petting | The pointer stays or moves lightly in the head region | Squints or relaxes after a short delay | A brief pass-by does not trigger often; dragging and petting are mutually exclusive |
| Moving it | Drag the cat | Autonomous movement pauses; after release it settles in a safe region | Position can be restored, and it can still be found after a multi-monitor change |
| Night | Local time enters the night interval | Sleep weight increases | A manual time-of-day configuration can override the default schedule |
| Pausing companionship | Hide, lock screen, or system sleep | Meaningless rendering and decisions stop | After wake it resumes smoothly and does not replay a backlog of interactions |

“靠近你” (come near you), in the first version, means approaching a desktop resting point the user specified. It does not mean knowing where the user's body is. M1 autonomous displacement is enabled only after trustworthy locomotion animation exists and has passed acceptance. Otherwise it stays in place and watches.

## 4. Not in M1 for now

Full 360° interaction, jumping onto and climbing real windows, continuously chasing the mouse, voice, microphone reactions, reading screen content, a feeding economy, multiple pets, a shop, and account cloud sync. "Turn the ears when it hears a sound," from the materials, can first appear as an autonomous micro-action, without implying that a microphone is enabled.

## 5. How to accept it

The following are suggested small-scale validation thresholds, not market evidence: invite 5–8 target users to try it for a week under informed consent, and collect feedback by interview or manual notes.

| Goal | How to check | Suggested pass condition |
| --- | --- | --- |
| Want to look at it | 30 seconds of unguided observation on first sight | At least 4/5 users are willing to keep it on the desktop |
| Feels like the same cat | Compare every delivered clip and transition | No obvious drift in face shape, markings, or body type |
| Natural | Watch for 10 minutes and stimulate it on purpose | No pose pops; no response to every input; no continuous state jitter |
| Not in the way | 30 minutes of continuous office work | No unexpected focus steal, no transparent-area interception, no inability to quit |
| Not annoying | Interview after one week, plus self-reported use | Most are still willing to leave it on; record every reason for closing it |
| Stable and energy-saving | Test on a specified device | Meets the budget in the technical document once that budget has been fixed by benchmarks |

The original phrases “别吵它” (leave it alone) and “你刚才在干嘛” (what were you just doing) are feelings the open interviews hope to hear. Do not use leading questions that ask users to repeat them. The sample is only for finding problems. It is not for claiming a general retention rate or willingness to pay.
