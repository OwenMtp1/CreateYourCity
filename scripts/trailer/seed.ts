// Monde de démonstration pour la bande-annonce : villes construites, joueurs, organisations,
// contrats, guerre en cours (bataille et siège), dirigeant élu. Tout passe par les vraies
// règles du jeu (commandes et actions validées), seul le budget initial est généreux.
// Usage : npx tsx scripts/trailer/seed.ts <dossier-de-données> <secret-dev>
import { SignJWT } from 'jose';
import {
  applyCityCommand, createCityState, curvePoints, roundaboutPoints, simulateTicks, TICK_MS, TICKS_PER_DAY,
  type BuildingType, type CityCommand, type CityState,
} from '../../shared/src/index.ts';
import { applyWorldAction, createWorldMeta, stepWorld, type World, type WorldAction } from '../../shared/src/world/index.ts';
import { CITY_BY_ID } from '../../shared/src/world.ts';
import { FileStore } from '../../server/src/store/file.ts';

const [dataDir, secret] = process.argv.slice(2);
if (!dataDir || !secret) throw new Error('usage: seed.ts <dataDir> <secret>');

const ID = {
  paris: 'c1159151613', lyon: 'c1159150845', dijon: 'c1159142001', marseille: 'c1159150037',
  berlin: 'c1159151529', madrid: 'c1159151503', orleans: 'c1159142017', reims: 'c1159142043', warsaw: 'c1159151299',
};
const PLAYERS = {
  'dev-alice': 'Alice', 'dev-bob': 'Bob', 'dev-carol': 'Carol', 'dev-dave': 'Dave', 'dev-frank': 'Frank', 'dev-gabriel': 'Gabriel',
} as const;
type Pid = keyof typeof PLAYERS;

const world: World = { tick: 0, cities: new Map(), meta: createWorldMeta() };
for (const [id, name] of Object.entries(PLAYERS)) world.meta.players[id] = { name };

function city(cityId: string, owner: Pid): CityState {
  const wc = CITY_BY_ID.get(cityId)!;
  const c = createCityState({ cityId, countryId: wc.countryId, ownerId: owner, ownerName: PLAYERS[owner], tick: 0 });
  c.treasury = 80_000_000;
  world.cities.set(cityId, c);
  return c;
}

const tryCmd = (c: CityState, cmd: CityCommand) => applyCityCommand(c, cmd).ok;
const tryBuild = (c: CityState, building: BuildingType, x: number, y: number, rotation: 0 | 90 = 0) =>
  tryCmd(c, { type: 'build', building, x, y, rotation });

/** Quartier en damier autour de l'accès régional : avenues, rues, zones résidentielles, d'affaires, industrielles. */
function buildTown(c: CityState, scale: 'metropolis' | 'town') {
  const big = scale === 'metropolis';
  const east = big ? 1240 : 700;
  tryCmd(c, { type: 'buildRoad', road: 'avenue', x1: 0, y1: 1000, x2: Math.min(east, 780), y2: 1000 });
  if (big) tryCmd(c, { type: 'buildRoad', road: 'avenue', x1: 780, y1: 1000, x2: east, y2: 1000 });
  const cols = big ? [200, 420, 640, 860, 1080] : [200, 420, 640];
  const rows = big ? [640, 760, 880, 1120, 1240, 1360] : [880, 1120];
  for (const x of cols) {
    const y1 = Math.min(...rows);
    const y2 = Math.max(...rows);
    tryCmd(c, { type: 'buildRoad', road: x === 640 && big ? 'avenue' : 'street', x1: x, y1: 1000, x2: x, y2: y1 });
    tryCmd(c, { type: 'buildRoad', road: x === 640 && big ? 'avenue' : 'street', x1: x, y1: 1000, x2: x, y2: y2 });
  }
  for (const y of rows) {
    for (let i = 0; i < cols.length - 1; i++) tryCmd(c, { type: 'buildRoad', road: 'street', x1: cols[i]!, y1: y, x2: cols[i + 1]!, y2: y });
  }
  if (big) {
    // Rond-point et boulevard courbe à l'est.
    tryCmd(c, { type: 'buildRoadPath', road: 'avenue', points: roundaboutPoints({ x: east + 40, y: 1000 }, 40) });
    tryCmd(c, { type: 'buildRoadPath', road: 'street', points: curvePoints({ x: 1080, y: 640 }, { x: 1300, y: 600 }, { x: east + 40, y: 960 }) });
  }

  // Bâtiments le long de chaque rue horizontale et verticale, selon la zone.
  const zone = (x: number, y: number): BuildingType[] => {
    const dCenter = Math.hypot(x - 640, y - 1000);
    if (x > (big ? 1000 : 580)) return ['factory', 'office', 'shop', 'apartment', 'office'];
    if (dCenter < (big ? 200 : 120)) return ['tower', 'office', 'tower', 'shop', 'office'];
    if (dCenter < (big ? 380 : 260)) return ['apartment', 'apartment', 'shop', 'apartment', 'office'];
    return ['house', 'house', 'apartment', 'house', 'shop'];
  };
  let k = 0;
  const place = (x: number, y: number, rotation: 0 | 90) => {
    const types = zone(x, y);
    const t = types[k++ % types.length]!;
    if (!tryBuild(c, t, x, y, rotation)) tryBuild(c, 'house', x, y, rotation);
  };
  for (const y of [...rows, 1000]) {
    for (let x = 230; x < (y === 1000 ? east - 30 : cols.at(-1)!); x += 38) {
      if (cols.some((cx) => Math.abs(cx - x) < 30)) continue;
      place(x, y - 30, 0);
      place(x, y + 30, 0);
    }
  }
  for (const x of cols) {
    for (const y of rows.flatMap((r) => [r + 45, r + 85])) {
      place(x - 32, y, 0);
      place(x + 32, y, 0);
    }
  }
  // Services, réseaux, transports, défense : quelques essais d'emplacement chacun.
  const extras: [BuildingType, number][] = big
    ? [['clinic', 3], ['school', 4], ['police', 3], ['park', 5], ['power_plant', 1], ['water_tower', 2], ['metro_station', 3],
      ['tram_station', 2], ['bus_station', 2], ['train_station', 1], ['barracks', 1], ['airbase', 1], ['port', 1]]
    : [['clinic', 1], ['school', 1], ['police', 1], ['park', 2], ['bus_station', 2], ['barracks', 1]];
  for (const [t, n] of extras) {
    let placed = 0;
    for (let y = 560; y <= 1440 && placed < n; y += 25) {
      for (let x = 60; x <= east + 120 && placed < n; x += 37) {
        if (tryBuild(c, t, x + (placed * 131) % 97, y)) placed++;
      }
    }
  }
  c.treasury = big ? 2_400_000 : 900_000;
  c.population = 0;
}

