// Armées : déplacements, ravitaillement, solde, combats et sièges. Règles déterministes.
import { GAME_MINUTES_PER_TICK, DT_DAYS } from '../constants.ts';
import { PROJECT_EFFECTS } from '../sim/modifiers.ts';
import type { CityState } from '../types.ts';
import { allied, armyPosition, atWar, cityName, distanceLatLonKm, MILITARY, playerName, pushEvent, UNITS } from './rules.ts';
import { UNIT_TYPES, type Army, type World } from './types.ts';

export const armySize = (a: Pick<Army, 'units'>) => UNIT_TYPES.reduce((s, u) => s + a.units[u], 0);

export function armySpeedKmh(a: Army): number {
  let speed = Infinity;
  for (const u of UNIT_TYPES) if (a.units[u] >= MILITARY.minArmySize) speed = Math.min(speed, UNITS[u].speedKmh);
  return Number.isFinite(speed) ? speed : 0;
}

const effectiveness = (a: Army) =>
  (a.supplied ? 1 : MILITARY.unsuppliedStrength) * (a.paid ? 1 : MILITARY.unpaidStrength);

export const attackStrength = (a: Army) => UNIT_TYPES.reduce((s, u) => s + a.units[u] * UNITS[u].attack, 0) * effectiveness(a);
export const defenseStrength = (a: Army) => UNIT_TYPES.reduce((s, u) => s + a.units[u] * UNITS[u].defense, 0) * effectiveness(a);
export const siegePower = (a: Army) => UNIT_TYPES.reduce((s, u) => s + a.units[u] * UNITS[u].attack * UNITS[u].siege, 0) * effectiveness(a);

/** Fortification d'une ville (défense résiduelle sans armée). */
export function fortification(world: World, city: CityState): number {
  let police = 0, barracks = 0;
  for (const b of city.buildings) {
    if (b.type === 'police') police++;
    if (b.type === 'barracks') barracks++;
  }
  const nation = world.meta.nations[city.countryId];
  const factor = nation?.projects.national_defense ? PROJECT_EFFECTS.national_defense.fortificationFactor : 1;
  return (MILITARY.fortBase + police * MILITARY.fortPerPolice + barracks * MILITARY.fortPerBarracks) * factor;
}

function scale(a: Army, f: number) {
  for (const u of UNIT_TYPES) a.units[u] *= Math.max(0, 1 - f);
}

