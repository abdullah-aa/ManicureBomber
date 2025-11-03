// Shared utilities and types for Web Workers

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

// Vector utility functions
export function vector3Add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vector3Subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vector3Scale(v: Vector3, scale: number): Vector3 {
  return { x: v.x * scale, y: v.y * scale, z: v.z * scale };
}

export function vector3Length(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vector3Normalize(v: Vector3): Vector3 {
  const length = vector3Length(v);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return vector3Scale(v, 1 / length);
}

export function vector3Distance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// 2D distance calculation (x and z only, for horizontal/ground distances)
export function vector2DistanceXZ(pos1: Vector3, pos2: Vector3): number {
  const dx = pos1.x - pos2.x;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function vector3Lerp(a: Vector3, b: Vector3, t: number): Vector3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

// Shared worker types - cannot use Babylon.js types in workers due to serialization constraints

export enum BuildingType {
  RESIDENTIAL = 'residential',
  COMMERCIAL = 'commercial',
  INDUSTRIAL = 'industrial',
  SKYSCRAPER = 'skyscraper',
}

// BuildingConfig for workers (simplified version without Color3 since workers can't use Babylon.js classes)
export interface BuildingConfig {
  position: Vector3;
  type: BuildingType;
  width: number;
  height: number;
  depth: number;
  isTarget?: boolean;
  isDefenseLauncher?: boolean;
}

// BuildingData shared across workers
export interface BuildingData {
  id: string;
  position: Vector3;
  width: number;
  height: number;
  depth: number;
  isTarget: boolean;
  isDefenseLauncher: boolean;
  isDestroyed: boolean;
}
