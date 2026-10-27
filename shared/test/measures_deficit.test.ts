import { describe, expect, it } from 'vitest';
import { measuresUpkeep } from '../src/world/rules.ts';
import type { NationState } from '../src/world/types.ts';

const nation = (treasury: number): NationState => ({
  countryId: 'N250', leaderId: null, electedAtTick: null, candidates: [], votes: {}, impeach: [], taxRate: 0,
  treasury, laws: { emergency: true }, projects: { education: true } as NationState['projects'],
});

describe("entretien des mesures en déficit", () => {
  it('une nation en déficit ne paie plus l\'entretien de ses mesures suspendues', () => {
    expect(measuresUpkeep(nation(-30_000_000))).toBe(0);
    expect(measuresUpkeep(nation(-1))).toBe(0);
  });

  it("une nation à l'équilibre paie l'entretien de ses mesures", () => {
    expect(measuresUpkeep(nation(0))).toBeGreaterThan(0);
    expect(measuresUpkeep(nation(1_000_000))).toBeGreaterThan(0);
  });
});
