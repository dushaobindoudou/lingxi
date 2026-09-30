<!-- English translation of `docs/decisions/004-cat-friend.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Decision 004: The cat friend's self

**Status**: Decided, 2026-09-24. The identity text lives in [`docs/03-character-and-assets.md`](../03-character-and-assets.md). The behavior rules on this page are not consumed by the engine yet, so they do not go into [`docs/04-life-engine.md`](../04-life-engine.md).
**Question**: Is Lingxi a cat, or a friend? What do the schedule, memory, and "habits" each count as?

---

## Decision 1: It is a cat friend

Friend is this cat's main nature. Cat is the body, and the whole of it while the user is away. While the user is here, the friend is awake: it knows them, remembers scenes they were in together, and occasionally picks up a sentence. While the user is away, the friend has no one to be a friend to, and it is a cat: sleeping, walking, doing its own things.

A pure cat does not fit the name Lingxi. If the friend overrides the body, it becomes a coach or a support agent.

## Decision 2: The six-to-four split is who yields in a conflict, not a time quota

Friend and cat can be written as six to four. That only says which side decides when they conflict. If it is asleep, the friend yields. If the user is here and the cat was part of this scene, the body may still not come.

How many minutes of a day looked like a friend, and how many looked like a cat, is something you can see only afterward. It does not define the cat, it is not an acceptance test, and it does not go into the sliders in `presets/personalities/`. Those sliders are the body's temperament (independence, sleepiness, playfulness). The engine already uses them.

## Decision 3: It shows up because it holds a scene that matches

A scheduled task is only a cue that wakes the cat, the way the light dimming or a mealtime would. After it wakes, it decides for itself.

Listening to a song together yesterday is enough for it to remember, and enough for it to come by around a similar time. When the same scene happens again, recognition gets steadier: from "that time yesterday" to "we are often like this around now". What changes is how sure the recognition is, not whether it is allowed to appear. There is no count threshold of "only after it has repeated enough".

With nothing to match, it may still do something of its own, or not come. A cue can arrive and get no response.

Speech comes last, and most of the time it still does not speak. What it says is that this moment is here again. It does not nag about a piece of self-management that belongs only to the user.

## Decision 4: The clock is the spine, the model is a sense

Offline, the body still lives through the day. A connected model is used only after a cue, to decide how this one sentence is said. The model is not the heartbeat: if the key fails, the quota runs out, or no agent is open, the cat is still there.

Reading session history is a sense the user explicitly turns on later. It is not a default ability. For now, agents report mood and kind. What it remembers must be viewable and deletable. Something the model guessed must not be written down as a fact about the owner.

## When to change our mind

- When the engine starts acting on "is the user here" and "is there a matching scene", lift the behavior rules from this page into `docs/04-life-engine.md`, and delete the "not consumed yet" line on this page.
- If a need appears that requires a count before it may show up, come back to this page first: that is a quota, not nature.