const act = (p: Pid, a: WorldAction) => {
  const r = applyWorldAction(world, p, a);
  if (!r.ok) throw new Error(`${p} ${a.type}: ${r.error}`);
};

// --- Villes -----------------------------------------------------------------------------------
buildTown(city(ID.paris, 'dev-alice'), 'metropolis');
buildTown(city(ID.orleans, 'dev-alice'), 'town');
buildTown(city(ID.lyon, 'dev-carol'), 'town');
buildTown(city(ID.dijon, 'dev-carol'), 'town');
buildTown(city(ID.berlin, 'dev-bob'), 'town');
buildTown(city(ID.warsaw, 'dev-bob'), 'town');
buildTown(city(ID.madrid, 'dev-dave'), 'town');
buildTown(city(ID.marseille, 'dev-frank'), 'town');

// Quelques jours de jeu : les habitants s'installent (villes isolées, sans marché).
for (const c of world.cities.values()) simulateTicks(c, TICKS_PER_DAY * 4);
world.tick = TICKS_PER_DAY * 4;
for (const c of world.cities.values()) c.tick = world.tick;

// --- Politique, diplomatie, commerce ----------------------------------------------------------
act('dev-alice', { type: 'runForLeader', countryId: 'N250', run: true });
for (const p of ['dev-alice', 'dev-frank'] as const) act(p, { type: 'vote', countryId: 'N250', candidateId: 'dev-alice' });
world.meta.nations.N250!.treasury = 2_000_000;
act('dev-alice', { type: 'setNationalTax', countryId: 'N250', rate: 0.03 });
act('dev-alice', { type: 'setLaw', countryId: 'N250', law: 'minimum_wage', enabled: true });
act('dev-alice', { type: 'fundProject', countryId: 'N250', project: 'highway' });
act('dev-alice', { type: 'setTariff', countryId: 'N250', rate: 0.15 });

act('dev-alice', { type: 'createOrganization', name: 'Pacte Atlantique', kind: 'military' });
const pact = world.meta.organizations[0]!.id;
act('dev-alice', { type: 'inviteToOrganization', orgId: pact, playerId: 'dev-bob' });
act('dev-bob', { type: 'respondOrganization', orgId: pact, accept: true });
act('dev-dave', { type: 'createOrganization', name: 'Union Latine', kind: 'trade' });
const union = world.meta.organizations[1]!.id;
act('dev-dave', { type: 'inviteToOrganization', orgId: union, playerId: 'dev-alice' });
act('dev-alice', { type: 'respondOrganization', orgId: union, accept: true });
act('dev-frank', { type: 'proposeTreaty', to: 'dev-alice', treaty: 'non_aggression' });
act('dev-alice', { type: 'respondTreaty', treatyId: world.meta.treaties.at(-1)!.id, accept: true });

