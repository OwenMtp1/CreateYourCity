// Monde d'un salon : horloge fixe, villes, état global (diplomatie, armées, nations), rattrapage.
import { simulateTicks, summarizeCity, TICK_MS, type CityLayers, type CityState, type CitySummary, type LobbyInfo } from '@cyc/shared';
import { citiesOf, createWorldMeta, migrateWorldMeta, stepWorld, type World } from '@cyc/shared/game';
import type { LobbyRecord } from '../store/types.ts';

export interface CatchUpReport { simulated: number; skipped: number }

export class LobbyWorld {
  readonly members = new Set<string>();
  readonly world: World;
  /** Villes en cours d'attribution (empêche deux revendications concurrentes en mémoire). */
  readonly pendingClaims = new Set<string>();
  readonly layers = new Map<string, CityLayers>();
  catchUp: CatchUpReport = { simulated: 0, skipped: 0 };
  lastSavedAt: number | null = null;

  constructor(readonly record: LobbyRecord) {
    this.world = {
      tick: record.tick,
      cities: new Map(),
      meta: record.world ? migrateWorldMeta(record.world) : createWorldMeta(),
    };
  }

  get tick() { return this.world.tick; }
  get cities() { return this.world.cities; }

  info(): LobbyInfo {
    const r = this.record;
    return {
      id: r.id, code: r.code, name: r.name, isPublic: r.isPublic, maxPlayers: r.maxPlayers,
      playerCount: this.members.size, ownerId: r.ownerId, createdAt: r.createdAt,
    };
  }

  summaries(): CitySummary[] {
    return [...this.cities.values()].map(summarizeCity);
  }

  addMember(id: string, name: string) {
    this.members.add(id);
    this.world.meta.players[id] = { name };
  }

  addCity(city: CityState) {
    this.cities.set(city.cityId, city);
  }

  citiesOf(playerId: string): CityState[] {
    return citiesOf(this.world, playerId).map((id) => this.cities.get(id)!);
  }

  clock() {
    return { tick: this.world.tick, lastSimulatedAt: this.record.lastSimulatedAt };
  }

  /**
   * Restauration après chargement : aligne chaque ville sur l'horloge du salon, puis rejoue
   * les ticks manqués pendant l'arrêt du serveur, dans la limite de maxCatchUpTicks.
   * Au-delà, le temps est sauté (et signalé) : on ne prétend pas que le monde a tourné.
   */
  restore(now: number, maxCatchUpTicks: number): CatchUpReport {
    let maxCityTick = this.world.tick;
    for (const c of this.cities.values()) maxCityTick = Math.max(maxCityTick, c.tick);
    if (maxCityTick > this.world.tick) {
      this.record.lastSimulatedAt += (maxCityTick - this.world.tick) * TICK_MS;
      this.world.tick = maxCityTick;
    }
    for (const c of this.cities.values()) {
      if (c.tick < this.world.tick) simulateTicks(c, this.world.tick - c.tick);
    }
    const missed = Math.max(0, Math.floor((now - this.record.lastSimulatedAt) / TICK_MS));
    const simulated = Math.min(missed, maxCatchUpTicks);
    for (let i = 0; i < simulated; i++) this.step();
    const skipped = missed - simulated;
    if (skipped > 0) this.record.lastSimulatedAt += skipped * TICK_MS;
    this.catchUp = { simulated, skipped };
    return this.catchUp;
  }

  /** Un tick de simulation pour tout le salon. */
  step() {
    for (const [id, l] of stepWorld(this.world)) this.layers.set(id, l);
    this.record.tick = this.world.tick;
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
