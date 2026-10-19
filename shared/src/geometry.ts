import { BUILDINGS, ROADS, type BuildingType } from './catalog.ts';
import type { Building, Road } from './types.ts';

export interface Point { x: number; y: number }
export interface Rect { minX: number; minY: number; maxX: number; maxY: number }
export interface Segment { x1: number; y1: number; x2: number; y2: number }

export function footprint(type: BuildingType, x: number, y: number, rotation: 0 | 90): Rect {
  const def = BUILDINGS[type];
  const w = rotation === 90 ? def.h : def.w;
  const h = rotation === 90 ? def.w : def.h;
  return { minX: x - w / 2, minY: y - h / 2, maxX: x + w / 2, maxY: y + h / 2 };
}

export const buildingRect = (b: Building): Rect => footprint(b.type, b.x, b.y, b.rotation);

export const roadWidth = (r: Pick<Road, 'type'>): number => ROADS[r.type].width;

export const segmentLength = (s: Segment): number => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

export function pointSegmentDistance(p: Point, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len2));
  return Math.hypot(p.x - (s.x1 + t * dx), p.y - (s.y1 + t * dy));
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function segmentsIntersect(a: Segment, b: Segment): boolean {
  const d1 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d2 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  const d3 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d4 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function segmentDistance(a: Segment, b: Segment): number {
  if (segmentsIntersect(a, b)) return 0;
  return Math.min(
    pointSegmentDistance({ x: a.x1, y: a.y1 }, b),
    pointSegmentDistance({ x: a.x2, y: a.y2 }, b),
    pointSegmentDistance({ x: b.x1, y: b.y1 }, a),
    pointSegmentDistance({ x: b.x2, y: b.y2 }, a),
  );
}

function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

function rectEdges(r: Rect): Segment[] {
  return [
    { x1: r.minX, y1: r.minY, x2: r.maxX, y2: r.minY },
    { x1: r.maxX, y1: r.minY, x2: r.maxX, y2: r.maxY },
    { x1: r.maxX, y1: r.maxY, x2: r.minX, y2: r.maxY },
    { x1: r.minX, y1: r.maxY, x2: r.minX, y2: r.minY },
  ];
}

/** Distance minimale entre un segment et un rectangle (0 s'ils se touchent). */
export function segmentRectDistance(s: Segment, r: Rect): number {
  if (pointInRect({ x: s.x1, y: s.y1 }, r) || pointInRect({ x: s.x2, y: s.y2 }, r)) return 0;
  return Math.min(...rectEdges(r).map((e) => segmentDistance(s, e)));
}

export function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

export const rectCenter = (r: Rect): Point => ({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 });

/** Point le plus proche d'un segment (utilisé pour l'accrochage des routes côté client). */
export function closestPointOnSegment(p: Point, s: Segment): Point {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len2));
  return { x: s.x1 + t * dx, y: s.y1 + t * dy };
}
