// Main-thread missile guidance for Tomahawk and Iskander missiles.
//
// This is the per-frame guidance math moved verbatim from missile-physics.worker.ts.
// At 1-3 concurrent missiles × a few dozen flops per frame, the worker round-trip
// cost (serialize state + waypoints both ways, a frame of latency, dead-reckoning
// gaps, snap-on-apply) far exceeded the math itself. The episodic heavy work —
// GENERATE_TOMAHAWK_PATH and CALCULATE_DEFENSE_TRAJECTORY — stays in the worker.
//
// Inputs/outputs are the same plain {x,y,z} payloads the worker consumed, so the
// math is bit-identical to the worker implementation.
//
// Allocation discipline: this file runs every frame for every live missile, so
// all vector math goes through the ToRef helpers into module-scope scratch
// vectors, and each update function returns one reused module-scope result
// object. That is safe because guidance is single-threaded, none of these
// functions call each other across scratch owners, and both callers
// (TomahawkMissile/IskanderMissile.applyPhysicsResult) copy every field out
// synchronously before the next update runs. Inputs are never mutated — the
// Iskander flareTargets array in particular is the bomber's live array
// (read-only contract).

import {
  Vector3,
  vector3AddToRef,
  vector3SubtractToRef,
  vector3ScaleToRef,
  vector3NormalizeToRef,
  vector3LerpToRef,
  vector3CopyToRef,
  vector3Distance,
  vector3DistanceSquared,
  vector3Length,
} from '../workers/worker-utils';
import { FLARE_SEEKER_RANGE_MULTIPLIER } from '../config/Balance';

// Base interface for common missile properties
export interface BaseMissileData {
  position: Vector3;
  velocity: Vector3;
  rotation: Vector3;
  targetPosition: Vector3;
  speed: number;
  deltaTime: number;
  launched: boolean;
  exploded: boolean;
}

// Tomahawk missile specific data
export interface TomahawkMissileData extends BaseMissileData {
  turnRate: number;
  pathTime: number;
  pathSpeed: number;
  waypoints: Vector3[];
  lookAheadDistance: number;
  orientationUpdateThreshold: number;
  lastSegmentChangeTime: number;
  currentTime: number;
  // Terrain surface height at the missile's (x, z); detonate on reaching it
  // (cruise floor 160 keeps the nominal path clear — this arms terminal dives
  // and misses against hills instead of the old flat-world y <= 0).
  groundHeight?: number;
}

// Iskander missile specific data
export interface IskanderMissileData extends BaseMissileData {
  turnRate: number;
  pathTime: number;
  pathSpeed: number;
  waypoints: Vector3[];
  flareTargets: Vector3[];
  flareDetectionRange: number;
  originalTargetPosition: Vector3;
  isTargetingFlare: boolean;
  // Per-volley seduction roll: on first seeing flares in range the seeker rolls
  // once against flareSeductionChance. 'hardened' presses the attack through
  // THIS volley but re-rolls against the next one (flares stay the counter to
  // Iskanders — one press just isn't a guaranteed kill-all anymore). State is
  // persisted across frames on this reused payload, reset when no flares are
  // in range.
  flareSeductionChance: number;
  flareSeductionState: 'unrolled' | 'seduced' | 'hardened';
  lockOnRange: number;
  isLockedOn: boolean;
  lockSuspended: boolean; // concealment: pre-lock timer pause (cloud cover); never unwinds a completed lock
  lockOnTime: number;
  lockOnDuration: number;
  guidanceStrength: number;
  maxTurnRate: number;
  currentTime: number;
  // Terrain surface height at the missile's (x, z); detonate on reaching it.
  // Callers pass 0 until the missile is clearly airborne (arming guard) so
  // launches from raised terrain don't detonate on the pad.
  groundHeight?: number;
}

// Base result interface
export interface BaseMissileResult {
  position: Vector3;
  velocity: Vector3;
  rotation: Vector3;
  reachedTarget: boolean;
  shouldExplode: boolean;
  distanceToTarget: number;
}

