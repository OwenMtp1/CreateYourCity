// Gouvernance nationale : élection continue à la majorité absolue, mandat sans échéance,
// démission ou destitution à la majorité absolue des électeurs.
import { eligibleVoters, playerName, pushEvent } from './rules.ts';
import type { NationState, World } from './types.ts';
import { COUNTRY_BY_ID } from '../world.ts';

export function countryName(countryId: string): string {
  return COUNTRY_BY_ID.get(countryId)?.nameFr ?? countryId;
}

export function getNation(world: World, countryId: string): NationState {
  let n = world.meta.nations[countryId];
  if (!n) {
    n = {
      countryId, leaderId: null, electedAtTick: null, candidates: [], votes: {}, impeach: [], taxRate: 0, treasury: 0, laws: {}, projects: {},
    };
    world.meta.nations[countryId] = n;
  }
  return n;
}

/** Recalcule l'état politique d'un pays (appelé après chaque vote et à chaque tick). */
export function evaluateNation(world: World, countryId: string) {
  const nation = world.meta.nations[countryId];
  if (!nation) return;
  const voters = eligibleVoters(world, countryId);
  const eligible = new Set(voters);
  // Seuls les électeurs actuels comptent ; un candidat doit rester éligible.
  nation.candidates = nation.candidates.filter((c) => eligible.has(c));
  for (const [voter, cand] of Object.entries(nation.votes)) {
    if (!eligible.has(voter) || !nation.candidates.includes(cand)) delete nation.votes[voter];
  }
  nation.impeach = nation.impeach.filter((v) => eligible.has(v));
  const majority = Math.floor(voters.length / 2) + 1;

  if (nation.leaderId && !eligible.has(nation.leaderId)) {
    pushEvent(world, 'resignation', `${playerName(world.meta, nation.leaderId)} perd la direction de ${countryName(countryId)} (plus aucune ville dans le pays).`);
    clearLeader(nation);
  }
  if (nation.leaderId && voters.length > 0 && nation.impeach.length >= majority) {
    pushEvent(world, 'impeachment', `${playerName(world.meta, nation.leaderId)} est destitué(e) de la direction de ${countryName(countryId)}.`);
    clearLeader(nation);
  }
  if (!nation.leaderId && voters.length > 0) {
    const counts = new Map<string, number>();
    for (const cand of Object.values(nation.votes)) counts.set(cand, (counts.get(cand) ?? 0) + 1);
    const winner = [...counts.entries()].find(([, n]) => n >= majority);
    if (winner) {
      nation.leaderId = winner[0];
      nation.electedAtTick = world.tick;
      nation.impeach = [];
      pushEvent(world, 'election', `${playerName(world.meta, winner[0])} est élu(e) à la tête de ${countryName(countryId)} (${winner[1]}/${voters.length} voix).`);
    }
  }
}

function clearLeader(nation: NationState) {
  nation.leaderId = null;
  nation.electedAtTick = null;
  nation.impeach = [];
  nation.votes = {};
}
