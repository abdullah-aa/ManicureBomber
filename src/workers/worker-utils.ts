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

// In-place variants for per-frame hot paths (managers/MissileGuidance): they
// write into a caller-owned object instead of allocating a fresh one per call.
// All are alias-safe (ref may be one of the inputs). The pure versions above
// stay for the episodic worker paths, where clarity beats allocation count.

export function vector3CopyToRef(v: Vector3, ref: Vector3): Vector3 {
  ref.x = v.x;
  ref.y = v.y;
  ref.z = v.z;
  return ref;
}

export function vector3AddToRef(a: Vector3, b: Vector3, ref: Vector3): Vector3 {
  ref.x = a.x + b.x;
  ref.y = a.y + b.y;
  ref.z = a.z + b.z;
  return ref;
}

export function vector3SubtractToRef(a: Vector3, b: Vector3, ref: Vector3): Vector3 {
  ref.x = a.x - b.x;
  ref.y = a.y - b.y;
  ref.z = a.z - b.z;
  return ref;
}

export function vector3ScaleToRef(v: Vector3, scale: number, ref: Vector3): Vector3 {
  ref.x = v.x * scale;
  ref.y = v.y * scale;
  ref.z = v.z * scale;
  return ref;
}

export function vector3NormalizeToRef(v: Vector3, ref: Vector3): Vector3 {
  const length = vector3Length(v);
  if (length === 0) {
    ref.x = 0;
    ref.y = 0;
    ref.z = 0;
    return ref;
  }
  return vector3ScaleToRef(v, 1 / length, ref);
}

export function vector3LerpToRef(a: Vector3, b: Vector3, t: number, ref: Vector3): Vector3 {
  ref.x = a.x + (b.x - a.x) * t;
  ref.y = a.y + (b.y - a.y) * t;
  ref.z = a.z + (b.z - a.z) * t;
  return ref;
}

