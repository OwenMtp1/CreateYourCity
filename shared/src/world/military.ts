// Armées : déplacements, ravitaillement, solde, combats et sièges. Règles déterministes.
import { GAME_MINUTES_PER_TICK, DT_DAYS } from '../constants.ts';
import { LAW_EFFECTS, PROJECT_EFFECTS } from '../sim/modifiers.ts';
import type { CityState } from '../types.ts';
import { allied, armyPosition, atWar, cityName, distanceLatLonKm, fundedMeasures, hasBuilding, MILITARY, nextId, playerName, pushEvent, UNITS } from './rules.ts';
import { LAND_UNITS, UNIT_TYPES, type Army, type UnitType, type World } from './types.ts';

export const armySize = (a: Pick<Army, 'units'>) => UNIT_TYPES.reduce((s, u) => s + (a.units[u] ?? 0), 0);
export const landSize = (a: Pick<Army, 'units'>) => LAND_UNITS.reduce((s, u) => s + (a.units[u] ?? 0), 0);
export const hasUnit = (a: Pick<Army, 'units'>, u: UnitType) => (a.units[u] ?? 0) >= MILITARY.minArmySize;

/** Vitesse effective : unité la plus lente, ×3 par le rail entre deux gares amies, ÷2 en retraite. */
export function effectiveSpeed(world: World, a: Army): number {
  let speed = armySpeedKmh(a);
  if (a.movement && !hasUnit(a, 'navy') && !hasUnit(a, 'air')) {
    const from = world.cities.get(a.cityId);
    const to = world.cities.get(a.movement.toCityId);
    const friendly = (c: typeof from) => !!c && allied(world.meta, c.ownerId, a.ownerId) && hasBuilding(c, 'train_station');
    if (friendly(from) && friendly(to)) speed *= MILITARY.railSpeedFactor;
  }
  if (a.retreating) speed *= MILITARY.retreatSpeedFactor;
  // Aéroport international : les unités aériennes décollent et arrivent plus vite depuis le pays concerné.
  if (hasUnit(a, 'air') && a.movement) {
    const country = world.cities.get(a.cityId)?.countryId;
    if (fundedMeasures(country ? world.meta.nations[country] : undefined).projects.international_airport) {
      speed *= PROJECT_EFFECTS.international_airport.airSpeedFactor;
    }
  }
  return speed;
}

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
  const measures = fundedMeasures(nation);
  const factor = (measures.projects.national_defense ? PROJECT_EFFECTS.national_defense.fortificationFactor : 1) *
    (measures.laws.emergency ? LAW_EFFECTS.emergency.fortificationFactor : 1);
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
    if (army.movement && !(army.engaged && !army.retreating)) {
      army.movement.progressKm += effectiveSpeed(world, army) * hoursPerTick;
      if (army.movement.progressKm >= army.movement.totalKm) {
        const dest = army.movement.toCityId;
        army.cityId = dest;
        army.movement = null;
        army.retreating = false;
        const owner = world.cities.get(dest)?.ownerId;
        if (owner && atWar(meta, owner, army.ownerId)) {
          pushEvent(world, 'battle', `L'armée de ${playerName(meta, army.ownerId)} arrive devant ${cityName(dest)}.`, [army.ownerId, owner]);
        }
      }
    }
    const pos = armyPosition(army.cityId, army.movement);
    let supplied = false;
    for (const c of world.cities.values()) {
      const range = hasBuilding(c, 'train_station') ? MILITARY.railSupplyRangeKm : MILITARY.supplyRangeKm;
      if (allied(meta, c.ownerId, army.ownerId) && distanceLatLonKm(pos, c.cityId) <= range) {
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

  stepFieldBattles(world);

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
    // Flotte et aviation bombardent, mais seules des troupes au sol prennent la ville.
    const ground = attackers.filter((a) => a.ownerId === leader).reduce((s2, a) => s2 + landSize(a), 0);
    if (siege.progress >= 1 && ground < 1) siege.progress = 0.99;
    if (siege.progress >= 1) {
      delete meta.sieges[cityId];
      captureCity(world, city, leader);
    }
  }

  meta.armies = meta.armies.filter((a) => armySize(a) >= MILITARY.minArmySize);
}

