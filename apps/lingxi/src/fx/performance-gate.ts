interface Player {
  readonly active: string | null;
  play(id: string): boolean;
  stop(): void;
}

/** Opt-out also cancels an automatic performance already playing; manual shows stay intact. */
export function createPerformanceGate(player: Player, onStart: () => void = () => {}, canAutomaticallyPlay: () => boolean = () => true) {
  let enabled = false, automaticPlaying = false;
  return {
    setEnabled(value: boolean) {
      enabled = value;
      if (!enabled && automaticPlaying && player.active) player.stop();
      if (!enabled) automaticPlaying = false;
    },
    play(id: string, automatic = true): boolean {
      if (automatic && (!enabled || !canAutomaticallyPlay())) return false;
      if (!player.play(id)) return false;
      automaticPlaying = automatic;
      onStart();
      return true;
    },
  };
}