export function vector3DistanceSquared(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Deterministic loop geometry for a Tomahawk path, shared by the physics worker
 * (which builds the waypoints from it) and Rocket View (which frames the loop).
 * Keeping this in one place guarantees the camera and the flown path never diverge.
 */
export interface TomahawkLoopFraming {
  loopStart: Vector3;   // wp1: above the launch point, at cruise altitude
  loopCenter: Vector3;  // offsetLoopCenter, at cruise altitude
  loopRadius: number;
  cruiseAltitude: number;
  target: Vector3;
}

/**
 * Compute the loop framing/intermediates from the three launch-time inputs. Pure
 * function of launchPosition, targetPosition and the fixed animationOffset, so it
 * can be evaluated synchronously the instant the missile is constructed.
 */
export function computeTomahawkLoopFraming(
  launchPosition: Vector3,
  targetPosition: Vector3,
  animationOffset: Vector3,
): TomahawkLoopFraming {
  const predictedStartPos = vector3Add(launchPosition, animationOffset);
  const directionToTarget = vector3Normalize(vector3Subtract(targetPosition, predictedStartPos));

  const cruiseAltitude = Math.max(predictedStartPos.y, targetPosition.y) - 80;
  // Floor above the tallest possible visible building top: terrain height clamp 60
  // (terrain.worker.ts) − TERRAIN_SINK 2 (Building.ts — not importable here, it
  // would drag Babylon into the worker bundle) + skyscraper apex 1.5·60 = 148,
  // plus the target ring at apex+5 (153), plus clearance. The terminal dive
  // interpolates from an early cruise-altitude waypoint down to the aim point
  // (MissileGuidance), so raising the floor steepens the dive but never moves
  // the impact.
  const maxBuildingTop = 60 - 2 + buildingApexHeight(BuildingType.SKYSCRAPER, 60); // 148
  const safeCruiseAltitude = Math.max(cruiseAltitude, maxBuildingTop + 12); // 160

  const horizontalDistance = Math.sqrt(
    (targetPosition.x - predictedStartPos.x) ** 2 +
    (targetPosition.z - predictedStartPos.z) ** 2,
  );

  const perpendicular = { x: -directionToTarget.z, y: 0, z: directionToTarget.x };
  const loopRadius = Math.max(Math.min(horizontalDistance * 0.4, 400), 150);

  const loopCenter = vector3Lerp(predictedStartPos, targetPosition, 0.5);
  const centerOffset = horizontalDistance * 0.2;
  const offsetLoopCenter = {
    x: loopCenter.x + perpendicular.x * centerOffset,
    y: safeCruiseAltitude,
    z: loopCenter.z + perpendicular.z * centerOffset,
  };

  return {
    loopStart: { x: predictedStartPos.x, y: safeCruiseAltitude, z: predictedStartPos.z },
    loopCenter: offsetLoopCenter,
    loopRadius,
    cruiseAltitude: safeCruiseAltitude,
    target: { x: targetPosition.x, y: targetPosition.y, z: targetPosition.z },
  };
}

// Shared worker types - cannot use Babylon.js types in workers due to serialization constraints

export enum BuildingType {
  RESIDENTIAL = 'residential',
  COMMERCIAL = 'commercial',
  INDUSTRIAL = 'industrial',
  SKYSCRAPER = 'skyscraper',
}

/**
 * Local-space visible top of a building's rooftop features, per type. Must match
 * the geometry built in entities/Building.ts (roof slab, antenna, smokestacks,
 * skyscraper tiers). Shared by Building.getApexHeight() and the Tomahawk
 * cruise-altitude floor above so the two can never diverge. Takes the type as a
 * string so both duplicate BuildingType enums (Building.ts and this file, same
 * string values) assign cleanly.
 */
export function buildingApexHeight(type: string, height: number): number {
  switch (type) {
    case BuildingType.RESIDENTIAL: return height + 2;   // roof slab top
    case BuildingType.COMMERCIAL:  return height + 4;   // antenna tip
    case BuildingType.INDUSTRIAL:  return height * 1.8; // smokestack top
    case BuildingType.SKYSCRAPER:  return height * 1.5; // tier2 top
    default: return height;
  }
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

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/**
 * Per-chunk deterministic PRNG (mulberry32 seeded by hashing the world seed
 * with the chunk coordinates): the same (seed, chunkX, chunkZ) always yields
 * the same building layout, independent of chunk generation ORDER — which
 * varies with flight path — so a seeded world is fully reproducible.
 */
export function createChunkRng(worldSeed: number, chunkX: number, chunkZ: number): () => number {
  let h = worldSeed >>> 0;
  h = Math.imul(h ^ ((chunkX + 0x9e3779b9) >>> 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((chunkZ + 0x9e3779b9) >>> 0), 0xc2b2ae35) >>> 0;
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Worker protocol — the SINGLE source of truth for every message crossing a
// worker boundary. Both sides (WorkerManager and the worker files) import
// these, so a protocol change is compiler-checked end to end instead of being
// stringly-typed `any` (the old worker index-mismatch collision bug was
// exactly this class of error).
// ---------------------------------------------------------------------------

export interface TerrainChunkRequest {
  chunkX: number;
  chunkZ: number;
  chunkSize: number;
  subdivisions: number;
  /** World seed — heightmap noise and building rolls both derive from it. */
  seed: number;
}

export interface TerrainChunkResult {
  chunkX: number;
  chunkZ: number;
  heightmap: Float32Array;
  buildingConfigs: BuildingConfig[];
}

export interface DefenseTrajectoryRequest {
  position: Vector3;
  velocity: Vector3;
  rotation: Vector3;
  targetPosition: Vector3;
  bomberVelocity?: Vector3;
  speed: number;
  deltaTime: number;
  launched: boolean;
  exploded: boolean;
  targetSet: boolean;
  maxAltitude: number;
}

export interface DefenseTrajectoryResult {
  position: Vector3;
  velocity: Vector3;
  rotation: Vector3;
  reachedTarget: boolean;
  shouldExplode: boolean;
  distanceToTarget: number;
  targetSet: boolean;
}

export interface TomahawkPathRequest {
  launchPosition: Vector3;
  targetPosition: Vector3;
  animationOffset: Vector3;
}

export interface TomahawkPathResult {
  waypoints: Vector3[];
}

export type TerrainWorkerRequest = { type: 'GENERATE_TERRAIN_CHUNK'; data: TerrainChunkRequest };
export type MissilePhysicsWorkerRequest =
  | { type: 'CALCULATE_DEFENSE_TRAJECTORY'; data: DefenseTrajectoryRequest }
  | { type: 'GENERATE_TOMAHAWK_PATH'; data: TomahawkPathRequest };

