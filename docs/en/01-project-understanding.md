<!-- English translation of `docs/01-project-understanding.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Project Understanding and Analysis

> Historical baseline (2026-09-10): the product is now named Lingxi, and the user requires real-time 3D as the goal. The latest decisions are in the [real-time 3D decision](decisions/001-realtime-desktop.md), [brand design](08-brand-and-design-system.md), and [extension architecture](09-extension-architecture.md). Older recommendations that conflict with the new decisions no longer apply.

## 1. The core of the project

Peipei's value is this: without the user having to keep typing, caregiving, or talking, they can still feel a familiar small life nearby. A stable appearance lets the user recognize "my cat"; natural motion makes the user willing to look; continuous behavior lets the relationship accumulate.

Four original directions can be drawn from the materials:

1. **The same cat**: face, markings, proportions, and temperament stay consistent across actions.
2. **Quiet companionship**: most of the time it sleeps, zones out, or grooms itself; the user controls how intense the interaction is.
3. **Autonomy**: it may ignore a stimulus, lose interest, or change posture; behavior has context.
4. **Long-term continuity**: opening it again, it is still the familiar Peipei; the relationship does not depend on chatting from scratch each time.

"Digital life" here is an experience goal. It does not mean the product has consciousness or real emotions. "Worrying about the user" should be implemented as restrained behavioral expression, not as a claim that the system has accurately recognized the user's psychological state.

## 2. Users and the value hypothesis

The suggested people to validate first are those who work or study at a computer for long stretches, like cats, and are willing to accept a character that stays on the desktop. There are no user interviews, demand-size figures, competitive research, or payment data to support this, so the target-audience description cannot be treated as a market conclusion.

The core job to be done is: "When I am working alone, I want a little warmth and a sense of life nearby, but I do not want another task I have to take care of."

What needs validating is not whether users find the pictures cute, but whether they are willing to leave it on the desktop continuously and still open it on their own a week later.

## 3. How the product capabilities relate

| Layer | Role | Experience when it fails |
| --- | --- | --- |
| Character identity | Appearance, markings, and personality boundaries stay stable | Feels like the cat keeps being swapped |
| Visuals | Soft silhouette, fur, eyes, light and shadow | Feels like an ordinary model |
| Motion | Breathing, center of mass, gaze delay, natural transitions | Feels like mechanical animation |
| Behavior | Schedule, cooldowns, preferences, autonomous choice | Feels like a fixed loop |
| Desktop coexistence | Does not steal focus, can be click-through, can be hidden, saves energy | Gets in the way of work and is closed |
| Long-term relationship | Remembers position, preferences, and a small amount of interaction | Every time feels like the first use |

The materials treat the Cat Life Engine as a moat. That is a worthwhile direction, but the moat still has to be accumulated through behavior tuning, asset quality, and long-term usage feedback. An architecture diagram cannot prove it directly.

## 4. Places the original materials need correcting

| Original wording or disagreement | Analysis and the conclusion after sorting it out |
| --- | --- |
| An earlier recommendation of full real-time Groom, a later recommendation of prerender, then a proposal of a prerendered body with real-time eyes, ears, and tail | These are three routes of different complexity. Make comparison samples first. Do not stack the three together and treat that as the low-cost default. |
| Prerender plus a state graph will not look like a GIF | A state graph only solves ordering. Clip variants, seams, duration, and context together decide whether it feels like a loop. |
| Real-time head turns, ears, and tail on top of a prerendered body | Ordinary flat frames have no skeleton that can be controlled independently. That needs layers, occlusion, and lighting match, or a switch to a real-time model. |
| 5 core states, 20 or 25 actions, plus another 20 variants | States and actions are not the same unit. Suggested approach: a minimal closed loop first, with the 25 items as an expansion action pool. |
| "Happy, aggrieved, want to stay with you" listed as actions | These are emotions or intentions. They should map to poses and action combinations. |
| Not looking at the mouse 40% in one place, and 20% in another | Do not adopt the conflicting fixed probabilities. Let the current state, attention budget, and cooldowns decide. |
| AI completes 50%, visuals 95%, performance 90%, fur contributes 30% | There is no measurement basis. These do not enter engineering acceptance criteria. |
| Head, body, legs, and tail adding up to 100% | The measurement definition is unclear and cannot be used for modeling. Replace it with a character reference sheet that has a size baseline. |
| Finish a high-quality character and app in four weeks | This can be kept as an original wish. A formal schedule has to depend on art capability, asset sources, and sample results. |
| Extremely low CPU/GPU and cinematic fur | Both are wishes. They need to be verified together on a specified machine, at a specified frame size and frame rate. |

## 5. Suggested convergence

Phase one builds a closed loop around "quietly living." Dialogue, long-term cloud memory, chasing the mouse, and climbing windows are not required items for now, but they stay in later product directions.

The art master can be 3D. The first runtime version does not have to be full real-time 3D. A full real-time upgrade should also be triggered by interaction needs and cost-benefit, rather than treated as a stage that must be passed through by default.

The risk most worth removing right now is: **whether the target art quality, natural interaction, and always-on performance can hold at the same time**. The character turnaround and the desktop technical prototype can be prepared separately. There is no need to wait until the full character assets are done before discovering that desktop integration is not feasible.