// Tomahawk missile specific result
export interface TomahawkMissileResult extends BaseMissileResult {
  pathTime: number;
  lastSegmentChangeTime: number;
  flightPhase: 'FLYBY' | 'TERMINAL';
}

// Iskander missile specific result
export interface IskanderMissileResult extends BaseMissileResult {
  pathTime: number;
  isLockedOn: boolean;
  lockOnTime: number;
  lockProgress: number;
  isTargetingFlare: boolean;
  lockEstablished: boolean;
}

// Catmull-Rom spline interpolation helper for smooth curves
function catmullRomSplineToRef(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number, ref: Vector3): Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;

  ref.x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  ref.y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  ref.z = 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return ref;
}

// Tomahawk missile curved path calculation with multi-segment support
function getCurvedPathPositionToRef(waypoints: Vector3[], t: number, ref: Vector3): Vector3 {
  if (waypoints.length < 2) {
    const only = waypoints[0];
    ref.x = only ? only.x : 0;
    ref.y = only ? only.y : 0;
    ref.z = only ? only.z : 0;
    return ref;
  }

  // Terminal descent phase threshold (last 25% of path)
  const terminalDescentThreshold = 0.75;

  if (t <= terminalDescentThreshold) {
    // Flyby phase: Use Catmull-Rom spline for smooth curved flight
    // Normalize t to 0-1 range for flyby phase only
    const flybyT = t / terminalDescentThreshold;

    if (waypoints.length >= 4) {
      // Use multi-segment spline interpolation
      const segmentCount = waypoints.length - 1;
      const flybySegments = Math.floor(segmentCount * terminalDescentThreshold);
      const segmentIndex = Math.min(Math.floor(flybyT * flybySegments), flybySegments - 1);
      const segmentT = (flybyT * flybySegments) % 1.0;

      // Get control points for spline (use first 4 waypoints for flyby)
      const p0 = waypoints[Math.max(0, segmentIndex - 1)];
      const p1 = waypoints[segmentIndex];
      const p2 = waypoints[Math.min(waypoints.length - 1, segmentIndex + 1)];
      const p3 = waypoints[Math.min(waypoints.length - 1, segmentIndex + 2)];

      return catmullRomSplineToRef(p0, p1, p2, p3, segmentT, ref);
    } else {
      // Fallback to simple interpolation for 2-3 waypoints
      return vector3LerpToRef(waypoints[0], waypoints[1], flybyT, ref);
    }
  } else {
    // Terminal descent phase: Sharp dive from waypoint 4 to target
    const terminalT = (t - terminalDescentThreshold) / (1.0 - terminalDescentThreshold);

    // Dive from the penultimate waypoint — authored as the over-target terminal
    // descent start point (above the target at cruise altitude) — to the target.
    const terminalStartIndex = waypoints.length - 2;
    const terminalStart = waypoints[terminalStartIndex];
    const target = waypoints[waypoints.length - 1];

    // Linear interpolation with exponential curve for dramatic dive
    const diveT = terminalT * terminalT; // Exponential curve for steeper descent
    return vector3LerpToRef(terminalStart, target, diveT, ref);
  }
}

// Iskander missile curved path calculation with wider angles (optimized)
function getIskanderCurvedPathPositionToRef(waypoints: Vector3[], t: number, ref: Vector3): Vector3 {
  if (waypoints.length < 2) {
    const only = waypoints[0];
    ref.x = only ? only.x : 0;
    ref.y = only ? only.y : 0;
    ref.z = only ? only.z : 0;
    return ref;
  }

  const startPos = waypoints[0];
  const endPos = waypoints[1];

  // Linear interpolation for base path
  vector3LerpToRef(startPos, endPos, t, ref);

  // Add curved deviation with wider angles for more unpredictable flight
  const distance = vector3Distance(startPos, endPos);
  const curveAmplitude = distance * 0.25; // Increased from 15% to 25% for wider angles

  // Create a more complex winding curve using multiple sine waves
  ref.x += Math.sin(t * Math.PI * 3) * curveAmplitude * Math.cos(t * Math.PI);
  ref.z += Math.cos(t * Math.PI * 2.5) * curveAmplitude * Math.sin(t * Math.PI * 0.5);
  ref.y += Math.sin(t * Math.PI * 1.5) * 40; // Increased height variation

  return ref;
}

