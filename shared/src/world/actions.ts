// Actions de niveau « monde » des joueurs : diplomatie, commerce, armée, territoire, nation.
// Le serveur valide et applique ; toutes les règles sont ici et testées.
import { createCityState } from '../city.ts';
import { INDEPENDENCE, POPULATION_POLICY, TICKS_PER_DAY } from '../constants.ts';
import { LAW_EFFECTS, type LawId, type ProjectId } from '../sim/modifiers.ts';
import type { CityState } from '../types.ts';
import { CITY_BY_ID } from '../world.ts';
import { captureCity, changeOwner, fortification, landSize } from './military.ts';
import { countryName, evaluateNation, getNation } from './nations.ts';
import {
  activeTreaty, allied, ANNEXATION, annexationRangeKm, annexationTroops, atWar, cityName, citiesOf, distanceKm, eligibleVoters, EXPANSION, MILITARY, NATION, NATION_RELIEF, nationReliefDue,
  hasBuilding, isIndependent, NON_AGGRESSION_NOTICE_TICKS, travelLosses, nextId, ORGANIZATION, playerName, pushEvent, TREATY_LABEL, UNIT_REQUIRES, UNITS,
} from './rules.ts';
import { LAND_UNITS, UNIT_TYPES, type Army, type OrganizationKind, type TreatyType, type UnitType, type World } from './types.ts';
import { BUILDINGS } from '../catalog.ts';
import { armySize } from './military.ts';

export type WorldAction =
  | { type: 'transferFunds'; fromCityId: string; toCityId: string; amount: number }
  /** Solde tout ou partie de la dette d'une ville de ma nation, payée avec la trésorerie d'une de mes villes. */
  | { type: 'payDebt'; fromCityId: string; toCityId: string; amount: number }
  /** Propose de jumeler ma ville avec une ville d'un autre joueur. */
  | { type: 'proposeTwin'; to: string; myCityId: string; otherCityId: string }
  /** Déplace des habitants d'une de vos villes vers une autre ; payé par la ville d'origine. */
  | { type: 'transferResidents'; fromCityId: string; toCityId: string; count: number }
  | { type: 'proposeTreaty'; to: string; treaty: TreatyType; cityId?: string; price?: number; payFromCityId?: string; nation?: { from: string; to: string } }
  | { type: 'respondTreaty'; treatyId: number; accept: boolean; payFromCityId?: string }
  | { type: 'cancelTreaty'; treatyId: number }
  | { type: 'declareWar'; target: string }
  | { type: 'declareNationalWar'; countryId: string; targetCountryId: string }
  | { type: 'proposeContract'; myCityId: string; otherCityId: string; direction: 'sell' | 'buy'; qtyPerDay: number; pricePerUnit: number; days: number }
  | { type: 'respondContract'; contractId: number; accept: boolean }
  | { type: 'cancelContract'; contractId: number }
  | { type: 'recruit'; cityId: string; unit: UnitType; count: number }
  | { type: 'moveArmy'; armyId: number; toCityId: string; units?: Partial<Record<UnitType, number>> }
  | { type: 'disbandArmy'; armyId: number }
  | { type: 'runForLeader'; countryId: string; run: boolean }
  | { type: 'vote'; countryId: string; candidateId: string | null }
  | { type: 'impeach'; countryId: string; support: boolean }
  | { type: 'resign'; countryId: string }
  | { type: 'setNationalTax'; countryId: string; rate: number }
  | { type: 'setLaw'; countryId: string; law: LawId; enabled: boolean }
  | { type: 'fundProject'; countryId: string; project: ProjectId }
  /** Dirigeant : aide de la Communauté internationale (dette effacée, ou versement si la nation n'a pas de dette). */
  | { type: 'claimNationRelief'; countryId: string }
  | { type: 'nationalGrant'; countryId: string; toCityId: string; amount: number }
  | { type: 'createOrganization'; name: string; kind: OrganizationKind }
  | { type: 'inviteToOrganization'; orgId: number; playerId: string }
  | { type: 'respondOrganization'; orgId: number; accept: boolean }
  | { type: 'leaveOrganization'; orgId: number }
  | { type: 'expelFromOrganization'; orgId: number; playerId: string }
  | { type: 'setTariff'; countryId: string; rate: number }
  /** Sécession : la ville devient une dictature indépendante (ou réintègre son pays). */
  | { type: 'secede'; cityId: string }
  | { type: 'rejoinCountry'; cityId: string }
  /** Annexion par la force de la ville d'un autre joueur ; `betray` est requis si vous êtes liés par un accord. */
  | { type: 'annexByForce'; fromCityId: string; cityId: string; troops?: number; betray?: boolean }
  /** Destinataire : identifiant de joueur ou « org:<id> » pour le canal d'une organisation. */
  | { type: 'sendMessage'; to: string; text: string };

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Action refusée par les règles du jeu (message destiné au joueur). */
export class RuleError extends Error {}
const fail = (msg: string): never => { throw new RuleError(msg); };
const fmt = (v: number) => Math.round(v).toLocaleString('fr-FR');
/** « de Paris », « d'Orléans » (élision devant une voyelle ou un h). */
const ofCity = (cityId: string) => {
  const n = cityName(cityId);
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(n) ? `d'${n}` : `de ${n}`;
};

function ownCity(world: World, player: string, cityId: string): CityState {
  const c = world.cities.get(cityId);
  if (!c || c.ownerId !== player) fail('Vous ne dirigez pas cette ville.');
  return c!;
}

function requireLeader(world: World, player: string, countryId: string) {
  const nation = world.meta.nations[countryId];
  if (!nation || nation.leaderId !== player) fail(`Seul le dirigeant national de ${countryName(countryId)} peut faire cela.`);
  return nation!;
}

function requirePlayer(world: World, id: string) {
  if (!world.meta.players[id]) fail('Joueur inconnu dans ce salon.');
}

/** Coût et validité d'une expansion vers une ville neutre (sans écrire). */
export function checkExpansion(world: World, player: string, fromCityId: string, cityId: string): { cost: number; city: CityState } {
  const from = ownCity(world, player, fromCityId);
  const target = CITY_BY_ID.get(cityId);
  if (!target) fail('Ville inconnue.');
  if (world.cities.has(cityId)) fail('Cette ville appartient déjà à un joueur.');
  if (citiesOf(world, player).length >= EXPANSION.maxCitiesPerPlayer) fail(`Limite de ${EXPANSION.maxCitiesPerPlayer} villes atteinte.`);
  const d = distanceKm(fromCityId, cityId);
  if (d > EXPANSION.maxDistanceKm) fail(`Trop loin : ${fmt(d)} km (maximum ${EXPANSION.maxDistanceKm} km depuis ${cityName(fromCityId)}).`);
  const cost = Math.round(EXPANSION.baseCost + EXPANSION.costPerKm * d);
  if (from.treasury < cost) fail(`Fonds insuffisants à ${cityName(fromCityId)} (${fmt(cost)} cr requis).`);
  const city = createCityState({ cityId, countryId: target!.countryId, ownerId: player, ownerName: playerName(world.meta, player), tick: world.tick });
  city.treasury = 0;
  return { cost, city };
}

