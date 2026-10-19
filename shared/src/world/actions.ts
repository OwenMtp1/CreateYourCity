// Actions de niveau « monde » des joueurs : diplomatie, commerce, armée, territoire, nation.
// Le serveur valide et applique ; toutes les règles sont ici et testées.
import { createCityState } from '../city.ts';
import { TICKS_PER_DAY } from '../constants.ts';
import { LAW_EFFECTS, type LawId, type ProjectId } from '../sim/modifiers.ts';
import type { CityState } from '../types.ts';
import { CITY_BY_ID } from '../world.ts';
import { changeOwner } from './military.ts';
import { countryName, evaluateNation, getNation } from './nations.ts';
import {
  activeTreaty, allied, atWar, cityName, citiesOf, distanceKm, eligibleVoters, EXPANSION, MILITARY, NATION,
  hasBuilding, NON_AGGRESSION_NOTICE_TICKS, nextId, ORGANIZATION, playerName, pushEvent, TREATY_LABEL, UNIT_REQUIRES, UNITS,
} from './rules.ts';
import { UNIT_TYPES, type OrganizationKind, type TreatyType, type UnitType, type World } from './types.ts';
import { BUILDINGS } from '../catalog.ts';
import { armySize } from './military.ts';

export type WorldAction =
  | { type: 'transferFunds'; fromCityId: string; toCityId: string; amount: number }
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
  | { type: 'nationalGrant'; countryId: string; toCityId: string; amount: number }
  | { type: 'createOrganization'; name: string; kind: OrganizationKind }
  | { type: 'inviteToOrganization'; orgId: number; playerId: string }
  | { type: 'respondOrganization'; orgId: number; accept: boolean }
  | { type: 'leaveOrganization'; orgId: number }
  | { type: 'expelFromOrganization'; orgId: number; playerId: string }
  | { type: 'setTariff'; countryId: string; rate: number }
  /** Destinataire : identifiant de joueur ou « org:<id> » pour le canal d'une organisation. */
  | { type: 'sendMessage'; to: string; text: string };

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Action refusée par les règles du jeu (message destiné au joueur). */
export class RuleError extends Error {}
const fail = (msg: string): never => { throw new RuleError(msg); };
const fmt = (v: number) => Math.round(v).toLocaleString('fr-FR');

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

/** Applique une expansion déjà enregistrée en base. */
export function commitExpansion(world: World, player: string, fromCityId: string, city: CityState, cost: number) {
  const from = ownCity(world, player, fromCityId);
  from.treasury -= cost;
  world.cities.set(city.cityId, city);
  pushEvent(world, 'expansion', `${playerName(world.meta, player)} étend son territoire à ${cityName(city.cityId)}.`, [player]);
  evaluateNation(world, city.countryId);
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
      if (!(action.rate >= 0 && action.rate <= NATION.maxTaxRate)) fail(`Taux national entre 0 et ${NATION.maxTaxRate * 100} %.`);
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

    case 'nationalGrant': {
      const nation = requireLeader(world, player, action.countryId);
      const city = world.cities.get(action.toCityId);
      if (!city || city.countryId !== action.countryId) fail('La ville doit se trouver dans le pays.');
      const amount = Math.floor(action.amount);
      if (!(amount > 0) || amount > nation.treasury) fail('Montant invalide ou budget insuffisant.');
      nation.treasury -= amount;
      city!.treasury += amount;
      pushEvent(world, 'funds', `${countryName(action.countryId)} verse une subvention de ${fmt(amount)} cr à ${cityName(city!.cityId)}.`);
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
};

export const PROJECT_LABEL: Record<ProjectId, string> = {
  highway: 'Réseau autoroutier',
  power_grid: 'Réseau électrique national',
  university: 'Universités nationales',
  national_defense: 'Défense du territoire',
};