// Reused result for findClosestFlare — the caller copies both fields out before
// any other guidance code runs.
const flareSearch = { flare: null as Vector3 | null, distanceSq: Infinity };

// Single squared-distance pass over the (read-only) flare list. Real seeker
// missiles are HIGHLY susceptible to flares — they're infrared decoys, often
// hotter than the target — so the closest flare inside the seeker's widened
// detection radius always wins over the real target.
function findClosestFlare(position: Vector3, flareTargets: Vector3[], flareDetectionRange: number): void {
  // Widened detection simulates realistic IR seeker sensitivity; the AI's flare
  // release range is derived from this same multiplier (Balance.ts)
  const detectionRadius = flareDetectionRange * FLARE_SEEKER_RANGE_MULTIPLIER;
  const detectionRadiusSq = detectionRadius * detectionRadius;

  let closest: Vector3 | null = null;
  let closestDistanceSq = Infinity;
  for (let i = 0; i < flareTargets.length; i++) {
    const distanceSq = vector3DistanceSquared(position, flareTargets[i]);
    if (distanceSq <= detectionRadiusSq && distanceSq < closestDistanceSq) {
      closest = flareTargets[i];
      closestDistanceSq = distanceSq;
    }
  }
  flareSearch.flare = closest;
  flareSearch.distanceSq = closestDistanceSq;
}

// Scratch owned by updateIskanderLockedOnGuidance
const lockedDir: Vector3 = { x: 0, y: 0, z: 0 };
const lockedVelChange: Vector3 = { x: 0, y: 0, z: 0 };

// Update Iskander guidance (locked on). Mutates velocity in place and writes
// the derived pose into rotation.
function updateIskanderLockedOnGuidance(
  position: Vector3,
  velocity: Vector3,
  targetPosition: Vector3,
  speed: number,
  guidanceStrength: number,
  maxTurnRate: number,
  deltaTime: number,
  rotation: Vector3,
): void {
  // Desired velocity: straight toward the target at full speed
  vector3SubtractToRef(targetPosition, position, lockedDir);
  vector3NormalizeToRef(lockedDir, lockedDir);
  vector3ScaleToRef(lockedDir, speed, lockedDir);

  // Velocity change needed, with turn rate limiting
  vector3SubtractToRef(lockedDir, velocity, lockedVelChange);
  const maxVelocityChange = maxTurnRate * speed * deltaTime;
  const velocityChangeMagnitude = vector3Length(lockedVelChange);
  if (velocityChangeMagnitude > maxVelocityChange) {
    vector3ScaleToRef(lockedVelChange, maxVelocityChange / velocityChangeMagnitude, lockedVelChange);
  }

  // Apply guidance strength
  vector3ScaleToRef(lockedVelChange, guidanceStrength * deltaTime, lockedVelChange);
  vector3AddToRef(velocity, lockedVelChange, velocity);

  // Ensure velocity doesn't exceed maximum speed
  const velocityLength = vector3Length(velocity);
  if (velocityLength > speed) {
    vector3ScaleToRef(velocity, speed / velocityLength, velocity);
  }

  // Calculate rotation based on velocity
  rotation.x = 0;
  rotation.y = 0;
  rotation.z = 0;
  if (velocity.x * velocity.x + velocity.z * velocity.z > 0.01) {
    // Yaw (horizontal rotation around Y axis)
    rotation.y = Math.atan2(velocity.x, velocity.z);

    // Pitch (vertical rotation around X axis)
    const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (horizontalSpeed > 0.001) {
      rotation.x = Math.atan2(-velocity.y, horizontalSpeed);
    }
  }
}

// Scratch owned by updateIskanderInitialGuidance
const initialDir: Vector3 = { x: 0, y: 0, z: 0 };
const initialVelChange: Vector3 = { x: 0, y: 0, z: 0 };

