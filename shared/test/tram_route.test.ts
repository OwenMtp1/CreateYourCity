import { describe, expect, it } from 'vitest';
import { segmentRectDistance, tramPath, TRAM_CLEARANCE_M, type Rect, type Segment } from '../src/index.ts';

const wall = (x: number, y0: number, y1: number): Rect => ({ minX: x - 10, minY: y0, maxX: x + 10, maxY: y1 });

/** Vérifie que chaque tronçon reste à au moins TRAM_CLEARANCE_M de chaque obstacle. */
function clear(path: { x: number; y: number }[], obstacles: Rect[]) {
  for (let k = 1; k < path.length; k++) {
    const s: Segment = { x1: path[k - 1]!.x, y1: path[k - 1]!.y, x2: path[k]!.x, y2: path[k]!.y };
    for (const r of obstacles) expect(segmentRectDistance(s, r)).toBeGreaterThanOrEqual(TRAM_CLEARANCE_M - 1e-6);
  }
}

describe('tracé du tram', () => {
  it('contourne un mur de bâtiments au lieu de le traverser', () => {
    const obstacles = [wall(500, 0, 1400)]; // mur vertical, du bord nord jusqu'à presque le sud
    const path = tramPath({ x: 300, y: 1000 }, { x: 700, y: 1000 }, obstacles);
    expect(path).not.toBeNull();
    clear(path!, obstacles);
    expect(path!.length).toBeGreaterThan(2);
  });

  it('une ligne droite libre reste une seule portion', () => {
    const path = tramPath({ x: 100, y: 500 }, { x: 900, y: 500 }, []);
    expect(path).not.toBeNull();
    expect(path!.length).toBeLessThanOrEqual(4);
    expect(path![0]).toEqual({ x: 100, y: 500 });
    expect(path!.at(-1)).toEqual({ x: 900, y: 500 });
  });

  it('renvoie null quand une station est totalement enfermée', () => {
    const box: Rect[] = [
      { minX: 480, minY: 480, maxX: 520, maxY: 490 }, { minX: 480, minY: 510, maxX: 520, maxY: 520 },
      { minX: 480, minY: 490, maxX: 490, maxY: 510 }, { minX: 510, minY: 490, maxX: 520, maxY: 510 },
    ];
    expect(tramPath({ x: 100, y: 100 }, { x: 500, y: 500 }, box, 2000)).toBeNull();
  });
});