/** Applique une expansion déjà enregistrée en base. Le prix revient au trésor du pays de la ville achetée. */
export function commitExpansion(world: World, player: string, fromCityId: string, city: CityState, cost: number) {
  const from = ownCity(world, player, fromCityId);
  from.treasury -= cost;
  getNation(world, city.countryId).treasury += cost;
  world.cities.set(city.cityId, city);
  pushEvent(world, 'expansion',
    `${playerName(world.meta, player)} achète ${cityName(city.cityId)} : ${fmt(cost)} cr versés au trésor national (${countryName(city.countryId)}).`,
    [player, ...eligibleVoters(world, city.countryId)]);
  evaluateNation(world, city.countryId);
}

export interface ForcePlan {
  distance: number;
  /** Soldats envoyés, perdus en route, arrivés sur place. */
  sent: number;
  travelLoss: number;
  arriving: number;
}

/** Armées immobiles du joueur dans une ville : ce sont elles qui partent annexer. */
const stationed = (world: World, player: string, cityId: string) =>
  world.meta.armies.filter((a) => a.ownerId === player && a.cityId === cityId && !a.movement);

/** Garnison d'une ville : armées immobiles de son propriétaire et de ses alliés. */
const garrison = (world: World, city: CityState) =>
  world.meta.armies.filter((a) => a.cityId === city.cityId && !a.movement && allied(world.meta, a.ownerId, city.ownerId));

/** Défense d'une ville de joueur en équivalent soldats (inconnue de l'assaillant avant l'attaque). */
export function cityDefense(world: World, city: CityState): number {
  return ANNEXATION.perDefender * garrison(world, city).reduce((s, a) => s + landSize(a), 0)
    + ANNEXATION.perFortification * fortification(world, city);
}

/**
 * Prépare l'envoi de `troops` soldats (par défaut tous ceux stationnés) vers une ville, sans rien modifier.
 * Sans port ni base aérienne dans la ville de départ, la portée est limitée.
 */
export function forcedAnnexationPlan(world: World, player: string, fromCityId: string, cityId: string, troops?: number): ForcePlan {
  const from = ownCity(world, player, fromCityId);
  if (!CITY_BY_ID.get(cityId)) fail('Ville inconnue.');
  const target = world.cities.get(cityId);
  if (target?.ownerId === player) fail('Cette ville est déjà à vous.');
  if (citiesOf(world, player).length >= EXPANSION.maxCitiesPerPlayer) fail(`Limite de ${EXPANSION.maxCitiesPerPlayer} villes atteinte.`);
  const distance = distanceKm(fromCityId, cityId);
  if (distance > annexationRangeKm(from)) {
    fail(`Trop loin : ${fmt(distance)} km. Sans port ni base aérienne à ${cityName(fromCityId)}, la portée est de ${EXPANSION.maxDistanceKm} km.`);
  }
  const available = Math.floor(stationed(world, player, fromCityId).reduce((s, a) => s + landSize(a), 0));
  const sent = Math.floor(troops ?? available);
  if (!(sent >= 1)) fail(`Aucun soldat stationné à ${cityName(fromCityId)}.`);
  if (sent > available) fail(`Seulement ${fmt(available)} soldat(s) stationné(s) à ${cityName(fromCityId)}.`);
  const travelLoss = travelLosses(distance);
  const arriving = sent - travelLoss;
  if (arriving < ANNEXATION.baseTroops) {
    fail(`Trop peu de soldats : ${fmt(travelLoss)} seraient perdus en route sur ${fmt(distance)} km, il en faut au moins ${fmt(annexationTroops(distance))}.`);
  }
  return { distance, sent, travelLoss, arriving };
}

/**
 * Les soldats envoyés quittent la ville de départ (au prorata de chaque armée) ; `survivors` d'entre eux
 * forment la garnison de la ville prise (0 : tous perdus).
 */
function dispatch(world: World, player: string, fromCityId: string, cityId: string, plan: ForcePlan, survivors: number) {
  const meta = world.meta;
  const armies = stationed(world, player, fromCityId);
  const available = armies.reduce((s, a) => s + landSize(a), 0);
  if (available <= 0) return;
  const share = Math.min(1, plan.sent / available);
  const keep = Math.max(0, Math.min(1, survivors / plan.sent));
  const units = Object.fromEntries(UNIT_TYPES.map((u) => [u, 0])) as Army['units'];
  for (const a of armies) {
    for (const u of LAND_UNITS) {
      const moved = a.units[u] * share;
      a.units[u] -= moved;
      units[u] += moved * keep;
    }
  }
  meta.armies = meta.armies.filter((a) => !armies.includes(a) || armySize(a) >= MILITARY.minArmySize);
  if (keep > 0) meta.armies.push({ id: nextId(meta), ownerId: player, homeCityId: fromCityId, units, cityId, movement: null, supplied: true, paid: true });
}

/** Annexion par la force d'une ville neutre, déjà enregistrée en base : aucun paiement, les troupes l'occupent. */
export function commitForcedAnnexation(world: World, player: string, fromCityId: string, city: CityState, plan: ForcePlan) {
  dispatch(world, player, fromCityId, city.cityId, plan, plan.arriving * (1 - ANNEXATION.lossesNeutral));
  world.cities.set(city.cityId, city);
  pushEvent(world, 'expansion',
    `${playerName(world.meta, player)} annexe ${cityName(city.cityId)} par la force (${fmt(plan.sent)} soldats envoyés depuis ${cityName(fromCityId)}, ${fmt(plan.travelLoss)} perdus en route).`,
    [player, ...eligibleVoters(world, city.countryId)]);
  evaluateNation(world, city.countryId);
}

/** Vérifie une annexion par la force d'une ville neutre et prépare son état (sans écrire). */
export function checkForcedAnnexation(world: World, player: string, fromCityId: string, cityId: string, troops?: number): { plan: ForcePlan; city: CityState } {
  if (world.cities.has(cityId)) fail('Cette ville appartient à un joueur : utilisez l\'annexion de ville ennemie.');
  const plan = forcedAnnexationPlan(world, player, fromCityId, cityId, troops);
  const target = CITY_BY_ID.get(cityId)!;
  const city = createCityState({ cityId, countryId: target.countryId, ownerId: player, ownerName: playerName(world.meta, player), tick: world.tick });
  city.treasury = 0;
  return { plan, city };
}

