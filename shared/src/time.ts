import { GAME_MINUTES_PER_TICK, TICKS_PER_DAY } from './constants.ts';

/** Date de jeu lisible à partir du numéro de tick. */
export function formatGameTime(tick: number): string {
  const day = Math.floor(tick / TICKS_PER_DAY) + 1;
  const minutes = (tick % TICKS_PER_DAY) * GAME_MINUTES_PER_TICK;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `Jour ${day}, ${hh}:${mm}`;
}
