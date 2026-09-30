<!-- English translation of `assets/characters/lingxi/skins/workbuddy-mint/DESIGN.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Mint on Duty · design notes

WorkBuddy's brand skin. [`skins.json`](../../../../../../../assets/characters/lingxi/skins/workbuddy-mint/skins.json) is the source record for this one. At runtime what is read is the copy in the application data directory
(written incrementally by `.workbuddy/probes/build-workbuddy-assets.mjs`; see the end).

## Why `fur` uses the brand primary color directly

In a skin, `fur` is **the largest area** — the whole cat's body. So "this is WorkBuddy's cat"
has to be carried by the base color, not by some accent. `#0AC89F` is taken directly from the application icon, with no softening:
after softening it would only be "a teal cat," and this is a brand skin, so recognition comes first.

The other nine items correspond one to one with the role assignments of the built-in `tuxedo` skin (`ink-sesame`, Sesame Night Voyage):

| Field | Color | Where it is used | Why this value |
|---|---|---|---|
| `fur` | `#0AC89F` | Base color of the whole body | Brand primary. Not softened |
| `pattern` | `#06806A` | Ears, brows, dark tail tip | Darkened in the same hue, so it and the base are "light and dark of the same cat" rather than two colors |
| `cream` | `#EDFBF6` | Chest bib, belly | The brand light `#E5F9F4` lifted one step, so it is "cloud white" enough on a mint base |
| `iris` | `#F2CD7A` | Iris | Honey-gold and teal are complements — if the eye color is not given the complement, the eye is a dead patch of green |
| `pupil` | `#0A3A31` | Pupil | Deep dark green, not pure black: black looks dirty in green fur |
| `nose` | `#F0939C` | Nose tip | A cool-colored body needs one warm spot, or the whole cat is cold |
| `paw` | `#EDFBF6` | All four paws | The same color as the bib = "white socks," the second white marking of `tuxedo` |
| `mouth` | `#2F6F60` | Mouth line | Deep mint, staying in the same color family |
| `whisker` | `#EDFBF6` | Whiskers | Light whiskers are what read as lines on a deep-green base |
| `tongue` | `#E998A6` | Tongue | The same family as the nose tip, the only bright warm color |

## The rest of the WorkBuddy custom set

The skin is only the piece of this set that the user sees at a glance. The same script also writes:

| File | Contents |
|---|---|
| `expressions.json` | The built-in 30, plus 10 WorkBuddy terms (green light / red light / online / building / waiting for you to confirm / queued / timed out / clocking off / standing by / slacking) |
| `actions.json` | The built-in 49, plus `wb-deploy` / `wb-review` / `wb-suspend` / `wb-wave-flag`, all placed in the `特效` (Effects) category — that category is never picked automatically and can only be triggered explicitly, which is exactly the behavior an "agent-only" action should have |
| `bubble.json` | A deep-mint bubble `#0B2B26` plus a brand-color stroke |
| `reactions.json` | A task → expression/action map, connecting the vocabulary above to `/task-event`; it also pins 5 built-in emotional responses split by `mood`, so branding does not casually delete "the cat responds to emotion" |

`actions.json` and `expressions.json` have **whole-file replacement** semantics, so the script always brings the full built-in set first and then appends;
`skins.json` has **merge** semantics, so the script reads what is already there and then writes the increment — a `skins.json`
written without reading first wipes the user's existing skins off disk.

## Regenerating / rolling back

```sh
# Generate (idempotent; it first snapshots the existing skins.json to ~/.lingxi/backup/)
node .workbuddy/probes/build-workbuddy-assets.mjs
# Preflight with the application's own parser, then have the running application reread
node --experimental-strip-types .workbuddy/probes/verify-workbuddy-assets.mjs
lingxi reload && lingxi assets
```

Rollback: restore `skins.json` from `~/.lingxi/backup/skins.json.pre-workbuddy-*`,
delete `expressions.json` / `actions.json` / `bubble.json` / `reactions.json` to return to the built-in set,
then `lingxi reload`. Switching skins requires the `trusted` tier (`skin` is a setting that gets saved),
or the user clicks it themselves on the appearance page — custom skins show up there as marked cards.
