import { GAME_MINUTES_PER_TICK, GAME_START_HOUR } from './constants.ts';

/** Date de jeu lisible à partir du numéro de tick. */
export function formatGameTime(tick: number): string {
  const total = GAME_START_HOUR * 60 + tick * GAME_MINUTES_PER_TICK;
  const day = Math.floor(total / 1440) + 1;
  const minutes = total % 1440;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `Jour ${day}, ${hh}:${mm}`;
}

/** Heure de la journée (0–24, décimale) au tick donné. */
export function gameHour(tick: number): number {
  return ((GAME_START_HOUR * 60 + tick * GAME_MINUTES_PER_TICK) % 1440) / 60;
}
