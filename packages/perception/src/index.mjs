// Activity recorder (packages/perception-contract's ActivityRecorder). Pure, no DOM/Tauri -
// main.ts feeds it real events, and a debug/CLI context can feed it synthetic ones the same
// way for testing. Keeps only small rolling counters, never a raw event/position log, per
// the privacy note in the contract.

const GROWTH_PER_INTERACTION = 2; // click or drag; deliberately small and linear for v0
const GROWTH_CAP = 100;

export function createActivityRecorder() {
  let lastActivityAt = null;
  let cursorNearPetMs = 0;
  let cursorEnteredAt = null; // non-null while the cursor is currently "near" the pet
  let clicksOnPet = 0;
  let dragCount = 0;
  let totalDragMs = 0;
  let scaleChanges = 0;
  let lifetimeInteractionCount = 0;

  function record(event) {
    lastActivityAt = event.at;
    switch (event.type) {
      case 'click_on_pet':
        clicksOnPet += 1;
        lifetimeInteractionCount += 1;
        break;
      case 'drag_start':
        break;
      case 'drag_end':
        dragCount += 1;
        totalDragMs += event.durationMs;
        lifetimeInteractionCount += 1;
        break;
      case 'cursor_entered_pet':
        cursorEnteredAt = event.at;
        break;
      case 'cursor_left_pet':
        if (cursorEnteredAt != null) {
          cursorNearPetMs += Math.max(0, event.at - cursorEnteredAt);
          cursorEnteredAt = null;
        }
        break;
      case 'scale_changed':
        scaleChanges += 1;
        break;
      case 'visibility_changed':
        break;
      default:
        break;
    }
  }

  function summary(now) {
    const liveNear = cursorEnteredAt != null ? Math.max(0, now - cursorEnteredAt) : 0;
    return {
      // `null` means "no activity has happened yet", NOT Infinity. This summary crosses the
      // Tauri IPC as JSON, and JSON has no infinity: the sentinel arrived in the webview as
      // `null` while the typed contract still claimed `number`, so every consumer discovered
      // the mismatch at runtime. Null is JSON's own "absent" and is what the contract says.
      idleMs: lastActivityAt == null ? null : Math.max(0, now - lastActivityAt),
      cursorNearPetMs: cursorNearPetMs + liveNear,
      clicksOnPet,
      dragCount,
      totalDragMs,
      scaleChanges,
    };
  }

  function growth() {
    const engagementScore = Math.min(GROWTH_CAP, lifetimeInteractionCount * GROWTH_PER_INTERACTION);
    return { engagementScore, lifetimeInteractionCount };
  }

  return { record, summary, growth };
}
