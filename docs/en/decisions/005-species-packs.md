<!-- English translation of `docs/decisions/005-species-packs.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Decision 005: other species join as "species packs"; what is unified is intent, not the skeleton

**Status**: direction decided, 2026-09-24. **Not implemented**; there is no species-pack code change anywhere. The design details are in [`docs/24-species-pack-design.md`](../24-species-pack-design.md).
**Question**: could the desktop pet later switch to a dog, a bird, a human, or a fish? What approach supports that, and on which layer does the unified interface sit?

---

## Decision 1: finish the cat first, and only leave seams in the architecture

The cat's look (v5 look-dev) has not passed review yet; generalizing now would be writing an abstraction for something not yet finalized. This phase does only two near-zero-cost things:

1. Agents only say intents, and action ids come from `lingxi_capabilities` — this is already done right; do not regress.
2. From now on, **newly written** code in `apps/lingxi/src/anim/` references nodes by bone role (head, spine chain, limbs, tail chain), not literals like `'upperFL'`. Old code is not specially refactored.

## Decision 2: the unified interface is "intent", not the skeleton

Dogs, birds, humans, and fish have fundamentally different body structures; forcing them into one skeleton would make every species awkward. What can truly be shared is **what it wants to express**: happy, catching your bad mood, noticing you, resting, celebrating together.

So the unification sits on two layers:

- **Outward**: the Agent `state` / `kind` / `mood` vocabulary ([19](../19-agent-integration.md)) stays unchanged and species-agnostic.
- **Inward**: add a closed **intent vocabulary** between the "reaction mapping" and "concrete actions". Each species maps intents to its own actions: the cat kneads and purrs, the dog wags and circles, the fish blows bubbles.

What differs between species — skeleton, locomotion, habitat, facial features, action library, rhythm parameters — all goes into one **species pack**, delivered against one manifest contract.

## Decision 3: locomotion modules split by body plan, not by species

There are only a few ways to move: quadruped, biped, fly/hop, swim. The cat and dog share the quadruped module and only change gait parameters. Adding a species should at best be **data only**; adding a new body plan is when you write a new locomotion module and open a separate decision record.

## Decision 4: the second species is the dog

A dog has the same body structure as the cat — the cheapest, and the best test of whether the seams are cut right. There is only one acceptance criterion: **adding the dog must not change a single line of director, renderer, or life-engine; only a species pack and quadruped gait parameters.** If that cannot be done, the seam is cut wrong; fix the seam first, and do not make a third species.

Bird and human come next, fish last (no legs, no ground — habitat and interaction both have to be redesigned).

## Decision 5: memory and relationships belong to this companion, not to the species

One companion = species pack + skin + personality + memory. Continuing [Decision 004](004-cat-friend.md): the relationship stays with "this one". **Whether a single companion can switch species** is a product question; this page does not decide it for the user, and it is recorded in the design document's "open questions".

## When to change your mind

- When the cat's look is approved and it enters the stage of being wired into the desktop pet, come back here and start at migration step 1 of the design document.
- If adding the dog shows that director or renderer must change, the intent layer or the habitat abstraction is wrong; revise this page first.
- If someone proposes "one shared generic skeleton for all species", come back to Decision 2 first.
