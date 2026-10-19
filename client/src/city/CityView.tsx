// Vue de construction d'une ville : placement libre, grille facultative, couches d'information.
// L'aperçu réutilise les validations partagées ; le serveur revalide chaque commande.
import { useEffect, useRef, useState } from 'react';
import {
  BUILDINGS, CITY_SIZE_M, closestPointOnSegment, footprint, generateTerrain, pointSegmentDistance, REGIONAL_ACCESS,
  ROADS, TerrainKind, validateBuilding, validateRoad, type BuildingType, type CityLayers, type CityState, type Point,
  type RoadType, type ServiceKind, type ValidationResult,
} from '@cyc/shared';
import { client } from '../net/client.ts';
import { fmtMoney } from '../ui/format.ts';

export type Tool =
  | { kind: 'select' }
  | { kind: 'road'; road: RoadType }
  | { kind: 'building'; building: BuildingType; rotation: 0 | 90 }
  | { kind: 'demolish' };

export type Layer = 'none' | 'status' | 'traffic' | ServiceKind | 'pollution';

interface Props {
  city: CityState;
  layers: CityLayers | null;
  tool: Tool;
  setTool: (t: Tool) => void;
  grid: boolean;
  setGrid: (g: boolean) => void;
  layer: Layer;
  selected: number | null;
  setSelected: (id: number | null) => void;
}

interface Camera { scale: number; x: number; y: number }

const CATEGORY_COLOR: Record<string, string> = {
  residential: '#4ade80', commercial: '#60a5fa', industrial: '#f59e0b', service: '#f472b6', utility: '#a78bfa',
};
const SHORT: Record<BuildingType, string> = {
  house: 'Mai', apartment: 'Imm', shop: 'Com', office: 'Bur', factory: 'Usi', clinic: 'Cli', school: 'Éco',
  police: 'Pol', power_plant: 'Élec', water_tower: 'Eau',
};

const ramp = (v: number) => {
  // 0 → rouge, 0,5 → jaune, 1 → vert
  const c = Math.max(0, Math.min(1, v));
  const r = c < 0.5 ? 239 : Math.round(239 - (c - 0.5) * 2 * (239 - 34));
  const g = c < 0.5 ? Math.round(68 + c * 2 * (179 - 68)) : Math.round(179 + (c - 0.5) * 2 * (197 - 179));
  return `rgb(${r},${g},${c < 0.5 ? 68 : 94})`;
};

