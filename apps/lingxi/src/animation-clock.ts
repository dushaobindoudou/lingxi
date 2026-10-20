/** Skinned clips advance in wall time, even when an expensive frame takes over 100 ms.
 * The host resets previous to null on resume; hidden time is deliberately not replayed.
 * The voxel simulation retains its existing integration limit.
 */
export function frameDelta(previous: number | null, now: number, style: string): number {
  if (previous == null) return 0;
  const elapsed = Math.max(0, (now - previous) / 1000);
  return style === 'realistic' ? elapsed : Math.min(0.1, elapsed);
}
