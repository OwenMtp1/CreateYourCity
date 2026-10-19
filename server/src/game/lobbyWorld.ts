// Monde d'un salon : horloge fixe, villes possédées, simulation et rattrapage.
import { simulateTick, simulateTicks, summarizeCity, TICK_MS, type CityLayers, type CityState, type CitySummary, type LobbyInfo } from '@cyc/shared';
import type { LobbyRecord } from '../store/types.ts';

export interface CatchUpReport { simulated: number; skipped: number }

export class LobbyWorld {
  readonly members = new Set<string>();
  readonly cities = new Map<string, CityState>();
  readonly cityByOwner = new Map<string, string>();
  /** Villes en cours d'attribution (empêche deux revendications concurrentes en mémoire). */
  readonly pendingClaims = new Set<string>();
  readonly layers = new Map<string, CityLayers>();
  catchUp: CatchUpReport = { simulated: 0, skipped: 0 };
  lastSavedAt: number | null = null;

  constructor(readonly record: LobbyRecord) {}

  get tick() { return this.record.tick; }

  info(): LobbyInfo {
    const r = this.record;
    return {
      id: r.id, code: r.code, name: r.name, isPublic: r.isPublic, maxPlayers: r.maxPlayers,
      playerCount: this.members.size, createdAt: r.createdAt,
    };
  }

  summaries(): CitySummary[] {
    return [...this.cities.values()].map(summarizeCity);
  }

  addCity(city: CityState) {
    this.cities.set(city.cityId, city);
    this.cityByOwner.set(city.ownerId, city.cityId);
  }

  cityOf(playerId: string): CityState | undefined {
    const id = this.cityByOwner.get(playerId);
    return id ? this.cities.get(id) : undefined;
  }

  /**
   * Restauration après chargement : aligne chaque ville sur l'horloge du salon, puis rejoue
   * les ticks manqués pendant l'arrêt du serveur, dans la limite de maxCatchUpTicks.
   * Au-delà, le temps est sauté (et signalé) : on ne prétend pas que le monde a tourné.
   */
  restore(now: number, maxCatchUpTicks: number): CatchUpReport {
    let maxCityTick = this.record.tick;
    for (const c of this.cities.values()) maxCityTick = Math.max(maxCityTick, c.tick);
    if (maxCityTick > this.record.tick) {
      this.record.lastSimulatedAt += (maxCityTick - this.record.tick) * TICK_MS;
      this.record.tick = maxCityTick;
    }
    for (const c of this.cities.values()) {
      if (c.tick < this.record.tick) simulateTicks(c, this.record.tick - c.tick);
    }
    const missed = Math.max(0, Math.floor((now - this.record.lastSimulatedAt) / TICK_MS));
    const simulated = Math.min(missed, maxCatchUpTicks);
    for (let i = 0; i < simulated; i++) this.step();
    const skipped = missed - simulated;
    // Le temps sauté n'avance pas l'horloge de jeu : on repart de maintenant.
    if (skipped > 0) this.record.lastSimulatedAt += skipped * TICK_MS;
    this.catchUp = { simulated, skipped };
    return this.catchUp;
  }

  /** Un tick de simulation pour toutes les villes du salon. */
  step() {
    for (const city of this.cities.values()) this.layers.set(city.cityId, simulateTick(city));
    this.record.tick += 1;
    this.record.lastSimulatedAt += TICK_MS;
  }

  /** Exécute les ticks dus à l'instant `now` (au plus maxTicks pour ne pas bloquer). */
  advanceTo(now: number, maxTicks: number): number {
    let n = 0;
    while (n < maxTicks && now - this.record.lastSimulatedAt >= TICK_MS) {
      this.step();
      n++;
    }
    return n;
  }
}
