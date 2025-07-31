// Shared utilities for Web Workers

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

export function vector3Lerp(a: Vector3, b: Vector3, t: number): Vector3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

