// Vue 3D de construction : outils, accrochage, aperçu validé par les règles partagées.
import { useEffect, useRef, useState } from 'react';
import {
  closestPointOnSegment, curvePoints, footprint, gameHour, pointSegmentDistance, REGIONAL_ACCESS, ROADS, roundaboutPoints, validateRoadPath,
  validateBuilding, validateRoad, type BuildingType, type CityLayers, type CityState, type Point, type RoadType, type ValidationResult,
} from '@cyc/shared';
import { client } from '../net/client.ts';
import { useGame } from '../state.ts';
import { useIsMobile } from '../ui/mobile.ts';
import { fmtMoney } from '../ui/format.ts';
import { CityScene, type CityLayer } from './CityScene.ts';

export type RoadMode = 'straight' | 'curve' | 'roundabout';

export type Tool =
  | { kind: 'select' }
  | { kind: 'road'; road: RoadType; mode?: RoadMode; radius?: number }
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
  /** Recentrage demandé sur un point de la ville (n change à chaque demande). */
  focus?: { x: number; y: number; n: number } | null;
}

export function CityView3D(props: Props) {
  const { city, layers, tool, grid, layer, selected, dayNight } = props;
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CityScene | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const roadStart = useRef<Point | null>(null);
  /** Point de contrôle d'une courbe (deuxième clic). */
  const roadControl = useRef<Point | null>(null);
  const shift = useRef(false);
  const cursor = useRef<{ sx: number; sy: number } | null>(null);
  const [hint, setHint] = useState<{ x: number; y: number; text: string; ok: boolean } | null>(null);
  const tick = useGame((s) => s.tick);
  const [street, setStreet] = useState<{ street: boolean; locked: boolean }>({ street: false, locked: false });
  const streetRef = useRef(false);
  streetRef.current = street.street;
  const mobile = useIsMobile();
  /** Dernière interaction au doigt (ou au stylet) : une construction demande alors une confirmation. */
  const touch = useRef(false);
  /** Action tactile en attente de confirmation (position du toucher). */
  const [pending, setPending] = useState<{ sx: number; sy: number } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // Contexte WebGL perdu et non rendu par le navigateur : la scène est recréée (nouvelle génération).
  const [generation, setGeneration] = useState(0);
  const [glLost, setGlLost] = useState(false);

  useEffect(() => {
    const scene = new CityScene(ref.current!);
    sceneRef.current = scene;
    scene.onStreetChange = setStreet;
    let retry: ReturnType<typeof setTimeout> | undefined;
    scene.onContextChange = (lost) => {
      setGlLost(lost);
      clearTimeout(retry);
      if (lost) retry = setTimeout(() => setGeneration((g) => g + 1), 3000);
    };
    setGlLost(false);
    return () => {
      clearTimeout(retry);
      scene.dispose();
    };
  }, [generation]);

  const toggleStreet = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (scene.street) scene.exitStreetView();
    else {
      propsRef.current.setTool({ kind: 'select' });
      setHint(null);
      scene.setPreview(null);
      scene.enterStreetView();
    }
  };

  useEffect(() => sceneRef.current?.setCity(city, layers, layer, selected), [city, layers, layer, selected, generation]);
  useEffect(() => sceneRef.current?.setGrid(grid), [grid, generation]);
  useEffect(() => {
    if (props.focus) sceneRef.current?.focusOn(props.focus.x, props.focus.y);
  }, [props.focus?.n]);
  useEffect(() => {
    sceneRef.current?.setTimeOfDay(gameHour(tick), dayNight);
  }, [tick, dayNight, generation]);
  useEffect(() => {
    if (tool.kind !== 'road') roadStart.current = null;
    roadControl.current = null;
    setHint(null);
    sceneRef.current?.setPreview(null);
    // Rotation ou changement de type pendant une confirmation tactile : l'aperçu suit ; sinon on annule.
    if (pendingRef.current && (tool.kind === 'building' || tool.kind === 'road')) {
      cursor.current = pendingRef.current;
      refresh();
    } else setPending(null);
  }, [tool]);

  /** Accrochage : extrémités de routes, tracé existant, accès régional, puis grille. */
  const snap = (p: Point, forRoad: boolean): Point => {
    const { city: c, grid: g } = propsRef.current;
    // Au doigt, l'accrochage est plus tolérant (doigt moins précis qu'une souris).
    const tol = (touch.current ? 30 : 14) / Math.max(0.05, sceneRef.current?.pixelsPerMeter() ?? 1);
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
    if (!scene || !cur || scene.street) return;
    const p = scene.screenToCity(cur.sx, cur.sy);
    const { tool: t, city: c } = propsRef.current;
    if (!p) return;
    let result: ValidationResult | null = null;
    if (t.kind === 'building') {
      const q = snap(p, false);
      result = validateBuilding(c, t.building, q.x, q.y, t.rotation);
      scene.setPreview({ kind: 'building', type: t.building, x: q.x, y: q.y, rotation: t.rotation, ok: result.ok });
    } else if (t.kind === 'road' && t.mode === 'roundabout') {
      const q = snap(p, false);
      const pts = roundaboutPoints(q, t.radius ?? 30);
      const v = validateRoadPath(c, t.road, pts);
      result = v.ok ? { ok: true, cost: v.cost } : v;
      scene.setPreview({ kind: 'path', road: t.road, points: pts, ok: v.ok });
    } else if (t.kind === 'road' && t.mode === 'curve' && roadStart.current) {
      const start = roadStart.current;
      const control = roadControl.current;
      const end = control ? snap(p, true) : snap(p, false);
      const pts = control ? curvePoints(start, control, end) : [start, end];
      const v = validateRoadPath(c, t.road, pts);
      result = v.ok ? { ok: true, cost: v.cost } : v;
      scene.setPreview({ kind: 'path', road: t.road, points: pts, ok: v.ok });
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
    else if (t.kind === 'road') setHint({ x: cur.sx, y: cur.sy, text: t.mode === 'curve' ? 'Courbe : cliquez le départ, puis le point de courbure, puis l\'arrivée' : 'Cliquez pour commencer la route (Maj : angle droit)', ok: true });
    if (result && t.kind === 'road' && t.mode === 'curve' && roadStart.current && !roadControl.current) {
      setHint({ x: cur.sx, y: cur.sy, text: 'Cliquez le point de courbure', ok: true });
    }
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
        if (roadStart.current) { roadStart.current = null; roadControl.current = null; }
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

  const cancel = () => {
    roadStart.current = null;
    roadControl.current = null;
    setPending(null);
    setHint(null);
    sceneRef.current?.setPreview(null);
  };

  /**
   * Applique l'outil au point touché. À la souris, la commande part tout de suite ; au doigt, l'aperçu
   * s'affiche et la commande attend la confirmation (barre ✓ / ↻ / ✕), pour éviter les constructions involontaires.
   */
  const apply = async (sx: number, sy: number, confirmed: boolean) => {
    const scene = sceneRef.current;
    const p = scene?.screenToCity(sx, sy);
    if (!p) return;
    const { tool: t, setSelected } = propsRef.current;
    const commit = async (run: () => Promise<void>) => {
      if (touch.current && !confirmed) {
        setPending({ sx, sy });
        cursor.current = { sx, sy };
        refresh();
        return;
      }
      setPending(null);
      await run();
      refresh();
    };
    switch (t.kind) {
      case 'select': {
        const hit = hitTest(p);
        setSelected(hit?.kind === 'building' ? hit.id : null);
        return;
      }
      case 'building': {
        const q = snap(p, false);
        await commit(async () => { await client.cityCommand({ type: 'build', building: t.building, x: q.x, y: q.y, rotation: t.rotation }); });
        return;
      }
      case 'road': {
        if (t.mode === 'roundabout') {
          const q = snap(p, false);
          await commit(async () => { await client.cityCommand({ type: 'buildRoadPath', road: t.road, points: roundaboutPoints(q, t.radius ?? 30) }); });
          return;
        }
        if (t.mode === 'curve') {
          if (!roadStart.current) roadStart.current = snap(p, true);
          else if (!roadControl.current) roadControl.current = snap(p, false);
          else {
            const start = roadStart.current, control = roadControl.current, end = snap(p, true);
            await commit(async () => {
              const ok = await client.cityCommand({ type: 'buildRoadPath', road: t.road, points: curvePoints(start, control, end) });
              roadControl.current = null;
              roadStart.current = ok ? end : roadStart.current;
            });
            return;
          }
          cursor.current = { sx, sy };
          refresh();
          return;
        }
        const start = roadStart.current;
        if (!start) {
          roadStart.current = snap(p, true);
          cursor.current = { sx, sy };
          refresh();
          return;
        }
        const end = roadEnd(start, p);
        await commit(async () => {
          const ok = await client.cityCommand({ type: 'buildRoad', road: t.road, x1: start.x, y1: start.y, x2: end.x, y2: end.y });
          // Tracé continu : la route suivante part de la fin de la précédente.
          if (ok) roadStart.current = end;
        });
        return;
      }
      case 'demolish': {
        const hit = hitTest(p);
        if (hit) await commit(async () => { await client.cityCommand({ type: 'demolish', target: hit.kind, id: hit.id }); });
        return;
      }
    }
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (streetRef.current) return;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > (e.pointerType === 'mouse' ? 5 : 12)) return;
    touch.current = e.pointerType !== 'mouse';
    if (d.button === 2) {
      cancel();
      return;
    }
    if (d.button !== 0) return;
    const { sx, sy } = local(e);
    await apply(sx, sy, false);
  };

  const confirmPending = () => {
    const pd = pendingRef.current;
    if (pd) void apply(pd.sx, pd.sy, true);
  };
  const rotatePending = () => {
    const t = propsRef.current.tool;
    if (t.kind === 'building') propsRef.current.setTool({ ...t, rotation: t.rotation === 0 ? 90 : 0 });
  };

  /** Croix de déplacement de la vue de rue (maintien = déplacement continu). */
  const padKey = (code: string, label: string, cls = '') => (
    <button
      className={`pad-btn ${cls}`}
      aria-label={label}
      onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); sceneRef.current?.setVirtualKey(code, true); }}
      onPointerUp={(e) => { e.stopPropagation(); sceneRef.current?.setVirtualKey(code, false); }}
      onPointerCancel={() => sceneRef.current?.setVirtualKey(code, false)}
      onLostPointerCapture={() => sceneRef.current?.setVirtualKey(code, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className={`city3d tool-${street.street ? 'street' : tool.kind}`}
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY, button: e.button };
        touch.current = e.pointerType !== 'mouse';
        if (streetRef.current && e.pointerType === 'mouse' && e.button === 0) sceneRef.current?.lockPointer();
      }}
      onPointerMove={(e) => {
        // Au doigt, glisser déplace la carte : l'aperçu reste au point touché.
        if (e.pointerType !== 'mouse') return;
        cursor.current = local(e);
        shift.current = e.shiftKey;
        refresh();
      }}
      onPointerUp={(e) => void onPointerUp(e)}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return;
        cursor.current = null;
        setHint(null);
        sceneRef.current?.setPreview(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {hint && !street.street && !touch.current && <div className={`cursor-hint ${hint.ok ? '' : 'bad'}`} style={{ left: hint.x + 16, top: hint.y + 16 }}>{hint.text}</div>}
      {!street.street && touch.current && (pending || hint || roadStart.current) && tool.kind !== 'select' && (
        <div className="confirm-bar glass" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <span className={`confirm-text ${hint && !hint.ok ? 'bad' : ''}`}>
            {pending ? hint?.text ?? '…' : hint?.text ?? 'Touchez le point d\'arrivée'}
          </span>
          <div className="confirm-actions">
            {pending && <button className="primary" disabled={!hint?.ok} onClick={confirmPending}>✓ {tool.kind === 'demolish' ? 'Démolir' : 'Construire'}</button>}
            {tool.kind === 'building' && <button onClick={rotatePending} aria-label="Tourner">↻</button>}
            <button onClick={cancel} aria-label="Annuler">✕</button>
          </div>
        </div>
      )}
      <div className="view-switch glass" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <button className={street.street ? '' : 'active'} onClick={() => sceneRef.current?.viewFromAbove()} title="Revenir à la vue du dessus, cadrée sur la ville">
          🛰️ Vue du dessus
        </button>
        <button className={street.street ? 'active' : ''} onClick={toggleStreet} title="Se promener dans la ville en caméra libre">
          🚶 Vue de rue
        </button>
      </div>
      {street.street && street.locked && <div className="street-crosshair" />}
      {street.street && (mobile || touch.current) && (
        <div className="street-pad" onPointerDown={(e) => e.stopPropagation()}>
          <div className="pad-cross">
            {padKey('KeyW', '▲', 'up')}
            {padKey('KeyA', '◀', 'left')}
            {padKey('KeyD', '▶', 'right')}
            {padKey('KeyS', '▼', 'down')}
          </div>
          <div className="pad-side">
            {padKey('Space', '⤒', 'rise')}
            {padKey('ShiftLeft', '🏃', 'run')}
            {padKey('KeyC', '⤓', 'sink')}
          </div>
        </div>
      )}
      {glLost && <div className="gl-lost glass">Affichage 3D interrompu par le navigateur — reprise en cours…</div>}
      <div className="city-help glass">
        {mobile
          ? street.street ? 'Glissez pour regarder · croix : avancer · ⤒ ⤓ : monter / descendre' : 'Glisser : déplacer · 2 doigts : zoom et rotation · Toucher : choisir'
          : street.street
          ? street.locked
            ? 'Souris : regarder · ZQSD / WASD ou flèches : avancer · Maj : courir · Espace / C : monter / descendre · Échap : libérer la souris'
            : 'Cliquez dans la vue pour regarder à la souris (ou glissez) · ZQSD / WASD ou flèches : avancer · Maj : courir · Espace / C : monter / descendre'
          : 'Glisser : déplacer · Clic droit + glisser : pivoter / incliner · Molette : zoom · R : tourner · G : grille · Échap : annuler'}
      </div>
    </div>
  );
}