const contract = (seller: Pid, sc: string, buyer: Pid, bc: string, qty: number, price: number) => {
  act(seller, { type: 'proposeContract', myCityId: sc, otherCityId: bc, direction: 'sell', qtyPerDay: qty, pricePerUnit: price, days: 120 });
  act(buyer, { type: 'respondContract', contractId: world.meta.contracts.at(-1)!.id, accept: true });
};
contract('dev-bob', ID.berlin, 'dev-alice', ID.paris, 80, 13);
contract('dev-dave', ID.madrid, 'dev-alice', ID.paris, 60, 12);
contract('dev-bob', ID.warsaw, 'dev-alice', ID.orleans, 30, 12);
contract('dev-frank', ID.marseille, 'dev-dave', ID.madrid, 40, 14);

act('dev-bob', { type: 'sendMessage', to: `org:${pact}`, text: 'Mes blindés sont prêts à défendre Paris.' });
act('dev-carol', { type: 'sendMessage', to: 'dev-alice', text: 'Rendez-moi Orléans et nous parlerons de paix.' });

// --- Guerre : bataille en rase campagne entre Paris et Lyon, siège de Dijon --------------------
for (const c of world.cities.values()) c.population = Math.max(c.population, 3000);
act('dev-alice', { type: 'recruit', cityId: ID.paris, unit: 'armor', count: 40 });
act('dev-alice', { type: 'recruit', cityId: ID.paris, unit: 'infantry', count: 80 });
act('dev-carol', { type: 'recruit', cityId: ID.lyon, unit: 'infantry', count: 120 });
act('dev-bob', { type: 'recruit', cityId: ID.berlin, unit: 'artillery', count: 30 });
act('dev-carol', { type: 'declareWar', target: 'dev-alice' });
act('dev-bob', { type: 'declareWar', target: 'dev-carol' });
const armyOf = (p: Pid) => world.meta.armies.filter((a) => a.ownerId === p);
act('dev-alice', { type: 'moveArmy', armyId: armyOf('dev-alice')[0]!.id, toCityId: ID.lyon, units: { armor: 40, infantry: 40 } });
act('dev-carol', { type: 'moveArmy', armyId: armyOf('dev-carol')[0]!.id, toCityId: ID.paris });
act('dev-alice', { type: 'moveArmy', armyId: armyOf('dev-alice').find((a) => !a.movement)!.id, toCityId: ID.dijon });
act('dev-bob', { type: 'moveArmy', armyId: armyOf('dev-bob')[0]!.id, toCityId: ID.dijon });
for (let i = 0; i < TICKS_PER_DAY * 2 && world.meta.battles.length === 0; i++) stepWorld(world);
// Les armées envoyées sur Dijon arrivent et commencent le siège, la bataille continue.
for (let i = 0; i < TICKS_PER_DAY && !world.meta.sieges[ID.dijon]; i++) stepWorld(world);
const paris = world.cities.get(ID.paris)!;
const counts: Record<string, number> = {};
for (const b of paris.buildings) counts[b.type] = (counts[b.type] ?? 0) + 1;
console.log('Paris', JSON.stringify(counts), 'routes', paris.roads.length, 'habitants', Math.round(paris.population));
console.log(`bataille: ${world.meta.battles.length}, sièges: ${Object.keys(world.meta.sieges).length}, tick ${world.tick}`);

// --- Écriture du stockage fichier lu par le serveur ------------------------------------------
const store = new FileStore(dataDir);
await store.init();
const now = Date.now();
const lobby = {
  id: '11111111-2222-4333-8444-555555555555', code: 'TRAILR', name: 'Europe 2026', isPublic: true, maxPlayers: 32,
  ownerId: 'dev-alice', createdAt: new Date(now).toISOString(), tick: world.tick, lastSimulatedAt: now, world: null,
};
for (const [id, name] of Object.entries(PLAYERS)) await store.upsertPlayer(id, name);
await store.createLobby(lobby);
for (const id of Object.keys(PLAYERS)) await store.addMember(lobby.id, id);
for (const c of world.cities.values()) await store.claimCity(lobby.id, c);
await store.saveSnapshot(lobby.id, { tick: world.tick, lastSimulatedAt: now }, [...world.cities.values()], world.meta);
await store.appendChat(lobby.id, { id: 'c1', playerId: 'dev-dave', author: 'Dave', text: 'Bienvenue en Europe 2026 !', at: new Date(now).toISOString() });
await store.close();

const sign = (sub: string, name: string) => new SignJWT({ name }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub)
  .setIssuedAt().setExpirationTime('30d').sign(new TextEncoder().encode(secret));
console.log(JSON.stringify({
  token: await sign('dev-alice', 'Alice'), gabriel: await sign('dev-gabriel', 'Gabriel'), code: lobby.code,
  buildings: world.cities.get(ID.paris)!.buildings.length, tickMs: TICK_MS,
}));