export function stepMilitary(world: World): void {
  const meta = world.meta;
  const hoursPerTick = GAME_MINUTES_PER_TICK / 60;
  meta.armies.sort((x, y) => x.id - y.id);

  // Déplacements, ravitaillement, solde.
  for (const army of meta.armies) {
    if (army.movement) {
      army.movement.progressKm += armySpeedKmh(army) * hoursPerTick;
      if (army.movement.progressKm >= army.movement.totalKm) {
        const dest = army.movement.toCityId;
        army.cityId = dest;
        army.movement = null;
        const owner = world.cities.get(dest)?.ownerId;
        if (owner && atWar(meta, owner, army.ownerId)) {
          pushEvent(world, 'battle', `L'armée de ${playerName(meta, army.ownerId)} arrive devant ${cityName(dest)}.`, [army.ownerId, owner]);
        }
      }
    }
    const pos = armyPosition(army.cityId, army.movement);
    let supplied = false;
    for (const c of world.cities.values()) {
      if (allied(meta, c.ownerId, army.ownerId) && distanceLatLonKm(pos, c.cityId) <= MILITARY.supplyRangeKm) {
        supplied = true;
        break;
      }
    }
    army.supplied = supplied;
    const home = world.cities.get(army.homeCityId);
    if (home && home.ownerId === army.ownerId) {
      const upkeep = UNIT_TYPES.reduce((s, u) => s + army.units[u] * UNITS[u].upkeepPerDay, 0);
      home.treasury -= upkeep * DT_DAYS;
      army.paid = home.treasury >= 0;
    } else {
      // Ville de solde perdue : l'armée est rattachée à une autre ville du joueur, sinon non payée.
      const other = [...world.cities.values()].filter((c) => c.ownerId === army.ownerId).sort((a, b) => a.cityId.localeCompare(b.cityId))[0];
      if (other) army.homeCityId = other.cityId;
      army.paid = !!other;
    }
    if (!army.supplied) scale(army, MILITARY.unsuppliedAttrition * DT_DAYS);
    if (!army.paid) scale(army, MILITARY.unpaidAttrition * DT_DAYS);
  }

  // Fusion des armées stationnées d'un même joueur dans une même ville.
  const stationed = new Map<string, Army>();
  for (const army of meta.armies) {
    if (army.movement) continue;
    const key = `${army.ownerId}|${army.cityId}`;
    const first = stationed.get(key);
    if (!first) { stationed.set(key, army); continue; }
    for (const u of UNIT_TYPES) first.units[u] += army.units[u];
    for (const u of UNIT_TYPES) army.units[u] = 0;
  }

  // Combats et sièges, ville par ville.
  const byCity = new Map<string, Army[]>();
  for (const army of meta.armies) {
    if (army.movement || armySize(army) < MILITARY.minArmySize) continue;
    const list = byCity.get(army.cityId) ?? [];
    list.push(army);
    byCity.set(army.cityId, list);
  }
  for (const cityId of [...new Set([...byCity.keys(), ...Object.keys(meta.sieges)])].sort()) {
    const city = world.cities.get(cityId);
    const armies = byCity.get(cityId) ?? [];
    if (!city) { delete meta.sieges[cityId]; continue; }
    const owner = city.ownerId;
    const attackers = armies.filter((a) => atWar(meta, a.ownerId, owner));
    const defenders = armies.filter((a) => !atWar(meta, a.ownerId, owner) && allied(meta, a.ownerId, owner));
    if (attackers.length === 0) {
      delete meta.sieges[cityId];
      continue;
    }
    const att = attackers.reduce((s, a) => s + attackStrength(a), 0);
    const def = defenders.reduce((s, a) => s + defenseStrength(a), 0) * MILITARY.defenderBonus;
    if (def > 0.01) {
      // Combat (modèle de Lanchester linéaire simplifié) : pertes proportionnelles au rapport de forces.
      const attLoss = Math.min(1, MILITARY.combatRate * (def / Math.max(att, 0.01)) * DT_DAYS);
      const defLoss = Math.min(1, MILITARY.combatRate * (att / def) * DT_DAYS);
      attackers.forEach((a) => scale(a, attLoss));
      defenders.forEach((a) => scale(a, defLoss));
      if (meta.sieges[cityId]) meta.sieges[cityId]!.progress = Math.max(0, meta.sieges[cityId]!.progress - DT_DAYS);
      continue;
    }
    // Siège : l'attaquant le plus puissant mène le siège.
    const byPlayer = new Map<string, number>();
    for (const a of attackers) byPlayer.set(a.ownerId, (byPlayer.get(a.ownerId) ?? 0) + siegePower(a));
    const [leader, power] = [...byPlayer.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]!;
    const fort = fortification(world, city);
    let siege = meta.sieges[cityId];
    if (!siege || siege.attackerId !== leader) {
      siege = { cityId, attackerId: leader, progress: 0 };
      meta.sieges[cityId] = siege;
      pushEvent(world, 'battle', `${cityName(cityId)} est assiégée par ${playerName(meta, leader)}.`, [leader, owner]);
    }
    siege.progress += MILITARY.siegeRate * (power / fort) * DT_DAYS;
    attackers.forEach((a) => scale(a, MILITARY.siegeAttrition * DT_DAYS));
    if (siege.progress >= 1) {
      delete meta.sieges[cityId];
      captureCity(world, city, leader);
    }
  }

  meta.armies = meta.armies.filter((a) => armySize(a) >= MILITARY.minArmySize);
}

/** Changement de propriétaire par conquête. Les bâtiments et la trésorerie restent à la ville. */
export function captureCity(world: World, city: CityState, newOwner: string) {
  const meta = world.meta;
  const previous = city.ownerId;
  changeOwner(world, city, newOwner);
  pushEvent(world, 'capture', `${playerName(meta, newOwner)} s'empare de ${cityName(city.cityId)} (ville de ${playerName(meta, previous)}).`, [newOwner, previous]);
}

export function changeOwner(world: World, city: CityState, newOwner: string) {
  const meta = world.meta;
  city.ownerId = newOwner;
  city.ownerName = playerName(meta, newOwner);
  // Contrats et cessions en cours liés à cette ville deviennent caducs.
  meta.contracts = meta.contracts.filter((c) => c.sellerCityId !== city.cityId && c.buyerCityId !== city.cityId);
  meta.treaties = meta.treaties.filter((t) => !(t.type === 'city_transfer' && t.terms?.cityId === city.cityId));
  // Les armées payées par cette ville pour l'ancien propriétaire sont rattachées ailleurs au tick suivant.
}