export function applyWorldAction(world: World, player: string, action: WorldAction, now = new Date()): ActionResult {
  try {
    run(world, player, action, now);
    return { ok: true };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message };
    throw e;
  }
}

function run(world: World, player: string, action: WorldAction, now: Date) {
  const meta = world.meta;
  const name = (id: string) => playerName(meta, id);
  switch (action.type) {
    case 'proposeTwin': {
      requirePlayer(world, action.to);
      if (action.to === player) fail('Vous ne pouvez pas jumeler deux de vos villes.');
      const mine = ownCity(world, player, action.myCityId);
      const other = world.cities.get(action.otherCityId);
      if (!other || other.ownerId !== action.to) fail("La ville jumelle doit appartenir à ce joueur.");
      if (atWar(meta, player, action.to)) fail('Impossible pendant une guerre.');
      const busy = (id: string) => meta.treaties.some((t) => t.type === 'twin' && !!t.cities && (t.cities.a === id || t.cities.b === id));
      if (busy(mine.cityId) || busy(other!.cityId)) fail('Une de ces villes est déjà jumelée.');
      meta.treaties.push({
        id: nextId(meta), type: 'twin', a: player, b: action.to, status: 'proposed',
        proposedAtTick: world.tick, activeSinceTick: null, endsAtTick: null,
        cities: { a: mine.cityId, b: other!.cityId },
      });
      pushEvent(world, 'treaty', `${name(player)} propose de jumeler ${cityName(mine.cityId)} avec ${cityName(other!.cityId)}.`, [player, action.to], true);
      return;
    }

    case 'transferResidents': {
      const from = ownCity(world, player, action.fromCityId);
      const to = ownCity(world, player, action.toCityId);
      if (to.cityId === from.cityId) fail('Choisissez une autre ville.');
      const count = Math.floor(action.count);
      if (!(count >= 1)) fail('Nombre d\'habitants invalide.');
      const free = Math.max(0, (to.stats?.housingCapacity ?? 0) - to.population);
      if (count > Math.floor(from.population)) fail(`Seulement ${fmt(from.population)} habitant(s) à ${cityName(from.cityId)}.`);
      if (count > Math.floor(free)) fail(`Logements libres à ${cityName(to.cityId)} : ${fmt(free)}.`);
      const cost = Math.round(count * (POPULATION_POLICY.transferBaseCost + POPULATION_POLICY.transferCostPerKm * distanceKm(from.cityId, to.cityId)));
      if (from.treasury < cost) fail(`Fonds insuffisants à ${cityName(from.cityId)} (${fmt(cost)} cr requis).`);
      from.treasury -= cost;
      from.population -= count;
      to.population += count;
      pushEvent(world, 'transfer', `${name(player)} transfère ${fmt(count)} habitant(s) de ${cityName(from.cityId)} à ${cityName(to.cityId)}.`, [player], true);
      return;
    }

    case 'payDebt': {
      const from = ownCity(world, player, action.fromCityId);
      const to = world.cities.get(action.toCityId);
      if (!to) fail('Ville introuvable.');
      if (to!.countryId !== from.countryId) fail("Vous ne pouvez solder que les dettes de votre nation.");
      if (to!.debt <= 0) fail("Cette ville n'a pas de dette.");
      const amount = Math.min(Math.floor(action.amount), to!.debt);
      if (!(amount > 0)) fail('Montant invalide.');
      if (amount > from.treasury) fail('Trésorerie insuffisante.');
      from.treasury -= amount;
      to!.debt -= amount;
      pushEvent(world, 'funds', `${name(player)} solde ${fmt(amount)} cr de la dette de ${cityName(to!.cityId)}.`, [player, to!.ownerId], true);
      return;
    }
    case 'transferFunds': {
      const from = ownCity(world, player, action.fromCityId);
      const to = world.cities.get(action.toCityId);
      if (!to) fail('Ville destinataire inconnue.');
      if (to!.cityId === from.cityId) fail('Choisissez une autre ville.');
      const amount = Math.floor(action.amount);
      if (!(amount > 0)) fail('Montant invalide.');
      if (amount > from.treasury) fail('Trésorerie insuffisante.');
      if (atWar(meta, player, to!.ownerId)) fail('Impossible de financer un ennemi.');
      from.treasury -= amount;
      to!.treasury += amount;
      if (to!.ownerId !== player) {
        pushEvent(world, 'funds', `${name(player)} verse ${fmt(amount)} cr à ${cityName(to!.cityId)} (${name(to!.ownerId)}).`, [player, to!.ownerId], true);
      }
      return;
    }

    case 'proposeTreaty': {
      if (action.treaty === 'twin') fail('Le jumelage relie deux villes : utilisez « Jumeler ».');
      if (action.nation) return proposeNationalTreaty(world, player, action);
      requirePlayer(world, action.to);
      if (action.to === player) fail('Vous ne pouvez pas traiter avec vous-même.');
      const war = atWar(meta, player, action.to);
      if (action.treaty === 'peace' && !war) fail("Vous n'êtes pas en guerre avec ce joueur.");
      if (action.treaty !== 'peace' && action.treaty !== 'city_transfer' && war) fail("Impossible pendant une guerre : proposez d'abord la paix.");
      const dup = meta.treaties.find((t) => t.type === action.treaty && t.type !== 'city_transfer' && !t.nations &&
        ((t.a === player && t.b === action.to) || (t.a === action.to && t.b === player)));
      if (dup) fail(dup.status === 'active' ? 'Ce traité est déjà en vigueur.' : 'Une proposition identique est en attente.');
      let terms;
      if (action.treaty === 'city_transfer') {
        const city = world.cities.get(action.cityId ?? '');
        if (!city || (city.ownerId !== player && city.ownerId !== action.to)) fail("La ville cédée doit appartenir à l'une des deux parties.");
        const price = Math.floor(action.price ?? 0);
        if (!(price >= 0)) fail('Prix invalide.');
        const seller = city!.ownerId;
        if (seller !== player) {
          // Je suis l'acheteur : je désigne la ville qui paiera.
          const payer = ownCity(world, player, action.payFromCityId ?? '');
          if (payer.treasury < price) fail('Trésorerie insuffisante pour ce prix.');
        }
        if (citiesOf(world, seller).length <= 1 && seller === player) fail('Vous ne pouvez pas céder votre dernière ville.');
        terms = { cityId: city!.cityId, seller, price, ...(seller !== player ? { payFromCityId: action.payFromCityId } : {}) };
      }
      meta.treaties.push({
        id: nextId(meta), type: action.treaty, a: player, b: action.to, status: 'proposed',
        proposedAtTick: world.tick, activeSinceTick: null, endsAtTick: null, ...(terms ? { terms } : {}),
      });
      pushEvent(world, 'treaty', `${name(player)} propose : ${TREATY_LABEL[action.treaty]} à ${name(action.to)}.`, [player, action.to], true);
      return;
    }

    case 'respondTreaty': {
      const t = meta.treaties.find((x) => x.id === action.treatyId);
      if (!t || t.status !== 'proposed') fail('Proposition introuvable.');
      if (t!.b !== player) fail("Cette proposition ne vous est pas adressée.");
      if (!action.accept) {
        meta.treaties = meta.treaties.filter((x) => x !== t);
        pushEvent(world, 'treaty', `${name(player)} refuse : ${TREATY_LABEL[t!.type]} proposé par ${name(t!.a)}.`, [t!.a, t!.b], true);
        return;
      }
      if (t!.type === 'peace') {
        const before = meta.wars.length;
        if (t!.nations) {
          const { a, b } = t!.nations;
          meta.wars = meta.wars.filter((w) => !(w.nations && ((w.nations.a === a && w.nations.b === b) || (w.nations.a === b && w.nations.b === a))));
        }
        meta.wars = meta.wars.filter((w) => !((w.a === t!.a && w.b === t!.b) || (w.a === t!.b && w.b === t!.a)));
        meta.treaties = meta.treaties.filter((x) => x !== t);
        const scope = t!.nations ? `${countryName(t!.nations.a)} et ${countryName(t!.nations.b)}` : `${name(t!.a)} et ${name(t!.b)}`;
        pushEvent(world, 'peace', `Paix signée entre ${scope} (${before - meta.wars.length} conflit(s) terminé(s)).`);
        return;
      }
      if (t!.type === 'city_transfer') {
        const terms = t!.terms!;
        const city = world.cities.get(terms.cityId);
        if (!city || city.ownerId !== terms.seller) fail('La ville a changé de propriétaire : cession annulée.');
        const buyer = terms.seller === t!.a ? t!.b : t!.a;
        const payFrom = terms.payFromCityId ?? action.payFromCityId;
        const payer = ownCity(world, buyer, payFrom ?? '');
        if (payer.treasury < terms.price) fail(`Fonds insuffisants à ${cityName(payer.cityId)}.`);
        if (citiesOf(world, terms.seller).length <= 1) fail('Le vendeur ne peut pas céder sa dernière ville.');
        payer.treasury -= terms.price;
        const sellerCity = citiesOf(world, terms.seller).find((id) => id !== terms.cityId)!;
        world.cities.get(sellerCity)!.treasury += terms.price;
        meta.treaties = meta.treaties.filter((x) => x !== t);
        changeOwner(world, city!, buyer);
        pushEvent(world, 'transfer', `${cityName(terms.cityId)} est cédée par ${name(terms.seller)} à ${name(buyer)} pour ${fmt(terms.price)} cr.`);
        evaluateNation(world, city!.countryId);
        return;
      }
      if (atWar(meta, t!.a, t!.b)) fail('Impossible pendant une guerre.');
      t!.status = 'active';
      t!.activeSinceTick = world.tick;
      const publicTreaty = ['alliance', 'defense', 'non_aggression'].includes(t!.type);
      pushEvent(world, 'treaty', `${TREATY_LABEL[t!.type]} signé entre ${name(t!.a)} et ${name(t!.b)}.`, [t!.a, t!.b], !publicTreaty);
      return;
    }

    case 'cancelTreaty': {
      const t = meta.treaties.find((x) => x.id === action.treatyId);
      if (!t || (t.a !== player && t.b !== player)) fail('Traité introuvable.');
      if (t!.status === 'proposed') {
        meta.treaties = meta.treaties.filter((x) => x !== t);
        return;
      }
      if (t!.type === 'non_aggression') {
        if (t!.endsAtTick !== null) fail('Résiliation déjà notifiée.');
        t!.endsAtTick = world.tick + NON_AGGRESSION_NOTICE_TICKS;
        pushEvent(world, 'treaty_end', `${name(player)} dénonce le pacte de non-agression avec ${name(t!.a === player ? t!.b : t!.a)} (préavis d'un jour).`, [t!.a, t!.b]);
        return;
      }
      meta.treaties = meta.treaties.filter((x) => x !== t);
      pushEvent(world, 'treaty_end', `${name(player)} met fin à : ${TREATY_LABEL[t!.type]} avec ${name(t!.a === player ? t!.b : t!.a)}.`, [t!.a, t!.b]);
      return;
    }

    case 'declareWar': {
      requirePlayer(world, action.target);
      if (action.target === player) fail('Cible invalide.');
      if (citiesOf(world, player).length === 0) fail('Il vous faut au moins une ville.');
      declareWar(world, player, action.target);
      pushEvent(world, 'war', `${name(player)} déclare la guerre à ${name(action.target)}.`);
      return;
    }

    case 'declareNationalWar': {
      requireLeader(world, player, action.countryId);
      if (action.countryId === action.targetCountryId) fail('Cible invalide.');
      const ours = eligibleVoters(world, action.countryId);
      const theirs = eligibleVoters(world, action.targetCountryId);
      if (theirs.length === 0) fail("Aucun joueur n'est présent dans ce pays.");
      let n = 0;
      for (const x of ours) for (const y of theirs) {
        if (x === y || atWar(meta, x, y)) continue;
        // La décision nationale prime : les traités bilatéraux incompatibles tombent.
        meta.treaties = meta.treaties.filter((t) => !((t.a === x && t.b === y) || (t.a === y && t.b === x)) || t.type === 'peace');
        meta.wars.push({ id: nextId(meta), a: x, b: y, sinceTick: world.tick, nations: { a: action.countryId, b: action.targetCountryId } });
        meta.contracts = meta.contracts.filter((c) => !((c.sellerId === x && c.buyerId === y) || (c.sellerId === y && c.buyerId === x)));
        n++;
      }
      pushEvent(world, 'war', `${countryName(action.countryId)} déclare la guerre à ${countryName(action.targetCountryId)} (${n} conflit(s) entre joueurs).`);
      return;
    }

    case 'proposeContract': {
      const mine = ownCity(world, player, action.myCityId);
      const other = world.cities.get(action.otherCityId);
      if (!other || other.ownerId === player) fail("Choisissez une ville d'un autre joueur.");
      if (isIndependent(mine) || isIndependent(other)) fail("Une dictature indépendante ne commerce pas avec l'extérieur.");
      if (atWar(meta, player, other!.ownerId)) fail('Pas de commerce avec un ennemi.');
      const qty = Math.floor(action.qtyPerDay);
      const days = Math.floor(action.days);
      const price = Math.round(action.pricePerUnit * 100) / 100;
      if (!(qty >= 1 && qty <= 10_000)) fail('Quantité entre 1 et 10 000 par jour.');
      if (!(days >= 1 && days <= 360)) fail('Durée entre 1 et 360 jours.');
      if (!(price > 0 && price <= 100)) fail('Prix unitaire entre 0 et 100 cr.');
      const sell = action.direction === 'sell';
      meta.contracts.push({
        id: nextId(meta),
        sellerId: sell ? player : other!.ownerId, sellerCityId: sell ? mine.cityId : other!.cityId,
        buyerId: sell ? other!.ownerId : player, buyerCityId: sell ? other!.cityId : mine.cityId,
        qtyPerDay: qty, pricePerUnit: price, days, proposedBy: player, status: 'proposed', startTick: null, endTick: null, deliveredRatio: 1,
      });
      pushEvent(world, 'contract', `${name(player)} propose un contrat de ${qty} biens/j à ${fmt(price)} cr à ${name(other!.ownerId)}.`, [player, other!.ownerId], true);
      return;
    }

    case 'respondContract': {
      const c = meta.contracts.find((x) => x.id === action.contractId);
      if (!c || c.status !== 'proposed') fail('Proposition introuvable.');
      const counterpart = c!.proposedBy === c!.sellerId ? c!.buyerId : c!.sellerId;
      if (counterpart !== player) fail("Cette proposition ne vous est pas adressée.");
      if (!action.accept) {
        meta.contracts = meta.contracts.filter((x) => x !== c);
        return;
      }
      if (atWar(meta, c!.sellerId, c!.buyerId)) fail('Pas de commerce avec un ennemi.');
      c!.status = 'active';
      c!.startTick = world.tick;
      c!.endTick = world.tick + c!.days * TICKS_PER_DAY;
      pushEvent(world, 'contract', `Contrat signé : ${cityName(c!.sellerCityId)} livre ${c!.qtyPerDay} biens/j à ${cityName(c!.buyerCityId)}.`, [c!.sellerId, c!.buyerId], true);
      return;
    }

    case 'cancelContract': {
      const c = meta.contracts.find((x) => x.id === action.contractId);
      if (!c || (c.sellerId !== player && c.buyerId !== player)) fail('Contrat introuvable.');
      meta.contracts = meta.contracts.filter((x) => x !== c);
      pushEvent(world, 'contract', `${name(player)} met fin au contrat ${cityName(c!.sellerCityId)} → ${cityName(c!.buyerCityId)}.`, [c!.sellerId, c!.buyerId], true);
      return;
    }

    case 'recruit': {
      const city = ownCity(world, player, action.cityId);
      const required = UNIT_REQUIRES[action.unit];
      if (!city.buildings.some((b) => b.type === required)) fail(`${BUILDINGS[required].label} nécessaire pour recruter : ${UNITS[action.unit].label.toLowerCase()}.`);
      const count = Math.floor(action.count);
      if (!(count >= 1 && count <= 1000)) fail('Effectif entre 1 et 1 000.');
      const enlisted = meta.armies.filter((a) => a.homeCityId === city.cityId).reduce((s, a) => s + armySize(a), 0);
      const cap = Math.floor(city.population * MILITARY.mobilizationShare);
      if (enlisted + count > cap) fail(`Mobilisation limitée à 5 % de la population : ${Math.max(0, cap - Math.ceil(enlisted))} recrue(s) possible(s).`);
      const nation = meta.nations[city.countryId];
      const factor = nation?.laws.conscription ? LAW_EFFECTS.conscription.recruitCostFactor : 1;
      const cost = Math.round(UNITS[action.unit].cost * count * factor);
      if (city.treasury < cost) fail(`Fonds insuffisants (${fmt(cost)} cr requis).`);
      city.treasury -= cost;
      let army = meta.armies.find((a) => a.ownerId === player && a.cityId === city.cityId && !a.movement);
      if (!army) {
        army = { id: nextId(meta), ownerId: player, homeCityId: city.cityId, units: emptyUnits(), cityId: city.cityId, movement: null, supplied: true, paid: true };
        meta.armies.push(army);
      }
      army.units[action.unit] += count;
      return;
    }

    case 'moveArmy': {
      const army = meta.armies.find((a) => a.id === action.armyId);
      if (!army || army.ownerId !== player) fail('Armée introuvable.');
      const target = CITY_BY_ID.get(action.toCityId);
      if (!target) fail('Destination inconnue.');
      if (action.toCityId === army!.cityId && !army!.movement) fail("L'armée est déjà sur place.");
      const owner = world.cities.get(action.toCityId)?.ownerId;
      if (owner && !allied(meta, owner, player) && !atWar(meta, owner, player)) {
        fail(`${cityName(action.toCityId)} appartient à ${name(owner)} : il faut une alliance ou un accord de défense pour y entrer, ou être en guerre.`);
      }
      // Armée engagée en rase campagne : seule la retraite vers sa ville de départ est possible.
      if (army!.engaged && army!.movement) {
        if (action.toCityId !== army!.cityId) fail(`Armée engagée au combat : seule la retraite vers ${cityName(army!.cityId)} est possible.`);
        const m = army!.movement;
        army!.movement = { toCityId: army!.cityId, progressKm: Math.max(0, m.totalKm - m.progressKm), totalKm: m.totalKm };
        army!.cityId = m.toCityId;
        army!.retreating = true;
        return;
      }
      // Une armée en mouvement repart de sa ville de départ (demi-tour simplifié).
      const fromCity = army!.movement && army!.movement.progressKm > army!.movement.totalKm / 2 ? army!.movement.toCityId : army!.cityId;
      const d = distanceKm(fromCity, action.toCityId);
      if (d > MILITARY.maxMoveKm) fail(`Trop loin (${fmt(d)} km, maximum ${MILITARY.maxMoveKm} km par ordre).`);
      const units = action.units ? Object.fromEntries(UNIT_TYPES.map((u) => [u, Math.floor(action.units![u] ?? 0)])) as Record<UnitType, number> : army!.units;
      if (units.navy >= 0.5 && !hasBuilding(world.cities.get(action.toCityId), 'port')) {
        fail('La flotte ne peut rejoindre qu\'une ville dotée d\'un port.');
      }
      const onlyAir = UNIT_TYPES.every((u) => u === 'air' || units[u] < 0.5) && units.air >= 0.5;
      if (onlyAir && d > MILITARY.maxAirMoveKm) fail(`Rayon d'action de l'aviation : ${MILITARY.maxAirMoveKm} km.`);
      let moving = army!;
      if (action.units) {
        const split = emptyUnits();
        for (const u of UNIT_TYPES) {
          const n = Math.floor(action.units[u] ?? 0);
          if (n < 0 || n > army!.units[u] + 1e-9) fail('Effectifs insuffisants pour ce détachement.');
          split[u] = Math.min(n, army!.units[u]);
        }
        if (armySize({ units: split }) < 1) fail('Détachement vide.');
        if (armySize({ units: split }) < armySize(army!) - 1e-9) {
          for (const u of UNIT_TYPES) army!.units[u] -= split[u];
          moving = { ...army!, id: nextId(meta), units: split, movement: null };
          meta.armies.push(moving);
        }
      }
      moving.cityId = fromCity;
      moving.movement = { toCityId: action.toCityId, progressKm: 0, totalKm: d };
      return;
    }

    case 'disbandArmy': {
      const army = meta.armies.find((a) => a.id === action.armyId);
      if (!army || army.ownerId !== player) fail('Armée introuvable.');
      meta.armies = meta.armies.filter((a) => a !== army);
      return;
    }

    case 'runForLeader': {
      if (!eligibleVoters(world, action.countryId).includes(player)) fail(`Il faut posséder une ville en ${countryName(action.countryId)}.`);
      const nation = getNation(world, action.countryId);
      if (nation.laws.emergency) fail("Élections suspendues pendant l'état d'urgence.");
      if (action.run) {
        if (nation.leaderId === player) fail('Vous dirigez déjà ce pays.');
        if (!nation.candidates.includes(player)) nation.candidates.push(player);
      } else {
        nation.candidates = nation.candidates.filter((c) => c !== player);
      }
      evaluateNation(world, action.countryId);
      return;
    }

    case 'vote': {
      if (!eligibleVoters(world, action.countryId).includes(player)) fail(`Il faut posséder une ville en ${countryName(action.countryId)} pour voter.`);
      const nation = getNation(world, action.countryId);
      if (nation.laws.emergency) fail("Élections suspendues pendant l'état d'urgence.");
      if (action.candidateId === null) delete nation.votes[player];
      else {
        if (!nation.candidates.includes(action.candidateId)) fail("Ce joueur n'est pas candidat.");
        nation.votes[player] = action.candidateId;
      }
      evaluateNation(world, action.countryId);
      return;
    }

    case 'impeach': {
      if (!eligibleVoters(world, action.countryId).includes(player)) fail('Seuls les électeurs du pays peuvent voter la destitution.');
      const nation = getNation(world, action.countryId);
      if (nation.laws.emergency) fail("Élections suspendues pendant l'état d'urgence.");
      if (!nation.leaderId) fail("Ce pays n'a pas de dirigeant.");
      nation.impeach = nation.impeach.filter((p) => p !== player);
      if (action.support) nation.impeach.push(player);
      evaluateNation(world, action.countryId);
      return;
    }

    case 'resign': {
      const nation = requireLeader(world, player, action.countryId);
      nation.leaderId = null;
      nation.electedAtTick = null;
      nation.votes = {};
      nation.impeach = [];
      pushEvent(world, 'resignation', `${name(player)} démissionne de la direction de ${countryName(action.countryId)}.`);
      return;
    }

    case 'setNationalTax': {
      const nation = requireLeader(world, player, action.countryId);
      const cap = nation.laws.emergency ? LAW_EFFECTS.emergency.maxTaxRate : NATION.maxTaxRate;
      if (!(action.rate >= 0 && action.rate <= cap)) fail(`Taux national entre 0 et ${cap * 100} %.`);
      nation.taxRate = Math.round(action.rate * 1000) / 1000;
      pushEvent(world, 'law', `${countryName(action.countryId)} : impôt national fixé à ${(nation.taxRate * 100).toFixed(1)} %.`);
      return;
    }

    case 'setLaw': {
      const nation = requireLeader(world, player, action.countryId);
      nation.laws[action.law] = action.enabled;
      pushEvent(world, 'law', `${countryName(action.countryId)} : loi « ${LAW_LABEL[action.law]} » ${action.enabled ? 'adoptée' : 'abrogée'}.`);
      return;
    }

    case 'fundProject': {
      const nation = requireLeader(world, player, action.countryId);
      if (nation.projects[action.project]) fail('Projet déjà réalisé.');
      const cost = NATION.projectCost[action.project];
      if (nation.treasury < cost) fail(`Budget national insuffisant (${fmt(cost)} cr requis).`);
      nation.treasury -= cost;
      nation.projects[action.project] = true;
      pushEvent(world, 'project', `${countryName(action.countryId)} réalise le grand projet « ${PROJECT_LABEL[action.project]} ».`);
      return;
    }

    case 'claimNationRelief': {
      const nation = requireLeader(world, player, action.countryId);
      if (!nationReliefDue(world.tick, nation)) fail("Aucune aide disponible : elle est accordée tous les 2 000 jours.");
      nation.reliefClaimed = (nation.reliefClaimed ?? 0) + 1;
      const indebted = [...world.cities.values()].filter((c) => c.countryId === action.countryId && c.debt > 0);
      const debt = indebted.reduce((s, c) => s + c.debt, 0);
      if (debt > 0) {
        for (const c of indebted) c.debt = 0;
        nation.treasury = 0;
        pushEvent(world, 'funds', `La Communauté internationale efface la dette de ${countryName(action.countryId)} (${fmt(debt)} cr).`);
      } else {
        nation.treasury += NATION_RELIEF.aid;
        pushEvent(world, 'funds', `La Communauté internationale verse ${fmt(NATION_RELIEF.aid)} cr à ${countryName(action.countryId)}.`);
      }
      return;
    }

    case 'nationalGrant': {
      const nation = requireLeader(world, player, action.countryId);
      const city = world.cities.get(action.toCityId);
      if (!city || city.countryId !== action.countryId) fail('La ville doit se trouver dans le pays.');
      if (isIndependent(city)) fail("Cette ville a fait sécession : elle ne reçoit plus de subventions nationales.");
      const amount = Math.floor(action.amount);
      if (!(amount > 0) || amount > nation.treasury) fail('Montant invalide ou budget insuffisant.');
      nation.treasury -= amount;
      city!.treasury += amount;
      pushEvent(world, 'funds', `${countryName(action.countryId)} verse une subvention de ${fmt(amount)} cr à ${cityName(city!.cityId)}.`);
      return;
    }

    case 'annexByForce': {
      const target = world.cities.get(action.cityId);
      if (!target) fail('Ville neutre : annexez-la depuis sa fiche (paiement ou force).');
      const victim = target!.ownerId;
      const plan = forcedAnnexationPlan(world, player, action.fromCityId, action.cityId, action.troops);
      // Trahison : tout accord en vigueur (traité ou organisation commune) doit être rompu.
      const between = (t: { a: string; b: string }) => (t.a === player && t.b === victim) || (t.a === victim && t.b === player);
      const treaties = meta.treaties.filter((t) => t.status === 'active' && between(t) && t.type !== 'city_transfer');
      const orgs = meta.organizations.filter((o) => o.members.includes(player) && o.members.includes(victim));
      const bonds = [...treaties.map((t) => TREATY_LABEL[t.type].toLowerCase()), ...orgs.map((o) => `« ${o.name} »`)];
      if (bonds.length && !action.betray) {
        fail(`${name(victim)} est lié(e) à vous (${bonds.join(', ')}) : l'annexer est une trahison qui rompra tous vos accords.`);
      }
      if (bonds.length) {
        for (const o of orgs) {
          o.members = o.members.filter((p) => p !== player);
          if (o.founderId === player && o.members.length) o.founderId = o.members[0]!;
        }
        meta.organizations = meta.organizations.filter((o) => o.members.length > 0);
        pushEvent(world, 'betrayal', `🗡 ${name(player)} trahit ${name(victim)} : accords rompus (${bonds.join(', ')}).`);
      }
      // L'attaque vaut déclaration de guerre : propositions, traités et contrats entre les deux tombent.
      meta.treaties = meta.treaties.filter((t) => !between(t));
      meta.contracts = meta.contracts.filter((c) => !((c.sellerId === player && c.buyerId === victim) || (c.sellerId === victim && c.buyerId === player)));
      if (!atWar(meta, player, victim)) meta.wars.push({ id: nextId(meta), a: player, b: victim, sinceTick: world.tick });
      // Combat : la défense n'est révélée qu'ici. Plus faible, l'assaillant perd toutes ses troupes.
      const defense = cityDefense(world, target!);
      const defenders = garrison(world, target!);
      if (plan.arriving <= defense) {
        dispatch(world, player, action.fromCityId, action.cityId, plan, 0);
        const attrition = Math.min(1, ANNEXATION.defenderAttrition * plan.arriving / Math.max(1, defense));
        for (const a of defenders) for (const u of UNIT_TYPES) a.units[u] *= 1 - attrition;
        meta.armies = meta.armies.filter((a) => !defenders.includes(a) || armySize(a) >= MILITARY.minArmySize);
        pushEvent(world, 'battle',
          `🛡 ${cityName(action.cityId)} repousse l'assaut de ${name(player)} : ${fmt(plan.sent)} soldats perdus (${fmt(plan.travelLoss)} en route), la ville reste à ${name(victim)}.`,
          [player, victim]);
        return;
      }
      const defeated = new Set(defenders);
      meta.armies = meta.armies.filter((a) => !defeated.has(a));
      dispatch(world, player, action.fromCityId, action.cityId, plan, plan.arriving - ANNEXATION.battleCost * defense);
      captureCity(world, target!, player);
      evaluateNation(world, target!.countryId);
      return;
    }

    case 'secede': {
      const city = ownCity(world, player, action.cityId);
      if (isIndependent(city)) fail('Cette ville est déjà indépendante.');
      if (city.rejoinedAtTick !== undefined && world.tick - city.rejoinedAtTick < INDEPENDENCE.cooldownTicks) {
        fail(`Réintégrée récemment : nouvelle sécession possible dans ${Math.ceil((INDEPENDENCE.cooldownTicks - (world.tick - city.rejoinedAtTick)) / 6)} h de jeu.`);
      }
      // Membres du pays prévenus avant la sécession (le propriétaire en fait encore partie).
      const members = eligibleVoters(world, city.countryId);
      city.independentSince = world.tick;
      // Plus aucun échange avec l'extérieur : les contrats de la ville tombent.
      meta.contracts = meta.contracts.filter((c) => c.sellerCityId !== city.cityId && c.buyerCityId !== city.cityId);
      evaluateNation(world, city.countryId);
      pushEvent(world, 'independence',
        `⚑ ${name(player)} proclame l'indépendance ${ofCity(city.cityId)} : dictature indépendante, hors du pays (${countryName(city.countryId)}).`,
        [...new Set([...members, player])]);
      return;
    }

    case 'rejoinCountry': {
      const city = ownCity(world, player, action.cityId);
      if (!isIndependent(city)) fail('Cette ville fait déjà partie de son pays.');
      const since = world.tick - city.independentSince!;
      if (since < INDEPENDENCE.cooldownTicks) fail(`Réintégration possible dans ${Math.ceil((INDEPENDENCE.cooldownTicks - since) / 6)} h de jeu.`);
      delete city.independentSince;
      city.rejoinedAtTick = world.tick;
      evaluateNation(world, city.countryId);
      pushEvent(world, 'independence', `${name(player)} réintègre ${cityName(city.cityId)} dans son pays (${countryName(city.countryId)}).`,
        [...new Set([...eligibleVoters(world, city.countryId), player])]);
      return;
    }

    case 'createOrganization': {
      const orgName = action.name.trim();
      if (orgName.length < 3 || orgName.length > 40) fail('Nom de 3 à 40 caractères.');
      if (meta.organizations.filter((o) => o.members.includes(player)).length >= ORGANIZATION.maxPerPlayer) fail(`Limite de ${ORGANIZATION.maxPerPlayer} organisations.`);
      if (meta.organizations.some((o) => o.name.toLowerCase() === orgName.toLowerCase())) fail('Ce nom est déjà pris.');
      meta.organizations.push({ id: nextId(meta), name: orgName, kind: action.kind, founderId: player, members: [player], invites: [], createdTick: world.tick });
      pushEvent(world, 'organization', `${name(player)} fonde ${ORG_LABEL[action.kind].toLowerCase()} « ${orgName} ».`);
      return;
    }

    case 'inviteToOrganization': {
      const org = findOrg(world, action.orgId);
      if (!org.members.includes(player)) fail("Vous n'êtes pas membre de cette organisation.");
      requirePlayer(world, action.playerId);
      if (org.members.includes(action.playerId) || org.invites.includes(action.playerId)) fail('Déjà membre ou invité.');
      if (org.members.length >= ORGANIZATION.maxMembers) fail(`Limite de ${ORGANIZATION.maxMembers} membres.`);
      if (org.kind === 'military' && org.members.some((m) => atWar(meta, m, action.playerId))) fail('Un membre est en guerre avec ce joueur.');
      org.invites.push(action.playerId);
      pushEvent(world, 'organization', `${name(player)} invite ${name(action.playerId)} à rejoindre « ${org.name} ».`, [player, action.playerId], true);
      return;
    }

    case 'respondOrganization': {
      const org = findOrg(world, action.orgId);
      if (!org.invites.includes(player)) fail("Aucune invitation pour vous dans cette organisation.");
      org.invites = org.invites.filter((p) => p !== player);
      if (!action.accept) return;
      if (org.kind === 'military' && org.members.some((m) => atWar(meta, m, player))) fail('Vous êtes en guerre avec un membre.');
      org.members.push(player);
      pushEvent(world, 'organization', `${name(player)} rejoint « ${org.name} ».`);
      return;
    }

    case 'leaveOrganization': {
      const org = findOrg(world, action.orgId);
      if (!org.members.includes(player)) fail("Vous n'êtes pas membre de cette organisation.");
      org.members = org.members.filter((p) => p !== player);
      if (org.founderId === player && org.members.length) org.founderId = org.members[0]!;
      if (!org.members.length) meta.organizations = meta.organizations.filter((o) => o !== org);
      pushEvent(world, 'organization', `${name(player)} quitte « ${org.name} ».`);
      return;
    }

    case 'expelFromOrganization': {
      const org = findOrg(world, action.orgId);
      if (org.founderId !== player) fail('Seul le fondateur peut exclure un membre.');
      if (!org.members.includes(action.playerId) || action.playerId === player) fail('Membre introuvable.');
      org.members = org.members.filter((p) => p !== action.playerId);
      pushEvent(world, 'organization', `${name(action.playerId)} est exclu(e) de « ${org.name} ».`);
      return;
    }

    case 'setTariff': {
      const nation = requireLeader(world, player, action.countryId);
      if (!(action.rate >= 0 && action.rate <= NATION.maxTariff)) fail(`Droit de douane entre 0 et ${NATION.maxTariff * 100} %.`);
      nation.tariff = Math.round(action.rate * 100) / 100;
      pushEvent(world, 'law', `${countryName(action.countryId)} : droits de douane fixés à ${Math.round(nation.tariff * 100)} %.`);
      return;
    }

    case 'sendMessage': {
      if (action.to.startsWith('org:')) {
        const org = findOrg(world, Number(action.to.slice(4)));
        if (!org.members.includes(player)) fail("Vous n'êtes pas membre de cette organisation.");
        meta.messages.push({ id: nextId(meta), from: player, to: action.to, text: action.text, tick: world.tick, at: now.toISOString() });
        if (meta.messages.length > 500) meta.messages.splice(0, meta.messages.length - 500);
        return;
      }
      requirePlayer(world, action.to);
      if (action.to === player) fail('Destinataire invalide.');
      meta.messages.push({ id: nextId(meta), from: player, to: action.to, text: action.text, tick: world.tick, at: now.toISOString() });
      if (meta.messages.length > 500) meta.messages.splice(0, meta.messages.length - 500);
      return;
    }
  }
}