export function CityView(props: Props) {
  const { city, layers, tool, grid, layer, selected } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainImg = useRef<HTMLCanvasElement | null>(null);
  const cam = useRef<Camera>({ scale: 0.4, x: 20, y: 20 });
  const size = useRef({ w: 800, h: 600 });
  const cursor = useRef<Point | null>(null);
  const roadStart = useRef<Point | null>(null);
  const drag = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null);
  const frame = useRef(0);
  const [hint, setHint] = useState<{ x: number; y: number; text: string; ok: boolean } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const draw = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(render);
  };

  const toWorld = (sx: number, sy: number): Point => ({ x: (sx - cam.current.x) / cam.current.scale, y: (sy - cam.current.y) / cam.current.scale });

  // Terrain pré-rendu (1 pixel par cellule).
  useEffect(() => {
    const t = generateTerrain(city.cityId);
    const img = document.createElement('canvas');
    img.width = t.size;
    img.height = t.size;
    const ctx = img.getContext('2d')!;
    for (let j = 0; j < t.size; j++) {
      for (let i = 0; i < t.size; i++) {
        const k = t.cells[j * t.size + i];
        ctx.fillStyle = k === TerrainKind.Water ? '#1e4f7a' : k === TerrainKind.Hill ? '#5b6b45' : '#3f5136';
        ctx.fillRect(i, j, 1, 1);
      }
    }
    terrainImg.current = img;
    draw();
  }, [city.cityId]);

  /** Accrochage : extrémités de routes, puis tracé de route, accès régional, enfin grille. */
  const snap = (p: Point, forRoad: boolean): Point => {
    const { city: c, grid: g } = propsRef.current;
    const tol = 12 / cam.current.scale;
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
      for (const r of c.roads) {
        if (pointSegmentDistance(p, r) < tol * 0.7) return closestPointOnSegment(p, r);
      }
    }
    if (g) {
      const step = forRoad ? 10 : 5;
      return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
    }
    return p;
  };

  const roadEnd = (start: Point, p: Point, shift: boolean): Point => {
    let end = snap(p, true);
    if (shift) end = Math.abs(end.x - start.x) > Math.abs(end.y - start.y) ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
    return end;
  };

  function preview(): ValidationResult | null {
    const { city: c, tool: t } = propsRef.current;
    const p = cursor.current;
    if (!p) return null;
    if (t.kind === 'building') {
      const q = snap(p, false);
      return validateBuilding(c, t.building, q.x, q.y, t.rotation);
    }
    if (t.kind === 'road' && roadStart.current) {
      const end = roadEnd(roadStart.current, p, shiftDown.current);
      const s = roadStart.current;
      return validateRoad(c, t.road, { x1: s.x, y1: s.y, x2: end.x, y2: end.y });
    }
    return null;
  }

  const shiftDown = useRef(false);

  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size.current;
    const { city: c, layers: l, tool: t, grid: g, layer: lay, selected: sel } = propsRef.current;
    const { scale, x: ox, y: oy } = cam.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    const px = 1 / scale; // un pixel écran en mètres

    if (terrainImg.current) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(terrainImg.current, 0, 0, CITY_SIZE_M, CITY_SIZE_M);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(0, 0, CITY_SIZE_M, CITY_SIZE_M);

    if (g) {
      const step = scale > 1.5 ? 10 : 50;
      ctx.beginPath();
      for (let v = 0; v <= CITY_SIZE_M; v += step) {
        ctx.moveTo(v, 0); ctx.lineTo(v, CITY_SIZE_M);
        ctx.moveTo(0, v); ctx.lineTo(CITY_SIZE_M, v);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = px;
      ctx.stroke();
    }

    // Accès régional.
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(REGIONAL_ACCESS.x, REGIONAL_ACCESS.y - 14 * px * 2);
    ctx.lineTo(REGIONAL_ACCESS.x + 22 * px * 2, REGIONAL_ACCESS.y);
    ctx.lineTo(REGIONAL_ACCESS.x, REGIONAL_ACCESS.y + 14 * px * 2);
    ctx.fill();

    // Zones de service ou de pollution.
    if (lay === 'health' || lay === 'education' || lay === 'safety' || lay === 'pollution') {
      for (const b of c.buildings) {
        const def = BUILDINGS[b.type];
        const radius = lay === 'pollution' ? def.pollution?.radius : def.service?.kind === lay ? def.service.radius : undefined;
        if (!radius) continue;
        ctx.beginPath();
        ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = lay === 'pollution' ? 'rgba(180,83,9,0.14)' : 'rgba(96,165,250,0.10)';
        ctx.fill();
        ctx.strokeStyle = lay === 'pollution' ? 'rgba(245,158,11,0.5)' : 'rgba(96,165,250,0.45)';
        ctx.lineWidth = px;
        ctx.stroke();
      }
    }

    // Routes.
    ctx.lineCap = 'round';
    for (const r of c.roads) {
      const connected = l?.roadConnected[r.id] ?? true;
      let color = connected ? '#9ca3af' : '#6b7280';
      if (lay === 'traffic') color = connected ? ramp(1 - Math.min(1.2, l?.roadLoad[r.id] ?? 0) / 1.2) : '#4b5563';
      ctx.strokeStyle = color;
      ctx.lineWidth = ROADS[r.type].width;
      ctx.setLineDash(connected ? [] : [8, 6]);
      ctx.beginPath();
      ctx.moveTo(r.x1, r.y1);
      ctx.lineTo(r.x2, r.y2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Bâtiments.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of c.buildings) {
      const def = BUILDINGS[b.type];
      const rect = footprint(b.type, b.x, b.y, b.rotation);
      const status = l?.buildingStatus[b.id] ?? 'ok';
      let fill = CATEGORY_COLOR[def.category]!;
      if (lay === 'health' || lay === 'education' || lay === 'safety') {
        const cov = l?.residentialCoverage[b.id]?.[lay];
        fill = cov === undefined ? 'rgba(148,163,184,0.35)' : ramp(cov);
      } else if (lay === 'pollution') {
        const p = l?.pollution[b.id];
        fill = p === undefined ? (def.pollution ? '#b45309' : 'rgba(148,163,184,0.35)') : ramp(1 - p);
      } else if (lay === 'status') {
        fill = status === 'ok' ? '#22c55e' : status === 'disconnected' ? '#f59e0b' : '#ef4444';
      } else if (lay === 'traffic') {
        fill = 'rgba(148,163,184,0.35)';
      }
      ctx.fillStyle = fill;
      ctx.fillRect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
      ctx.lineWidth = (b.id === sel ? 3 : 1) * px;
      ctx.strokeStyle = b.id === sel ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.strokeRect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
      if (status !== 'ok') {
        ctx.strokeStyle = '#ef4444';
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.lineWidth = 2 * px;
        ctx.strokeRect(rect.minX - 2 * px, rect.minY - 2 * px, rect.maxX - rect.minX + 4 * px, rect.maxY - rect.minY + 4 * px);
        ctx.setLineDash([]);
      }
      if (scale > 1.2) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.font = `${11 * px}px system-ui, sans-serif`;
        ctx.fillText(SHORT[b.type], b.x, b.y);
      }
    }

    // Éléments sous le curseur / aperçu.
    const p = cursor.current;
    if (p && t.kind === 'demolish') {
      const target = hitTest(p);
      if (target) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3 * px;
        if (target.kind === 'building') {
          const b = c.buildings.find((x) => x.id === target.id)!;
          const rect = footprint(b.type, b.x, b.y, b.rotation);
          ctx.strokeRect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
        } else {
          const r = c.roads.find((x) => x.id === target.id)!;
          ctx.beginPath(); ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); ctx.stroke();
        }
      }
    }
    const pv = preview();
    if (p && t.kind === 'building') {
      const q = snap(p, false);
      const rect = footprint(t.building, q.x, q.y, t.rotation);
      ctx.fillStyle = pv?.ok ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)';
      ctx.fillRect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
    }
    if (p && t.kind === 'road') {
      const start = roadStart.current;
      const q = start ? roadEnd(start, p, shiftDown.current) : snap(p, true);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(q.x, q.y, 4 * px, 0, Math.PI * 2); ctx.fill();
      if (start) {
        ctx.strokeStyle = pv?.ok ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)';
        ctx.lineWidth = ROADS[t.road].width;
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
  }

  function hitTest(p: Point): { kind: 'building' | 'road'; id: number } | null {
    const c = propsRef.current.city;
    for (const b of c.buildings) {
      const r = footprint(b.type, b.x, b.y, b.rotation);
      if (p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY) return { kind: 'building', id: b.id };
    }
    for (const r of c.roads) {
      if (pointSegmentDistance(p, r) <= ROADS[r.type].width / 2 + 4 / cam.current.scale) return { kind: 'road', id: r.id };
    }
    return null;
  }

  const updateHint = (sx: number, sy: number) => {
    const t = propsRef.current.tool;
    const pv = preview();
    if (pv) {
      const text = pv.ok ? `Coût : ${fmtMoney(pv.cost)}` : pv.reason;
      setHint({ x: sx, y: sy, text, ok: pv.ok });
    } else if (t.kind === 'road') {
      setHint({ x: sx, y: sy, text: 'Cliquez pour commencer la route (Maj : angle droit)', ok: true });
    } else if (t.kind === 'demolish') {
      setHint({ x: sx, y: sy, text: 'Démolition sans remboursement', ok: false });
    } else {
      setHint(null);
    }
  };

  // Redimensionnement et premier cadrage.
  useEffect(() => {
    const container = containerRef.current!;
    const canvas = canvasRef.current!;
    let first = true;
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      size.current = { w, h };
      if (first && w > 0) {
        first = false;
        const scale = Math.min(w, h) / (CITY_SIZE_M * 0.55);
        cam.current = { scale, x: 40 - REGIONAL_ACCESS.x * scale, y: h / 2 - REGIONAL_ACCESS.y * scale };
      }
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    return () => ro.disconnect();
  }, []);

  // Molette : zoom centré sur le curseur.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const before = toWorld(sx, sy);
      const scale = Math.max(0.15, Math.min(12, cam.current.scale * Math.exp(-e.deltaY * 0.0015)));
      cam.current = { scale, x: sx - before.x * scale, y: sy - before.y * scale };
      draw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Clavier : R tourner, G grille, Échap annuler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      shiftDown.current = e.shiftKey;
      if (e.type !== 'keydown' || (e.target as HTMLElement).tagName === 'INPUT') return;
      const { tool: t, setTool, grid: g, setGrid } = propsRef.current;
      if (e.key === 'Escape') {
        if (roadStart.current) roadStart.current = null;
        else setTool({ kind: 'select' });
      } else if ((e.key === 'r' || e.key === 'R') && t.kind === 'building') {
        setTool({ ...t, rotation: t.rotation === 0 ? 90 : 0 });
      } else if (e.key === 'g' || e.key === 'G') {
        setGrid(!g);
      }
      draw();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  useEffect(() => {
    if (tool.kind !== 'road') roadStart.current = null;
    setHint(null);
    draw();
  }, [tool]);

  useEffect(draw, [city, layers, grid, layer, selected]);

  const local = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = local(e);
    drag.current = { sx, sy, cx: cam.current.x, cy: cam.current.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = local(e);
    shiftDown.current = e.shiftKey;
    const d = drag.current;
    if (d && (Math.abs(sx - d.sx) > 4 || Math.abs(sy - d.sy) > 4 || d.moved)) {
      d.moved = true;
      cam.current = { ...cam.current, x: d.cx + sx - d.sx, y: d.cy + sy - d.sy };
    }
    cursor.current = toWorld(sx, sy);
    updateHint(sx, sy);
    draw();
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const { sx, sy } = local(e);
    const p = toWorld(sx, sy);
    const { tool: t, setSelected } = propsRef.current;
    if (e.button === 2) {
      roadStart.current = null;
      draw();
      return;
    }
    switch (t.kind) {
      case 'select': {
        const hit = hitTest(p);
        setSelected(hit?.kind === 'building' ? hit.id : null);
        return;
      }
      case 'building': {
        const q = snap(p, false);
        await client.act({ t: 'command', cmd: { type: 'build', building: t.building, x: q.x, y: q.y, rotation: t.rotation } });
        return;
      }
      case 'road': {
        const start = roadStart.current;
        if (!start) {
          roadStart.current = snap(p, true);
          draw();
          return;
        }
        const end = roadEnd(start, p, e.shiftKey);
        const ok = await client.act({ t: 'command', cmd: { type: 'buildRoad', road: t.road, x1: start.x, y1: start.y, x2: end.x, y2: end.y } });
        // Tracé continu : la route suivante part de la fin de la précédente.
        if (ok) roadStart.current = end;
        draw();
        return;
      }
      case 'demolish': {
        const hit = hitTest(p);
        if (hit) await client.act({ t: 'command', cmd: { type: 'demolish', target: hit.kind, id: hit.id } });
        return;
      }
    }
  };

  return (
    <div ref={containerRef} className="city-canvas">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => void onPointerUp(e)}
        onPointerLeave={() => { cursor.current = null; setHint(null); draw(); }}
        onContextMenu={(e) => e.preventDefault()}
        className={`tool-${tool.kind}`}
        aria-label="Espace de construction de la ville"
      />
      {hint && (
        <div className={`cursor-hint ${hint.ok ? '' : 'bad'}`} style={{ left: hint.x + 16, top: hint.y + 16 }}>{hint.text}</div>
      )}
      <div className="city-help">
        Molette : zoom · Glisser : déplacer · R : pivoter · G : grille · Échap : annuler · Clic droit : finir la route
      </div>
    </div>
  );
}
