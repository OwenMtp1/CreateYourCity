// Vue personnalisée du monde envoyée à un joueur : ce qu'il a le droit de voir.
import { armySize } from './military.ts';
import { allied, armyPosition, detailVisible, distanceLatLonKm, eligibleVoters, marketPrices } from './rules.ts';
import type { DirectMessage, MarketState, NationState, Siege, TradeContract, Treaty, UnitType, War, World, WorldEvent } from './types.ts';
import { UNIT_TYPES } from './types.ts';

/** Rayon autour de ses villes dans lequel un joueur aperçoit les armées étrangères. */
export const SIGHT_RANGE_KM = 500;

export interface ArmyView {
  id: number;
  ownerId: string;
  cityId: string;
  movement: { toCityId: string; progressKm: number; totalKm: number } | null;
  position: [number, number];
  /** Composition exacte (soi et partenaires) ou effectif total arrondi (armée étrangère aperçue). */
  units: Record<UnitType, number> | null;
  approxSize: number;
  supplied: boolean | null;
  paid: boolean | null;
  homeCityId: string | null;
}

export interface NationView extends Omit<NationState, 'votes' | 'impeach'> {
  voters: string[];
  voteCounts: Record<string, number>;
  myVote: string | null;
  impeachCount: number;
  iSupportImpeach: boolean;
}

export interface CityDetail {
  cityId: string;
  treasury: number;
  population: number;
  jobs: number;
  unemploymentRate: number;
  goodsProduced: number;
  netPerDay: number;
}

export interface WorldView {
  tick: number;
  players: { id: string; name: string; cityIds: string[] }[];
  market: MarketState & { buyPrice: number; sellPrice: number };
  treaties: Treaty[];
  wars: War[];
  contracts: TradeContract[];
  armies: ArmyView[];
  sieges: Siege[];
  nations: NationView[];
  events: WorldEvent[];
  messages: DirectMessage[];
  cityDetails: CityDetail[];
}

export function buildWorldView(world: World, viewer: string): WorldView {
  const meta = world.meta;
  const cities = [...world.cities.values()];
  const myCities = cities.filter((c) => c.ownerId === viewer).map((c) => c.cityId);
  const players = Object.entries(meta.players).map(([id, p]) => ({
    id, name: p.name, cityIds: cities.filter((c) => c.ownerId === id).map((c) => c.cityId).sort(),
  }));

  const armies: ArmyView[] = [];
  for (const a of meta.armies) {
    const position = armyPosition(a.cityId, a.movement);
    const exact = detailVisible(meta, viewer, a.ownerId) || allied(meta, viewer, a.ownerId);
    const seen = exact || myCities.some((id) => distanceLatLonKm(position, id) <= SIGHT_RANGE_KM);
    if (!seen) continue;
    const size = armySize(a);
    armies.push({
      id: a.id, ownerId: a.ownerId, cityId: a.cityId, movement: a.movement, position,
      units: exact ? Object.fromEntries(UNIT_TYPES.map((u) => [u, a.units[u]])) as Record<UnitType, number> : null,
      approxSize: exact ? size : Math.max(10, Math.round(size / 10) * 10),
      supplied: exact ? a.supplied : null, paid: exact ? a.paid : null, homeCityId: exact ? a.homeCityId : null,
    });
  }

  const nations: NationView[] = [];
  for (const n of Object.values(meta.nations)) {
    const voteCounts: Record<string, number> = {};
    for (const c of Object.values(n.votes)) voteCounts[c] = (voteCounts[c] ?? 0) + 1;
    const { votes, impeach, ...rest } = n;
    nations.push({
      ...rest, voters: eligibleVoters(world, n.countryId), voteCounts, myVote: votes[viewer] ?? null,
      impeachCount: impeach.length, iSupportImpeach: impeach.includes(viewer),
    });
  }

  const cityDetails: CityDetail[] = cities
    .filter((c) => c.ownerId !== viewer && detailVisible(meta, viewer, c.ownerId))
    .map((c) => ({
      cityId: c.cityId, treasury: c.treasury, population: c.population, jobs: c.stats?.jobs ?? 0,
      unemploymentRate: c.stats?.unemploymentRate ?? 0, goodsProduced: c.stats?.goods.produced ?? 0, netPerDay: c.stats?.budget.net ?? 0,
    }));

  const prices = marketPrices(meta.market.price);
  return {
    tick: world.tick,
    players,
    market: { ...meta.market, buyPrice: prices.buy, sellPrice: prices.sell },
    treaties: meta.treaties.filter((t) => t.a === viewer || t.b === viewer || (t.status === 'active' && ['alliance', 'defense', 'non_aggression'].includes(t.type))),
    wars: meta.wars,
    contracts: meta.contracts.filter((c) => c.sellerId === viewer || c.buyerId === viewer),
    armies,
    sieges: Object.values(meta.sieges),
    nations,
    events: meta.events.filter((e) => !e.private || e.players.includes(viewer)).slice(-60),
    messages: meta.messages.filter((m) => m.from === viewer || m.to === viewer).slice(-100),
    cityDetails,
  };
}