// Update Iskander initial guidance (before lock-on): follow a ballistic
// trajectory toward the target. Mutates velocity in place and writes the
// derived pose into rotation.
function updateIskanderInitialGuidance(
  position: Vector3,
  velocity: Vector3,
  targetPosition: Vector3,
  speed: number,
  maxTurnRate: number,
  deltaTime: number,
  rotation: Vector3,
): void {
  vector3SubtractToRef(targetPosition, position, initialDir);
  vector3NormalizeToRef(initialDir, initialDir);
  vector3ScaleToRef(initialDir, speed, initialDir);

  // Gradually turn toward target
  const turnRate = maxTurnRate * 0.5; // Slower initial turn rate
  vector3SubtractToRef(initialDir, velocity, initialVelChange);
  const maxVelocityChange = turnRate * speed * deltaTime;
  const velocityChangeMagnitude = vector3Length(initialVelChange);
  if (velocityChangeMagnitude > maxVelocityChange) {
    vector3ScaleToRef(initialVelChange, maxVelocityChange / velocityChangeMagnitude, initialVelChange);
  }
  vector3AddToRef(velocity, initialVelChange, velocity);

  // Ensure velocity doesn't exceed maximum speed
  const velocityLength = vector3Length(velocity);
  if (velocityLength > speed) {
    vector3ScaleToRef(velocity, speed / velocityLength, velocity);
  }

  // Calculate rotation based on velocity
  rotation.x = 0;
  rotation.y = 0;
  rotation.z = 0;
  if (velocity.x * velocity.x + velocity.z * velocity.z > 0.01) {
    rotation.y = Math.atan2(velocity.x, velocity.z);

    const horizontalSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    if (horizontalSpeed > 0.001) {
      rotation.x = Math.atan2(-velocity.y, horizontalSpeed);
    }
  }
}

// Scratch and reused result owned by updateTomahawkMissilePhysics
const tomCurveTarget: Vector3 = { x: 0, y: 0, z: 0 };
const tomDir: Vector3 = { x: 0, y: 0, z: 0 };
const tomahawkResult: TomahawkMissileResult = {
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  pathTime: 0,
  reachedTarget: false,
  shouldExplode: false,
  distanceToTarget: 0,
  lastSegmentChangeTime: 0,
  flightPhase: 'FLYBY',
};

