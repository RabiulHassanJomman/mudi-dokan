/** What a tap on a clip's ▶️ / ⏸ does. `current` = the clip loaded in the player (null after it ends). */
export type ClipTap = 'start' | 'pause' | 'resume';

export function clipTap(current: string | null, playing: boolean, ref: string): ClipTap {
  if (current !== ref) return 'start';
  return playing ? 'pause' : 'resume';
}

/** The row's icon: ⏸ only on the clip that is playing now. */
export function clipIcon(current: string | null, playing: boolean, ref: string | null): 'play' | 'pause' {
  return ref !== null && current === ref && playing ? 'pause' : 'play';
}