function declareWar(world: World, player: string, target: string) {
  const meta = world.meta;
  if (atWar(meta, player, target)) fail('Vous êtes déjà en guerre.');
  const org = meta.organizations.find((o) => o.kind === 'military' && o.members.includes(player) && o.members.includes(target));
  if (org) fail(`Vous êtes tous deux membres de « ${org.name} » : quittez-la d'abord.`);
  const blocking = activeTreaty(meta, player, target, ['alliance', 'defense', 'non_aggression']);
  if (blocking) fail(`${TREATY_LABEL[blocking.type]} en vigueur : dénoncez-le d'abord.`);
  meta.treaties = meta.treaties.filter((t) => !(((t.a === player && t.b === target) || (t.a === target && t.b === player)) && t.type !== 'peace'));
  meta.contracts = meta.contracts.filter((c) => !((c.sellerId === player && c.buyerId === target) || (c.sellerId === target && c.buyerId === player)));
  meta.wars.push({ id: nextId(meta), a: player, b: target, sinceTick: world.tick });
}

function proposeNationalTreaty(world: World, player: string, action: Extract<WorldAction, { type: 'proposeTreaty' }>) {
  const meta = world.meta;
  const { from, to } = action.nation!;
  requireLeader(world, player, from);
  const other = meta.nations[to];
  if (!other?.leaderId) fail(`${countryName(to)} n'a pas de dirigeant national.`);
  if (action.treaty !== 'peace') fail('Seule la paix se négocie au niveau national pour le moment.');
  const anyWar = meta.wars.some((w) => w.nations && ((w.nations.a === from && w.nations.b === to) || (w.nations.a === to && w.nations.b === from)));
  if (!anyWar) fail("Ces deux pays ne sont pas en guerre.");
  meta.treaties.push({
    id: nextId(meta), type: 'peace', a: player, b: other!.leaderId!, status: 'proposed', proposedAtTick: world.tick,
    activeSinceTick: null, endsAtTick: null, nations: { a: from, b: to },
  });
  pushEvent(world, 'treaty', `${countryName(from)} propose la paix à ${countryName(to)}.`, [player, other!.leaderId!], true);
}

export const ORG_LABEL: Record<OrganizationKind, string> = { military: 'Alliance militaire', trade: 'Union commerciale' };

function findOrg(world: World, id: number) {
  const org = world.meta.organizations.find((o) => o.id === id);
  if (!org) fail('Organisation introuvable.');
  return org!;
}

const emptyUnits = (): Record<UnitType, number> => ({ infantry: 0, armor: 0, artillery: 0, navy: 0, air: 0 });

export const LAW_LABEL: Record<LawId, string> = {
  environment: 'Normes environnementales',
  minimum_wage: 'Salaire minimum',
  public_health: 'Santé publique renforcée',
  conscription: 'Conscription',
  education: 'Éducation obligatoire',
  emergency: "État d'urgence",
};

export const PROJECT_LABEL: Record<ProjectId, string> = {
  highway: 'Réseau autoroutier',
  power_grid: 'Réseau électrique national',
  university: 'Universités nationales',
  national_defense: 'Défense du territoire',
  trade_fair: 'Foire commerciale',
  national_health: 'Système de santé national',
  data_network: 'Réseau de données',
  national_park: 'Parc national',
  international_airport: 'Aéroport international',
};

