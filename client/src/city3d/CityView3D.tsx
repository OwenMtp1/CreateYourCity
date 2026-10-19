// Vue 3D de construction : outils, accrochage, aperçu validé par les règles partagées.
import { useEffect, useRef, useState } from 'react';
import {
  closestPointOnSegment, footprint, gameHour, pointSegmentDistance, REGIONAL_ACCESS, ROADS,
  validateBuilding, validateRoad, type BuildingType, type CityLayers, type CityState, type Point, type RoadType, type ValidationResult,
} from '@cyc/shared';
import { client } from '../net/client.ts';
import { useGame } from '../state.ts';
import { fmtMoney } from '../ui/format.ts';
import { CityScene, type CityLayer } from './CityScene.ts';

export type Tool =
  | { kind: 'select' }
  | { kind: 'road'; road: RoadType }
  | { kind: 'building'; building: BuildingType; rotation: 0 | 90 }
  | { kind: 'demolish' };

interface Props {
  city: CityState;
  layers: CityLayers | null;
  tool: Tool;
  setTool: (t: Tool) => void;
  grid: boolean;
  setGrid: (g: boolean) => void;
  layer: CityLayer;
  selected: number | null;
  setSelected: (id: number | null) => void;
  dayNight: boolean;
}

export function CityView3D(props: Props) {
  const { city, layers, tool, grid, layer, selected, dayNight } = props;
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const roadStart = useRef<Point | null>(null);
  const shift = useRef(false);
  const cursor = useRef<{ sx: number; sy: number } | null>(null);
  const [hint, setHint] = useState<{ x: number; y: number; text: string; ok: boolean } | null>(null);
  const tick = useGame((s) => s.tick);

  useEffect(() => {
    const scene = new CityScene(ref.current!);
    sceneRef.current = scene;
    return () => scene.dispose();
  }, []);

  useEffect(() => sceneRef.current?.setCity(city, layers, layer, selected), [city, layers, layer, selected]);
  useEffect(() => sceneRef.current?.setGrid(grid), [grid]);
  useEffect(() => {
    sceneRef.current?.setTimeOfDay(gameHour(tick), dayNight);
  }, [tick, dayNight]);
  useEffect(() => {
    if (tool.kind !== 'road') roadStart.current = null;
    setHint(null);
    sceneRef.current?.setPreview(null);
  }, [tool]);

  /** Accrochage : extrémités de routes, tracé existant, accès régional, puis grille. */
  const snap = (p: Point, forRoad: boolean): Point => {
    const { city: c, grid: g } = propsRef.current;
    const tol = 14 / Math.max(0.05, sceneRef.current?.pixelsPerMeter() ?? 1);
    if (forRoad) {
      let best: Point | null = null;
      let bestD = tol;
      const candidates: Point[] = [{ ...REGIONAL_ACCESS }];
      for (const r of c.roads) candidates.push({ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y2 });
      for (const q of candidates) {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) { bestD = d; best = q; }
      }
      if (best) return best;
      for (const r of c.roads) if (pointSegmentDistance(p, r) < tol * 0.7) return closestPointOnSegment(p, r);
    }
    if (g) {
      const step = forRoad ? 10 : 5;
      return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
    }
    return p;
  };

  const roadEnd = (start: Point, p: Point): Point => {
    let end = snap(p, true);
    if (shift.current) end = Math.abs(end.x - start.x) > Math.abs(end.y - start.y) ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
    return end;
  };

  const hitTest = (p: Point): { kind: 'building' | 'road'; id: number } | null => {
    const c = propsRef.current.city;
    for (const b of c.buildings) {
      const r = footprint(b.type, b.x, b.y, b.rotation);
      if (p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY) return { kind: 'building', id: b.id };
    }
    for (const r of c.roads) if (pointSegmentDistance(p, r) <= ROADS[r.type].width / 2 + 3) return { kind: 'road', id: r.id };
    return null;
  };

  const refresh = () => {
    const scene = sceneRef.current;
    const cur = cursor.current;
    if (!scene || !cur) return;
    const p = scene.screenToCity(cur.sx, cur.sy);
    const { tool: t, city: c } = propsRef.current;
    if (!p) return;
    let result: ValidationResult | null = null;
    if (t.kind === 'building') {
      const q = snap(p, false);
      result = validateBuilding(c, t.building, q.x, q.y, t.rotation);
      scene.setPreview({ kind: 'building', type: t.building, x: q.x, y: q.y, rotation: t.rotation, ok: result.ok });
    } else if (t.kind === 'road') {
      const start = roadStart.current;
      if (start) {
        const end = roadEnd(start, p);
        const seg = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
        result = validateRoad(c, t.road, seg);
        scene.setPreview({ kind: 'road', road: t.road, seg, ok: result.ok });
      } else {
        const q = snap(p, true);
        scene.setPreview({ kind: 'cursor', x: q.x, y: q.y });
      }
    } else if (t.kind === 'demolish') {
      scene.setPreview({ kind: 'demolish', target: hitTest(p) });
    }
    if (result) setHint({ x: cur.sx, y: cur.sy, text: result.ok ? `Coût : ${fmtMoney(result.cost)}` : result.reason, ok: result.ok });
    else if (t.kind === 'road') setHint({ x: cur.sx, y: cur.sy, text: 'Cliquez pour commencer la route (Maj : angle droit)', ok: true });
    else if (t.kind === 'demolish') setHint({ x: cur.sx, y: cur.sy, text: 'Démolition sans remboursement', ok: false });
    else setHint(null);
  };

  // Clavier : R pivoter, G grille, Échap annuler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      shift.current = e.shiftKey;
      if (e.type !== 'keydown' || ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      const { tool: t, setTool, grid: g, setGrid } = propsRef.current;
      if (e.key === 'Escape') {
        if (roadStart.current) roadStart.current = null;
        else setTool({ kind: 'select' });
      } else if ((e.key === 'r' || e.key === 'R') && t.kind === 'building') {
        setTool({ ...t, rotation: t.rotation === 0 ? 90 : 0 });
      } else if (e.key === 'g' || e.key === 'G') {
        setGrid(!g);
      }
      refresh();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const down = useRef<{ x: number; y: number; button: number } | null>(null);
  const local = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    const scene = sceneRef.current;
    const { sx, sy } = local(e);
    const p = scene?.screenToCity(sx, sy);
    if (!p) return;
    const { tool: t, setSelected } = propsRef.current;
    if (d.button === 2) {
      roadStart.current = null;
      scene?.setPreview(null);
      return;
    }
    if (d.button !== 0) return;
    switch (t.kind) {
      case 'select': {
        const hit = hitTest(p);
        setSelected(hit?.kind === 'building' ? hit.id : null);
        return;
      }
      case 'building': {
        const q = snap(p, false);
        await client.cityCommand({ type: 'build', building: t.building, x: q.x, y: q.y, rotation: t.rotation });
        refresh();
        return;
      }
      case 'road': {
        const start = roadStart.current;
        if (!start) {
          roadStart.current = snap(p, true);
          refresh();
          return;
        }
        const end = roadEnd(start, p);
        const ok = await client.cityCommand({ type: 'buildRoad', road: t.road, x1: start.x, y1: start.y, x2: end.x, y2: end.y });
        // Tracé continu : la route suivante part de la fin de la précédente.
        if (ok) roadStart.current = end;
        refresh();
        return;
      }
      case 'demolish': {
        const hit = hitTest(p);
        if (hit) await client.cityCommand({ type: 'demolish', target: hit.kind, id: hit.id });
        refresh();
        return;
      }
    }
  };

  return (
    <div
      ref={ref}
      className={`city3d tool-${tool.kind}`}
      onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY, button: e.button }; }}
      onPointerMove={(e) => { cursor.current = local(e); shift.current = e.shiftKey; refresh(); }}
      onPointerUp={(e) => void onPointerUp(e)}
      onPointerLeave={() => { cursor.current = null; setHint(null); sceneRef.current?.setPreview(null); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {hint && <div className={`cursor-hint ${hint.ok ? '' : 'bad'}`} style={{ left: hint.x + 16, top: hint.y + 16 }}>{hint.text}</div>}
      <div className="city-help glass">
        Glisser : déplacer · Clic droit + glisser : pivoter · Molette : zoom · R : tourner · G : grille · Échap : annuler
      </div>
    </div>
  );
}
