<!-- English translation of `docs/decisions/002-physics-and-game-libraries.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Decision 002: Whether to Introduce a Physics Engine / Game Framework

**Status**: decided, 2026-09-19
**Question**: since Three.js is in use, should a game-style library be connected so the system is more reasonable? The toy needs physical behavior. Does Three.js support that?

## Answer the factual part first

**Three.js itself has no physics.** It is a renderer — scene graph, materials, camera, lighting. Collision, rigid bodies, constraints, and soft bodies are all outside its scope. Something else has to be connected.

Mainstream options:

| Option | Size | Nature |
|---|---|---|
| **Rapier** (`@dimforge/rapier3d-compat`) | ~1MB WASM | Full rigid bodies + joints + collision; the industry mainstay |
| **cannon-es** | ~200KB pure JS | Lightweight rigid bodies, no soft bodies |
| **Write it ourselves** | ~100 lines | Solves only the two problems in hand |

## Decision

**Do not introduce a general physics engine.** Handle it in two parts:

- **The yarn ball's motion stays in the life engine, and stays closed-form.**
- **The soft tail end of the wand toy uses a Verlet rope** (`apps/lingxi/src/rig/rope.ts`).

## Why

Only two things in this app want "physics," and what they want is completely different.

**The yarn ball is gameplay, not a picture.** The cat will chase it. Its behavior has unit tests, must be deterministic, and must live in `packages/life-engine` — where there is no renderer, no DOM, and no browser. Handing it to a physics engine would mean:

- the cat's AI depends on a WASM blob, and tests cannot run in Node;
- the life engine is no longer a pure state machine, and the cleanest boundary in the architecture is broken;
- a physics world is started for two objects.

The physics it actually needs is only "rolling + friction decay + boundary bounce": three lines of closed-form solution, and it has already been tested.

**The tail end of the wand toy is a picture, not gameplay.** It does not affect the cat's decision (what the cat chases is the position of the wand tip). What it wants is **momentum + constraint**: the tail end lags the hand, overshoots after the hand stops, and then keeps swinging. That is exactly why a Verlet rope has been used for decades in games for ropes, tails, and strips of cloth — forty lines, no dependency, and it can be tested in Node (`packages/life-engine/test/rope.test.mjs` has 5 tests covering lag, momentum, not stretching, being knocked away, and long frames not exploding).

There is also a practical constraint: **a desktop pet must open in a second, and idle near zero CPU**. Keeping a physics world resident for two objects does not fit that premise.

## When to change our mind

If toys start **colliding with each other** (a ball hits the wand, two balls hit each other, a ball falls off the desktop edge), or a scene appears that needs real stacking / friction, that is Rapier's job. Writing it ourselves will start producing bugs. The approach then is: put Rapier in the render process, responsible only for **picture physics**, and keep the gameplay physics in the life engine independent — do not let the cat's AI depend on it.

## On a "game framework"

Things like Yuka (steering AI) and Theatre.js (animation sequencing) were evaluated. The conclusion is that **the existing architecture is already reasonable**:

```
Pure behavior state machine (testable, no dependencies) → renderer (Three.js) → host (Tauri)
```

This is exactly the layering a game framework would recommend, except we implemented the small part we need ourselves. Introducing a framework would be a rewrite, in exchange for features we would not use and a new layer of abstraction. This project's complexity is in **animation quality** (gait, IK, camera movement), not in a missing framework.
