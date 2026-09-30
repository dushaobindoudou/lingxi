<!-- English translation of `docs/06-roadmap-and-decisions.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Milestones and Decision List

> Historical baseline (2026-09-10): the product is now named Lingxi, and the user requires real-time 3D as the goal. The latest decisions are in the [real-time 3D decision](decisions/001-realtime-desktop.md), [brand design](08-brand-and-design-system.md), and [extension architecture](09-extension-architecture.md). Older recommendations that conflict with the new decisions no longer apply.

Updated: 2026-09-10. The phases below are suggestions. There is no completed development milestone.

## 1. Order of progress

| Phase | Work and outputs | Exit condition |
| --- | --- | --- |
| D0: direction and identity | Sort the documents, reference images, and character candidates; settle on one main cat | Main visual, platform priority, and sample budget are clear |
| P0: feasibility | Transparent-window prototype; a short prerender and a simplified real-time sample of the same character from the same camera; a 6-clip closed loop | Basic desktop interaction works; quality and performance are recorded; the runtime route is chosen |
| M1: companionship MVP | Frozen character, behavior direction, local interaction, settings, hide and quit, local restore | Passes product acceptance and a one-week trial; reasons for closing can be explained |
| M2: relationship validation | Low-frequency AI, controllable memory, a small amount of language and preference change | Observable value relative to the offline version, with acceptable cost and interruption |
| M3: expansion | Expand actions, Windows, and more desktop interaction as needed | Each expansion has a real need and does not break the always-on experience |

Art-reference preparation and the window-feasibility experiment can move separately. Full modeling should not block an early check of transparent windows, click-through, and power risk. The formal schedule is estimated after P0. The original four weeks is not carried forward as a commitment.

## 2. The tasks closest to starting

| Order | Task | Reviewable result |
| --- | --- | --- |
| 1 | Choose the main cat from the existing concept board; run a 6-candidate experiment if needed | Candidate comparison, reasons for the choice, identity items still missing |
| 2 | Record the target system, the minimum test machine, and the distribution method | Test-conditions table |
| 3 | Use placeholder material to verify transparency, focus, click-through, dragging, and hide | A runnable prototype and a problem log |
| 4 | Make a short film of the same character sleeping and waking, and export a simplified model | Same-size, same-camera comparison samples |
| 5 | Measure resource cost and viewing experience, and choose a route | A one-page experiment report, including failures |
| 6 | Complete the character reference pack and the action entry/exit conventions | A frozen specification that can be handed to art and development |

The above is a list of later tasks. This round delivers only documents and archived references. It does not mean asset generation, purchasing, or app development has started.

## 3. Decision ledger

| ID | Topic | Current status | Suggestion or evidence needed |
| --- | --- | --- | --- |
| D01 | Quiet companionship, the same cat, staying cat-like | Repeated throughout the original materials | Kept as the core direction |
| D02 | Product name and directory name | To be confirmed | 陪陪 for now; Peipei is the working English name; supplementary material keeps the possibility of naming it later |
| D03 | Final look | Concept reference exists, not frozen | The main cat in the image is a strong candidate; turnaround and markings are still missing |
| D04 | Breed and coat color | The materials disagree | The image says “布偶猫（虚构）” (Ragdoll (fictional)); the original text does not bind a breed; define by appearance first |
| D05 | Launch platform and channel | To be confirmed | Suggested start is macOS validation; the distribution method affects the desktop-shell choice |
| D06 | Runtime rendering | Pending experiment | Prerender is the preferred candidate, compared with simplified real-time |
| D07 | First batch of actions | Suggestion after sorting | P0 is a 6-clip closed loop; the 25 items are a later pool |
| D08 | AI and long-term memory | Suggestion after sorting; the original MVP was adjusted | M1 is offline basic continuity; M2 validates semantic memory and AI |
| D09 | Performance budget | Pending measurement | Freeze after the target machine and the measurement definition are specified |
| D10 | Art resources and investment | To be confirmed | In-house / outsource capability, budget, cost of AI-assisted cleanup |
| D11 | Environment props | They appear in the concept; scope is unset | Transparent cat by default; a bed or mat as an optional comparison; do not recreate a whole room |
| D12 | Business model | Not discussed | Do not invent a subscription, a one-time purchase, or a shop |

## 4. Key risks and handling

| Risk | How to find it early | Direction of handling |
| --- | --- | --- |
| After leaving the warm background, the cat is no longer appealing | Put the same cat on light, dark, and cluttered desktops | Change silhouette, coat color, and contact shadow first, then evaluate a small mat |
| Many assets, but actions join poorly | Validate one complete closed loop first | Add transitions; do not pile on quantity |
| Prerender memory and package size swell | Measure at real size and duration | Streaming load, limit the cache, cut directions and variants |
| Real-time fur does not reach the expectation | Export into the target app early | Lower runtime complexity, or choose offline rendering |
| The desktop window interferes with operation | Office test with a placeholder prototype | Shrink the interaction range, fix click-through and focus, keep a reliable quit |
| Long-term use feels repetitive | One week of observation and reasons for closing | Adjust rhythm and behavior context, then add only the variants that are necessary |
| AI adds cost but no experience gain | Compare with the local version | Keep it optional; decide whether to continue from evidence |

## 5. Document delivery status

Done: original materials archived, supplementary thinking extracted, concept board archived, project analysis, suggested MVP, character and behavior specifications, technical verification plan, and decision list.

Not done: user-need validation, character visual freeze, turnaround, model and animation, desktop prototype, measured technology choice, development schedule. Those are later project work. They are not omissions from this round of document sorting.