// Tomahawk missile physics handler
export function updateTomahawkMissilePhysics(data: TomahawkMissileData): TomahawkMissileResult {
  const result = tomahawkResult;
  // The result's own vectors double as the working position/velocity/rotation —
  // seeded from the inputs, then mutated in place.
  const newPosition = vector3CopyToRef(data.position, result.position);
  const newVelocity = vector3CopyToRef(data.velocity, result.velocity);
  const newRotation = vector3CopyToRef(data.rotation, result.rotation);
  result.pathTime = data.pathTime;
  result.lastSegmentChangeTime = data.lastSegmentChangeTime;

  if (!data.launched || data.exploded) {
    result.reachedTarget = false;
    result.shouldExplode = false;
    result.distanceToTarget = vector3Distance(data.position, data.targetPosition);
    result.flightPhase = 'FLYBY';
    return result;
  }

  let newPathTime = data.pathTime;
  const lastSegmentChangeTime = data.lastSegmentChangeTime;

  const currentTime = data.currentTime;

  // Terminal descent phase threshold (75% of path)
  const terminalDescentThreshold = 0.75;
  const distanceToTarget = vector3Distance(newPosition, data.targetPosition);

  // Determine flight phase
  let flightPhase: 'FLYBY' | 'TERMINAL' = 'FLYBY';
  if (newPathTime > terminalDescentThreshold || distanceToTarget < 300) {
    flightPhase = 'TERMINAL';
  }

  // Calculate path speed multiplier based on phase
  const pathSpeedMultiplier = flightPhase === 'TERMINAL' ? 1.4 : 1.0; // 40% faster in terminal phase
  newPathTime += data.deltaTime * data.pathSpeed * pathSpeedMultiplier;

  // Re-check phase after path time update
  if (newPathTime > terminalDescentThreshold || distanceToTarget < 300) {
    flightPhase = 'TERMINAL';
  }

  // Check if we should update orientation at curve segment boundaries (only during flyby)
  const segmentSize = 0.2;
  const segmentProgress = (newPathTime % segmentSize) / segmentSize;
  const orientationUpdateThreshold = data.orientationUpdateThreshold;

  const shouldUpdateOrientation =
    flightPhase === 'FLYBY' &&
    (segmentProgress <= orientationUpdateThreshold || segmentProgress >= 0.9) &&
    currentTime - lastSegmentChangeTime > 0.2;

  if (newPathTime <= 1.0) {
    // Follow the curved path
    getCurvedPathPositionToRef(data.waypoints, newPathTime, tomCurveTarget);
    vector3SubtractToRef(tomCurveTarget, newPosition, tomDir);
    vector3NormalizeToRef(tomDir, tomDir);

    // Speed multiplier for terminal descent; tomDir becomes the desired velocity
    const effectiveSpeed = flightPhase === 'TERMINAL' ? data.speed * 1.3 : data.speed;
    vector3ScaleToRef(tomDir, effectiveSpeed, tomDir);

    // Turn rate multiplier for terminal descent (more aggressive)
    const effectiveTurnRate = flightPhase === 'TERMINAL' ? data.turnRate * 2.0 : data.turnRate;

    // Smoothly interpolate velocity for curved movement
    newVelocity.x = newVelocity.x + (tomDir.x - newVelocity.x) * effectiveTurnRate * data.deltaTime;
    newVelocity.y = newVelocity.y + (tomDir.y - newVelocity.y) * effectiveTurnRate * data.deltaTime;
    newVelocity.z = newVelocity.z + (tomDir.z - newVelocity.z) * effectiveTurnRate * data.deltaTime;

    // Update orientation with look-ahead if it's time (flyby only); tomDir is
    // free again once the velocity blend above has consumed it
    if (shouldUpdateOrientation) {
      const lookAheadDistance = data.lookAheadDistance;
      const lookAheadTime = Math.min(newPathTime + lookAheadDistance, 1.0);
      getCurvedPathPositionToRef(data.waypoints, lookAheadTime, tomCurveTarget);
      const directionToLookAhead = vector3SubtractToRef(tomCurveTarget, newPosition, tomDir);
      vector3NormalizeToRef(directionToLookAhead, directionToLookAhead);

      if (directionToLookAhead.x * directionToLookAhead.x + directionToLookAhead.z * directionToLookAhead.z > 0.01) {
        // Calculate target rotation
        const targetYaw = Math.atan2(directionToLookAhead.x, directionToLookAhead.z);
        const horizontalSpeed = Math.sqrt(
          directionToLookAhead.x * directionToLookAhead.x + directionToLookAhead.z * directionToLookAhead.z,
        );
        const targetPitch = horizontalSpeed > 0.001 ? Math.atan2(-directionToLookAhead.y, horizontalSpeed) : 0;

        // Smooth rotation interpolation
        const rotationSpeed = 1.8; // How fast the missile can rotate
        const maxRotationChange = rotationSpeed * data.deltaTime;

        // Handle yaw wrapping (shortest rotation path)
        let yawDiff = targetYaw - newRotation.y;
        while (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
        while (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;

        // Apply limited rotation change
        if (Math.abs(yawDiff) > maxRotationChange) {
          yawDiff = Math.sign(yawDiff) * maxRotationChange;
        }
        newRotation.y += yawDiff;

        // Smooth pitch change
        let pitchDiff = targetPitch - newRotation.x;
        if (Math.abs(pitchDiff) > maxRotationChange) {
          pitchDiff = Math.sign(pitchDiff) * maxRotationChange;
        }
        newRotation.x += pitchDiff;
      }
    }
  } else {
    // Head directly to target when curve is complete
    vector3SubtractToRef(data.targetPosition, newPosition, tomDir);
    vector3NormalizeToRef(tomDir, tomDir);
    vector3ScaleToRef(tomDir, data.speed * 1.3, newVelocity);
    flightPhase = 'TERMINAL'; // Force terminal phase when path complete
  }

  // Update rotation based on velocity (only if not updating orientation to look ahead)
  if (!shouldUpdateOrientation && newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z > 0.01) {
    // Calculate target rotation based on velocity
    const targetYaw = Math.atan2(newVelocity.x, newVelocity.z);
    const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
    const targetPitch = horizontalSpeed > 0.001 ? Math.atan2(-newVelocity.y, horizontalSpeed) : 0;

    // Enhanced rotation speed for terminal descent
    const rotationSpeed = flightPhase === 'TERMINAL' ? 3.0 : 1.8;
    const maxRotationChange = rotationSpeed * data.deltaTime;

    // Handle yaw wrapping
    let yawDiff = targetYaw - newRotation.y;
    while (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
    while (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;

    if (Math.abs(yawDiff) > maxRotationChange) {
      yawDiff = Math.sign(yawDiff) * maxRotationChange;
    }
    newRotation.y += yawDiff;

    // Smooth pitch change (more aggressive in terminal phase)
    let pitchDiff = targetPitch - newRotation.x;
    if (Math.abs(pitchDiff) > maxRotationChange) {
      pitchDiff = Math.sign(pitchDiff) * maxRotationChange;
    }
    newRotation.x += pitchDiff;
  }

  // Update position
  newPosition.x += newVelocity.x * data.deltaTime;
  newPosition.y += newVelocity.y * data.deltaTime;
  newPosition.z += newVelocity.z * data.deltaTime;

  // Check collision conditions. Proximity widens to the per-frame step size so
  // a clamped-dt frame (~12u of travel) can't repeatedly step over the 5u gate
  // and leave the missile orbiting its target forever.
  const stepSize = data.speed * 1.3 * data.deltaTime;
  const groundHeight = data.groundHeight ?? 0;
  const finalDistanceToTarget = vector3Distance(newPosition, data.targetPosition);
  const reachedTarget = finalDistanceToTarget <= Math.max(5, stepSize * 1.2) || newPosition.y <= groundHeight;

  result.pathTime = newPathTime;
  result.reachedTarget = reachedTarget;
  result.shouldExplode = reachedTarget;
  result.distanceToTarget = finalDistanceToTarget;
  result.lastSegmentChangeTime = lastSegmentChangeTime;
  result.flightPhase = flightPhase;
  return result;
}

// Scratch and reused result owned by updateIskanderMissilePhysics
const iskCurveTarget: Vector3 = { x: 0, y: 0, z: 0 };
const iskBlendedTarget: Vector3 = { x: 0, y: 0, z: 0 };
const iskDir: Vector3 = { x: 0, y: 0, z: 0 };
const iskVelDir: Vector3 = { x: 0, y: 0, z: 0 };
const iskanderResult: IskanderMissileResult = {
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  pathTime: 0,
  reachedTarget: false,
  shouldExplode: false,
  distanceToTarget: 0,
  isLockedOn: false,
  lockOnTime: 0,
  lockProgress: 0,
  isTargetingFlare: false,
  lockEstablished: false,
};

// Iskander missile physics handler
export function updateIskanderMissilePhysics(data: IskanderMissileData): IskanderMissileResult {
  const result = iskanderResult;
  // The result's own vectors double as the working position/velocity/rotation —
  // seeded from the inputs, then mutated in place.
  const newPosition = vector3CopyToRef(data.position, result.position);
  const newVelocity = vector3CopyToRef(data.velocity, result.velocity);
  const newRotation = vector3CopyToRef(data.rotation, result.rotation);
  result.pathTime = data.pathTime;

  if (!data.launched || data.exploded) {
    result.reachedTarget = false;
    result.shouldExplode = false;
    result.distanceToTarget = vector3Distance(data.position, data.targetPosition);
    result.isLockedOn = false;
    result.lockOnTime = 0;
    result.lockProgress = 0;
    result.isTargetingFlare = false;
    result.lockEstablished = false;
    return result;
  }

  let newPathTime = data.pathTime;
  let isLockedOn = data.isLockedOn;
  let lockOnTime = data.lockOnTime;
  let isTargetingFlare = data.isTargetingFlare;
  let lockEstablished = false;

  // Initialize guidance parameters - will be adjusted based on targeting mode
  let effectiveGuidanceStrength = data.guidanceStrength;
  let effectiveMaxTurnRate = data.maxTurnRate;

  // Handle flare targeting if flare targets exist - check every frame for responsiveness
  let currentTargetPosition = data.targetPosition;
  let closestFlare: Vector3 | null = null;
  if (data.flareTargets && data.flareTargets.length > 0) {
    findClosestFlare(newPosition, data.flareTargets, data.flareDetectionRange);
    closestFlare = flareSearch.flare;
    if (closestFlare) {
      // First flare of this exposure: roll the seeker's susceptibility once.
      // A 'hardened' roll ignores this whole volley and presses the attack —
      // the lock keeps stakes — while the NEXT volley rolls fresh.
      if (data.flareSeductionState === 'unrolled') {
        data.flareSeductionState = Math.random() < data.flareSeductionChance ? 'seduced' : 'hardened';
      }
    }
    if (closestFlare && data.flareSeductionState === 'seduced') {
      // Switch to targeting the closest flare — IR seekers are highly
      // susceptible to decoys, often hotter than the target itself
      currentTargetPosition = closestFlare;
      isTargetingFlare = true;

      // When seduced, MASSIVELY increase guidance to chase the flare aggressively
      effectiveGuidanceStrength = data.guidanceStrength * 8.0; // 8x guidance when chasing flares!
      effectiveMaxTurnRate = data.maxTurnRate * 4.0; // 4x turn rate to aggressively pursue flares!
    } else {
      // No flares in range (or this seeker shrugged the volley off): the target
      currentTargetPosition = data.originalTargetPosition;
      isTargetingFlare = false;
    }
  }
  if (!closestFlare) {
    // Exposure over (volley burned out entirely or left the seeker cone):
    // re-roll against the next volley. This must run even when the flare list
    // is empty, or a 'hardened' roll would stick for the missile's lifetime.
    data.flareSeductionState = 'unrolled';
  }

  let isOvershooting = false;
  // Check for overshoot condition - if we passed the target, increase turn rate dramatically
  // But ONLY if not already targeting a flare (flare guidance takes absolute priority)
  if (!isTargetingFlare) {
    vector3SubtractToRef(currentTargetPosition, newPosition, iskDir);
    vector3NormalizeToRef(iskDir, iskDir);
    vector3NormalizeToRef(newVelocity, iskVelDir);
    const dotProduct = iskDir.x * iskVelDir.x + iskDir.y * iskVelDir.y + iskDir.z * iskVelDir.z;
    isOvershooting = dotProduct < 0.3; // If angle > 72 degrees, we're likely overshooting

    if (isOvershooting) {
      effectiveGuidanceStrength *= 3.0; // Triple guidance strength when overshooting
      effectiveMaxTurnRate *= 2.0; // Double turn rate for rapid correction
    }
  }

  // Use curved path for initial phase, then direct guidance when locked on
  newPathTime += data.deltaTime * data.pathSpeed;

  if (newPathTime <= 1.0 && !isLockedOn) {
    // Follow curved path during initial phase
    getIskanderCurvedPathPositionToRef(data.waypoints, newPathTime, iskCurveTarget);

    // Blend curved path with target tracking
    const blendFactor = Math.min(newPathTime * 2, 1.0); // Gradually blend toward target
    vector3LerpToRef(iskCurveTarget, currentTargetPosition, blendFactor, iskBlendedTarget);

    // iskDir becomes the desired velocity toward the blended target
    vector3SubtractToRef(iskBlendedTarget, newPosition, iskDir);
    vector3NormalizeToRef(iskDir, iskDir);
    vector3ScaleToRef(iskDir, data.speed, iskDir);

    // Smooth velocity interpolation for curved movement with effective turn rate
    const effectiveTurnRate = isOvershooting ? data.turnRate * 2.0 : data.turnRate;
    newVelocity.x = newVelocity.x + (iskDir.x - newVelocity.x) * effectiveTurnRate * data.deltaTime;
    newVelocity.y = newVelocity.y + (iskDir.y - newVelocity.y) * effectiveTurnRate * data.deltaTime;
    newVelocity.z = newVelocity.z + (iskDir.z - newVelocity.z) * effectiveTurnRate * data.deltaTime;
  } else if (isLockedOn) {
    // Use advanced guidance when locked on
    updateIskanderLockedOnGuidance(
      newPosition,
      newVelocity,
      currentTargetPosition,
      data.speed,
      effectiveGuidanceStrength,
      effectiveMaxTurnRate,
      data.deltaTime,
      newRotation,
    );
  } else {
    // Use initial guidance before lock-on established
    updateIskanderInitialGuidance(
      newPosition,
      newVelocity,
      currentTargetPosition,
      data.speed,
      effectiveMaxTurnRate,
      data.deltaTime,
      newRotation,
    );
  }

  // Update lock-on system: lock establishes after lockOnDuration, regardless of distance
  if (!isLockedOn && !data.lockSuspended) {
    lockOnTime += data.deltaTime;
    if (lockOnTime >= data.lockOnDuration) {
      isLockedOn = true;
      lockEstablished = true;
    }
  }

  // Ensure minimum velocity for guaranteed movement
  const velocityLength = vector3Length(newVelocity);
  if (velocityLength < data.speed * 0.1) {
    vector3SubtractToRef(currentTargetPosition, newPosition, iskDir);
    vector3NormalizeToRef(iskDir, iskDir);
    vector3ScaleToRef(iskDir, data.speed * 0.5, newVelocity);
  }

  // Update rotation if not already set by guidance system
  if (!isLockedOn && newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z > 0.01) {
    newRotation.y = Math.atan2(newVelocity.x, newVelocity.z);
    const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
    if (horizontalSpeed > 0.001) {
      newRotation.x = Math.atan2(-newVelocity.y, horizontalSpeed);
    }
  }

  // Update position
  newPosition.x += newVelocity.x * data.deltaTime;
  newPosition.y += newVelocity.y * data.deltaTime;
  newPosition.z += newVelocity.z * data.deltaTime;

  // Check collision conditions
  const distanceToTarget = vector3Distance(newPosition, data.targetPosition);

  // Check if close to any flare target and explode
  let flareExplosion = false;

  // Flares explode at closer range to simulate missile getting very close to flare head
  const flareExplosionDistance = 12; // Reduced from 25 to make missiles explode closer to flare

  // If missile is targeting a flare (or was targeting one), check distance to target position
  // Missiles should explode very close to the flare head when diverted
  if (isTargetingFlare || data.isTargetingFlare) {
    // Use the distance to target which should be the flare position when targeting flares
    if (distanceToTarget <= flareExplosionDistance) {
      // Missile gets close to flare head before detonation
      flareExplosion = true;
    }
  }

  // Proximity-detonate on the closest flare. One squared-distance check is
  // equivalent to the old scan over every flare: if ANY flare is within the
  // explosion radius, the closest one is too (detection radius >> 12u).
  if (!flareExplosion && closestFlare) {
    if (vector3DistanceSquared(newPosition, closestFlare) <= flareExplosionDistance * flareExplosionDistance) {
      // Missile explodes close to flare head when diverted
      flareExplosion = true;
    }
  }

  // Detonate at the terrain surface (chasing grounded flares must not take the
  // missile underground); clamp so the explosion renders at the surface.
  const groundHeight = data.groundHeight ?? 0;
  const hitGround = newPosition.y <= groundHeight;
  if (hitGround) {
    newPosition.y = groundHeight;
  }

  const reachedTarget = distanceToTarget <= 5 || hitGround || flareExplosion;

  result.pathTime = newPathTime;
  result.reachedTarget = reachedTarget;
  result.shouldExplode = reachedTarget;
  result.distanceToTarget = vector3Distance(newPosition, data.targetPosition);
  result.isLockedOn = isLockedOn;
  result.lockOnTime = lockOnTime;
  result.lockProgress = Math.min(lockOnTime / data.lockOnDuration, 1.0);
  result.isTargetingFlare = isTargetingFlare;
  result.lockEstablished = lockEstablished;
  return result;
}