/**
 * Batailles en rase campagne : deux armées ennemies en marche (hors retraite) à moins de 30 km
 * l'une de l'autre s'immobilisent et combattent sans bonus défensif.
 */
function stepFieldBattles(world: World) {
  const meta = world.meta;
  const armies = meta.armies.filter((a) => armySize(a) >= MILITARY.minArmySize);
  const pos = new Map(armies.map((a) => [a.id, armyPosition(a.cityId, a.movement)]));
  const engagedWith = new Map<number, Army[]>();
  for (let i = 0; i < armies.length; i++) {
    for (let j = i + 1; j < armies.length; j++) {
      const a = armies[i]!, b = armies[j]!;
      if (!atWar(meta, a.ownerId, b.ownerId)) continue;
      // Seules deux armées en marche se rencontrent en rase campagne ; une garnison combat dans sa ville.
      if (!a.movement || !b.movement) continue;
      if (a.retreating || b.retreating) continue;
      if (km(pos.get(a.id)!, pos.get(b.id)!) > MILITARY.engageKm) continue;
      engagedWith.set(a.id, [...(engagedWith.get(a.id) ?? []), b]);
      engagedWith.set(b.id, [...(engagedWith.get(b.id) ?? []), a]);
    }
  }
  const losses = new Map<number, number>();
  for (const a of armies) {
    const enemies = engagedWith.get(a.id);
    a.engaged = !!enemies;
    if (!enemies) continue;
    const att = enemies.reduce((s, e) => s + attackStrength(e), 0);
    const def = Math.max(defenseStrength(a), 0.01);
    losses.set(a.id, Math.min(1, MILITARY.combatRate * (att / def) * DT_DAYS));
  }
  for (const a of armies) if (losses.has(a.id)) scale(a, losses.get(a.id)!);

  // Suivi des batailles (une par paire d'armées) pour le journal et l'affichage.
  const active = new Set<string>();
  for (const a of armies) {
    for (const b of engagedWith.get(a.id) ?? []) {
      if (a.id > b.id) continue;
      const k = `${a.id}-${b.id}`;
      active.add(k);
      const pa = pos.get(a.id)!, pb = pos.get(b.id)!;
      const position: [number, number] = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
      const existing = meta.battles.find((x) => x.armies.join('-') === k);
      if (existing) existing.position = position;
      else {
        meta.battles.push({ id: nextId(meta), armies: [a.id, b.id], players: [a.ownerId, b.ownerId], position, sinceTick: world.tick });
        pushEvent(world, 'battle', `Bataille entre les armées de ${playerName(meta, a.ownerId)} et de ${playerName(meta, b.ownerId)}.`, [a.ownerId, b.ownerId]);
      }
    }
  }
  meta.battles = meta.battles.filter((x) => active.has(x.armies.join('-')));
}

function km(p: [number, number], q: [number, number]) {
  const rad = Math.PI / 180;
  const dLat = (q[0] - p[0]) * rad;
  const dLon = (q[1] - p[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * rad) * Math.cos(q[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
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
  // Une dictature conquise ou cédée réintègre son pays.
  if (city.independentSince !== undefined) {
    delete city.independentSince;
    city.rejoinedAtTick = world.tick;
  }
  // Contrats et cessions en cours liés à cette ville deviennent caducs.
  meta.contracts = meta.contracts.filter((c) => c.sellerCityId !== city.cityId && c.buyerCityId !== city.cityId);
  meta.treaties = meta.treaties.filter((t) => !(t.type === 'city_transfer' && t.terms?.cityId === city.cityId));
  // Une ville jumelée qui change de main perd son jumelage.
  meta.treaties = meta.treaties.filter((t) => !(t.type === 'twin' && (t.cities?.a === city.cityId || t.cities?.b === city.cityId)));
  // Les armées payées par cette ville pour l'ancien propriétaire sont rattachées ailleurs au tick suivant.
}
