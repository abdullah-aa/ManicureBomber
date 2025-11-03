import {
  Vector3,
  vector3Add,
  vector3Subtract,
  vector3Scale,
  vector3Normalize,
  vector3Distance,
  vector3Lerp,
  vector3Length,
} from './worker-utils';

// Base interface for common missile properties
interface BaseMissileData {
  position: Vector3;
  velocity: Vector3;
  rotation: Vector3;
  targetPosition: Vector3;
  speed: number;
  deltaTime: number;
  launched: boolean;
  exploded: boolean;
}

// Defense missile specific data
interface DefenseMissileData extends BaseMissileData {
  bomberVelocity?: Vector3;
  targetSet: boolean;
  maxAltitude: number;
}

// Tomahawk missile specific data
interface TomahawkMissileData extends BaseMissileData {
  turnRate: number;
  pathTime: number;
  pathSpeed: number;
  waypoints: Vector3[];
  lookAheadDistance: number;
  orientationUpdateThreshold: number;
  lastSegmentChangeTime: number;
  currentTime: number;
}

// Iskander missile specific data
interface IskanderMissileData extends BaseMissileData {
  turnRate: number;
  pathTime: number;
  pathSpeed: number;
  waypoints: Vector3[];
  flareTargets: Vector3[];
  flareDetectionRange: number;
  originalTargetPosition: Vector3;
  isTargetingFlare: boolean;
  lockOnRange: number;
  isLockedOn: boolean;
  lockOnTime: number;
  lockOnDuration: number;
  guidanceStrength: number;
  maxTurnRate: number;
  currentTime: number;
}

// Base result interface
interface BaseMissileResult {
  position: Vector3;
  velocity: Vector3;
  rotation: Vector3;
  reachedTarget: boolean;
  shouldExplode: boolean;
  distanceToTarget: number;
}

// Defense missile specific result
interface DefenseMissileResult extends BaseMissileResult {
  targetSet: boolean;
}

// Tomahawk missile specific result
interface TomahawkMissileResult extends BaseMissileResult {
  pathTime: number;
  lastSegmentChangeTime: number;
  flightPhase: 'FLYBY' | 'TERMINAL';
}

// Iskander missile specific result
interface IskanderMissileResult extends BaseMissileResult {
  pathTime: number;
  isLockedOn: boolean;
  lockOnTime: number;
  lockProgress: number;
  isTargetingFlare: boolean;
  flareTargets: Vector3[];
  lockEstablished: boolean;
}

// Catmull-Rom spline interpolation helper for smooth curves
function catmullRomSpline(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
}

// Tomahawk missile curved path calculation with multi-segment support
function getCurvedPathPosition(waypoints: Vector3[], t: number): Vector3 {
  if (waypoints.length < 2) return waypoints[0] || { x: 0, y: 0, z: 0 };

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
      
      return catmullRomSpline(p0, p1, p2, p3, segmentT);
    } else {
      // Fallback to simple interpolation for 2-3 waypoints
      if (waypoints.length === 2) {
        return vector3Lerp(waypoints[0], waypoints[1], flybyT);
      } else {
        // Interpolate between first two waypoints for flyby
        return vector3Lerp(waypoints[0], waypoints[1], flybyT);
      }
    }
  } else {
    // Terminal descent phase: Sharp dive from waypoint 4 to target
    const terminalT = (t - terminalDescentThreshold) / (1.0 - terminalDescentThreshold);
    
    // Use waypoint 4 (terminal start) and final waypoint (target) for steep dive
    const terminalStartIndex = Math.min(3, waypoints.length - 2);
    const terminalStart = waypoints[terminalStartIndex];
    const target = waypoints[waypoints.length - 1];
    
    // Linear interpolation with exponential curve for dramatic dive
    const diveT = terminalT * terminalT; // Exponential curve for steeper descent
    const position = vector3Lerp(terminalStart, target, diveT);
    
    return position;
  }
}

// Iskander missile curved path calculation with wider angles (optimized)
function getIskanderCurvedPathPosition(waypoints: Vector3[], t: number): Vector3 {
  if (waypoints.length < 2) return waypoints[0] || { x: 0, y: 0, z: 0 };

  const startPos = waypoints[0];
  const endPos = waypoints[1];

  // Linear interpolation for base path
  const basePos = vector3Lerp(startPos, endPos, t);

  // Add curved deviation with wider angles for more unpredictable flight
  const distance = vector3Distance(startPos, endPos);
  const curveAmplitude = distance * 0.25; // Increased from 15% to 25% for wider angles

  // Create a more complex winding curve using multiple sine waves
  const curveX = Math.sin(t * Math.PI * 3) * curveAmplitude * Math.cos(t * Math.PI);
  const curveZ = Math.cos(t * Math.PI * 2.5) * curveAmplitude * Math.sin(t * Math.PI * 0.5);
  const curveY = Math.sin(t * Math.PI * 1.5) * 40; // Increased height variation

  return {
    x: basePos.x + curveX,
    y: basePos.y + curveY,
    z: basePos.z + curveZ,
  };
}

// Check for flare targets (optimized for performance)
// Real seeker missiles are HIGHLY susceptible to flares - they're infrared decoys!
function checkForFlareTargets(
  position: Vector3,
  flareTargets: Vector3[],
  flareDetectionRange: number,
  originalTargetPosition: Vector3,
): { targetPosition: Vector3; isTargetingFlare: boolean; flareTargets: Vector3[] } {
  // Clear old flare targets that are too far away (optimization)
  // Use larger range to simulate realistic IR seeker behavior
  const filteredFlareTargets = flareTargets.filter((flarePos) => {
    const distanceToFlare = vector3Distance(position, flarePos);
    return distanceToFlare <= flareDetectionRange * 5; // Expanded range for realistic behavior
  });

  // Check if any flares are within detection range
  // Real seekers are VERY attracted to flares - they're often hotter than the target!
  let closestFlare: Vector3 | null = null;
  let closestDistance = Infinity;

  for (let i = 0; i < filteredFlareTargets.length; i++) {
    const flarePos = filteredFlareTargets[i];
    const distanceToFlare = vector3Distance(position, flarePos);

    // Increased detection range to simulate realistic IR seeker sensitivity
    if (distanceToFlare <= flareDetectionRange * 1.5 && distanceToFlare < closestDistance) {
      closestFlare = flarePos;
      closestDistance = distanceToFlare;
    }
  }

  if (closestFlare) {
    // Switch to targeting the closest flare - ALWAYS prefer flares when available
    // This simulates how IR seekers are highly susceptible to decoys
    return {
      targetPosition: closestFlare,
      isTargetingFlare: true,
      flareTargets: filteredFlareTargets,
    };
  }

  // If no flares in range, return to original target
  return {
    targetPosition: originalTargetPosition,
    isTargetingFlare: false,
    flareTargets: filteredFlareTargets,
  };
}

// Update Iskander lock-on system
function updateIskanderLockOnSystem(
  isLockedOn: boolean,
  lockOnTime: number,
  lockOnDuration: number,
  deltaTime: number,
): { isLockedOn: boolean; lockOnTime: number; lockEstablished: boolean } {
  // Always allow lock establishment regardless of distance
  let newLockOnTime = lockOnTime;
  let newIsLockedOn = isLockedOn;
  let lockEstablished = false;

  if (!isLockedOn) {
    newLockOnTime += deltaTime;
    if (newLockOnTime >= lockOnDuration) {
      newIsLockedOn = true;
      lockEstablished = true;
    }
  }

  return {
    isLockedOn: newIsLockedOn,
    lockOnTime: newLockOnTime,
    lockEstablished,
  };
}

// Update Iskander guidance (locked on)
function updateIskanderLockedOnGuidance(
  position: Vector3,
  velocity: Vector3,
  targetPosition: Vector3,
  speed: number,
  guidanceStrength: number,
  maxTurnRate: number,
  deltaTime: number,
): { velocity: Vector3; rotation: Vector3 } {
  // Calculate direction to target
  const directionToTarget = vector3Normalize(vector3Subtract(targetPosition, position));

  // Calculate desired velocity toward target
  const desiredVelocity = vector3Scale(directionToTarget, speed);

  // Calculate velocity change needed
  const velocityChange = vector3Subtract(desiredVelocity, velocity);

  // Apply guidance with turn rate limiting
  const maxVelocityChange = maxTurnRate * speed * deltaTime;
  const velocityChangeMagnitude = vector3Length(velocityChange);

  let finalVelocityChange = velocityChange;
  if (velocityChangeMagnitude > maxVelocityChange) {
    finalVelocityChange = vector3Scale(vector3Normalize(velocityChange), maxVelocityChange);
  }

  // Apply guidance strength
  finalVelocityChange = vector3Scale(finalVelocityChange, guidanceStrength * deltaTime);

  // Update velocity
  const newVelocity = vector3Add(velocity, finalVelocityChange);

  // Ensure velocity doesn't exceed maximum speed
  const velocityLength = vector3Length(newVelocity);
  const finalVelocity = velocityLength > speed ? vector3Scale(vector3Normalize(newVelocity), speed) : newVelocity;

  // Calculate rotation based on velocity
  let rotation = { x: 0, y: 0, z: 0 };
  if (finalVelocity.x * finalVelocity.x + finalVelocity.z * finalVelocity.z > 0.01) {
    // Calculate yaw (horizontal rotation around Y axis)
    rotation.y = Math.atan2(finalVelocity.x, finalVelocity.z);

    // Calculate pitch (vertical rotation around X axis)
    const horizontalSpeed = Math.sqrt(finalVelocity.x * finalVelocity.x + finalVelocity.z * finalVelocity.z);
    if (horizontalSpeed > 0.001) {
      rotation.x = Math.atan2(-finalVelocity.y, horizontalSpeed);
    }
  }

  return { velocity: finalVelocity, rotation };
}

// Update Iskander initial guidance (before lock-on)
function updateIskanderInitialGuidance(
  position: Vector3,
  velocity: Vector3,
  targetPosition: Vector3,
  speed: number,
  maxTurnRate: number,
  deltaTime: number,
): { velocity: Vector3; rotation: Vector3 } {
  // Initial guidance before lock-on - follow a ballistic trajectory toward target
  const directionToTarget = vector3Normalize(vector3Subtract(targetPosition, position));
  const desiredVelocity = vector3Scale(directionToTarget, speed);

  // Gradually turn toward target
  const turnRate = maxTurnRate * 0.5; // Slower initial turn rate
  const velocityChange = vector3Subtract(desiredVelocity, velocity);
  const maxVelocityChange = turnRate * speed * deltaTime;

  let finalVelocityChange = velocityChange;
  if (vector3Length(velocityChange) > maxVelocityChange) {
    finalVelocityChange = vector3Scale(vector3Normalize(velocityChange), maxVelocityChange);
  }

  const newVelocity = vector3Add(velocity, finalVelocityChange);

  // Ensure velocity doesn't exceed maximum speed
  const velocityLength = vector3Length(newVelocity);
  const finalVelocity = velocityLength > speed ? vector3Scale(vector3Normalize(newVelocity), speed) : newVelocity;

  // Calculate rotation based on velocity
  let rotation = { x: 0, y: 0, z: 0 };
  if (finalVelocity.x * finalVelocity.x + finalVelocity.z * finalVelocity.z > 0.01) {
    // Calculate yaw (horizontal rotation around Y axis)
    rotation.y = Math.atan2(finalVelocity.x, finalVelocity.z);

    // Calculate pitch (vertical rotation around X axis)
    const horizontalSpeed = Math.sqrt(finalVelocity.x * finalVelocity.x + finalVelocity.z * finalVelocity.z);
    if (horizontalSpeed > 0.001) {
      rotation.x = Math.atan2(-finalVelocity.y, horizontalSpeed);
    }
  }

  return { velocity: finalVelocity, rotation };
}

// Defense missile initial trajectory calculation
function calculateDefenseMissileTrajectory(data: DefenseMissileData): DefenseMissileResult {
  if (!data.launched || data.exploded || data.targetSet) {
    // Return current state if already calculated or not ready
    return {
      position: data.position,
      velocity: data.velocity,
      rotation: data.rotation,
      reachedTarget: false,
      shouldExplode: false,
      distanceToTarget: vector3Distance(data.position, data.targetPosition),
      targetSet: data.targetSet,
    };
  }

  // Initial target setting with lead calculation
  let calculatedTargetPosition = data.targetPosition;

  // Calculate lead if bomber velocity is available
  if (data.bomberVelocity) {
    // Calculate distance to bomber
    const distanceToBomber = vector3Distance(data.position, data.targetPosition);

    // Calculate time for missile to reach bomber
    const timeToReachBomber = distanceToBomber / data.speed;

    // Predict bomber's future position based on missile travel time
    const bomberFuturePosition = {
      x: data.targetPosition.x + data.bomberVelocity.x * timeToReachBomber,
      y: data.targetPosition.y + data.bomberVelocity.y * timeToReachBomber,
      z: data.targetPosition.z + data.bomberVelocity.z * timeToReachBomber,
    };

    // Add inaccuracy to make the missile aim off target
    const inaccuracy = 30 + Math.random() * 50; // Variable inaccuracy between 30-80 units
    calculatedTargetPosition = {
      x: bomberFuturePosition.x + (Math.random() - 0.5) * inaccuracy,
      y: bomberFuturePosition.y + (Math.random() - 0.5) * inaccuracy,
      z: bomberFuturePosition.z + (Math.random() - 0.5) * inaccuracy,
    };
  }

  // Calculate direction to calculated target
  const newVelocity = vector3Scale(
    vector3Normalize(vector3Subtract(calculatedTargetPosition, data.position)),
    data.speed,
  );

  // Calculate rotation based on velocity
  const newRotation = { x: 0, y: 0, z: 0 };
  // Calculate yaw (horizontal rotation around Y axis)
  newRotation.y = Math.atan2(newVelocity.x, newVelocity.z) + Math.PI; // Add 180° to flip missile

  // Calculate pitch (vertical rotation around X axis)
  const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
  newRotation.x = Math.atan2(newVelocity.y, horizontalSpeed) + Math.PI;

  return {
    position: data.position, // Keep original position
    velocity: newVelocity,
    rotation: newRotation,
    reachedTarget: false,
    shouldExplode: false,
    distanceToTarget: vector3Distance(data.position, calculatedTargetPosition),
    targetSet: true, // Mark as calculated
  };
}

// Tomahawk missile physics handler
function updateTomahawkMissilePhysics(data: TomahawkMissileData): TomahawkMissileResult {
  if (!data.launched || data.exploded) {
    return {
      position: data.position,
      velocity: data.velocity,
      rotation: data.rotation,
      pathTime: data.pathTime,
      reachedTarget: false,
      shouldExplode: false,
      distanceToTarget: vector3Distance(data.position, data.targetPosition),
      lastSegmentChangeTime: data.lastSegmentChangeTime,
      flightPhase: 'FLYBY',
    };
  }

  let newPosition = { ...data.position };
  let newVelocity = { ...data.velocity };
  let newRotation = { ...data.rotation };
  let newPathTime = data.pathTime;
  let reachedTarget = false;
  let shouldExplode = false;
  let lastSegmentChangeTime = data.lastSegmentChangeTime;

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
    const targetPosition = getCurvedPathPosition(data.waypoints, newPathTime);
    const directionToTarget = vector3Normalize(vector3Subtract(targetPosition, newPosition));
    
    // Speed multiplier for terminal descent
    const effectiveSpeed = flightPhase === 'TERMINAL' ? data.speed * 1.3 : data.speed;
    const desiredVelocity = vector3Scale(directionToTarget, effectiveSpeed);

    // Turn rate multiplier for terminal descent (more aggressive)
    const effectiveTurnRate = flightPhase === 'TERMINAL' ? data.turnRate * 2.0 : data.turnRate;

    // Smoothly interpolate velocity for curved movement
    newVelocity.x = newVelocity.x + (desiredVelocity.x - newVelocity.x) * effectiveTurnRate * data.deltaTime;
    newVelocity.y = newVelocity.y + (desiredVelocity.y - newVelocity.y) * effectiveTurnRate * data.deltaTime;
    newVelocity.z = newVelocity.z + (desiredVelocity.z - newVelocity.z) * effectiveTurnRate * data.deltaTime;

    // Update orientation with look-ahead if it's time (flyby only)
    if (shouldUpdateOrientation) {
      const lookAheadDistance = data.lookAheadDistance;
      const lookAheadTime = Math.min(newPathTime + lookAheadDistance, 1.0);
      const lookAheadPos = getCurvedPathPosition(data.waypoints, lookAheadTime);
      const directionToLookAhead = vector3Normalize(vector3Subtract(lookAheadPos, newPosition));

      if (directionToLookAhead.x * directionToLookAhead.x + directionToLookAhead.z * directionToLookAhead.z > 0.01) {
        // Calculate target rotation
        const targetYaw = Math.atan2(directionToLookAhead.x, directionToLookAhead.z);
        const horizontalSpeed = Math.sqrt(
          directionToLookAhead.x * directionToLookAhead.x + directionToLookAhead.z * directionToLookAhead.z,
        );
        const targetPitch = horizontalSpeed > 0.001 ? Math.atan2(-directionToLookAhead.y, horizontalSpeed) : 0;

        // Smooth rotation interpolation
        const rotationSpeed = 3.0; // How fast the missile can rotate
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
    const directionToTarget = vector3Normalize(vector3Subtract(data.targetPosition, newPosition));
    const effectiveSpeed = flightPhase === 'TERMINAL' ? data.speed * 1.3 : data.speed;
    newVelocity = vector3Scale(directionToTarget, effectiveSpeed);
    flightPhase = 'TERMINAL'; // Force terminal phase when path complete
  }

  // Update rotation based on velocity (only if not updating orientation to look ahead)
  if (!shouldUpdateOrientation && newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z > 0.01) {
    // Calculate target rotation based on velocity
    const targetYaw = Math.atan2(newVelocity.x, newVelocity.z);
    const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
    const targetPitch = horizontalSpeed > 0.001 ? Math.atan2(-newVelocity.y, horizontalSpeed) : 0;

    // Enhanced rotation speed for terminal descent
    const rotationSpeed = flightPhase === 'TERMINAL' ? 5.0 : 3.0;
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

  // Check collision conditions
  const finalDistanceToTarget = vector3Distance(newPosition, data.targetPosition);
  reachedTarget = finalDistanceToTarget <= 5 || newPosition.y <= 0;
  shouldExplode = reachedTarget;

  return {
    position: newPosition,
    velocity: newVelocity,
    rotation: newRotation,
    pathTime: newPathTime,
    reachedTarget,
    shouldExplode,
    distanceToTarget: finalDistanceToTarget,
    lastSegmentChangeTime,
    flightPhase,
  };
}

// Iskander missile physics handler
function updateIskanderMissilePhysics(data: IskanderMissileData): IskanderMissileResult {
  if (!data.launched || data.exploded) {
    return {
      position: data.position,
      velocity: data.velocity,
      rotation: data.rotation,
      pathTime: data.pathTime,
      reachedTarget: false,
      shouldExplode: false,
      distanceToTarget: vector3Distance(data.position, data.targetPosition),
      isLockedOn: false,
      lockOnTime: 0,
      lockProgress: 0,
      isTargetingFlare: false,
      flareTargets: [],
      lockEstablished: false,
    };
  }

  let newPosition = { ...data.position };
  let newVelocity = { ...data.velocity };
  let newRotation = { ...data.rotation };
  let newPathTime = data.pathTime;
  let reachedTarget = false;
  let shouldExplode = false;
  let isLockedOn = data.isLockedOn;
  let lockOnTime = data.lockOnTime;
  let isTargetingFlare = data.isTargetingFlare;
  let flareTargets = data.flareTargets;
  let lockEstablished = false;

  // Initialize guidance parameters - will be adjusted based on targeting mode
  let effectiveGuidanceStrength = data.guidanceStrength;
  let effectiveMaxTurnRate = data.maxTurnRate;

  // Handle flare targeting if flare targets exist - check every frame for responsiveness
  // ALWAYS prioritize flares when detected - this is how real seeker missiles work!
  let currentTargetPosition = data.targetPosition;
  if (data.flareTargets && data.flareTargets.length > 0) {
    const flareResult = checkForFlareTargets(
      newPosition,
      data.flareTargets,
      data.flareDetectionRange,
      data.originalTargetPosition,
    );
    currentTargetPosition = flareResult.targetPosition;
    isTargetingFlare = flareResult.isTargetingFlare;
    flareTargets = flareResult.flareTargets;

    // When flare is detected, MASSIVELY increase guidance to chase it aggressively
    // This simulates how IR seekers are extremely attracted to hot flares
    if (isTargetingFlare) {
      effectiveGuidanceStrength = data.guidanceStrength * 8.0; // 8x guidance when chasing flares!
      effectiveMaxTurnRate = data.maxTurnRate * 4.0; // 4x turn rate to aggressively pursue flares!
    }
  }

  let isOvershooting = false;
  // Check for overshoot condition - if we passed the target, increase turn rate dramatically
  // But ONLY if not already targeting a flare (flare guidance takes absolute priority)
  if (!isTargetingFlare) {
    const directionToTarget = vector3Normalize(vector3Subtract(currentTargetPosition, newPosition));
    const velocityDirection = vector3Normalize(newVelocity);
    const dotProduct =
      directionToTarget.x * velocityDirection.x +
      directionToTarget.y * velocityDirection.y +
      directionToTarget.z * velocityDirection.z;
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
    const curvedTargetPosition = getIskanderCurvedPathPosition(data.waypoints, newPathTime);

    // Blend curved path with target tracking
    const blendFactor = Math.min(newPathTime * 2, 1.0); // Gradually blend toward target
    const blendedTarget = vector3Lerp(curvedTargetPosition, currentTargetPosition, blendFactor);

    const directionToTarget = vector3Normalize(vector3Subtract(blendedTarget, newPosition));
    const desiredVelocity = vector3Scale(directionToTarget, data.speed);

    // Smooth velocity interpolation for curved movement with effective turn rate
    const effectiveTurnRate = isOvershooting ? data.turnRate * 2.0 : data.turnRate;
    newVelocity.x = newVelocity.x + (desiredVelocity.x - newVelocity.x) * effectiveTurnRate * data.deltaTime;
    newVelocity.y = newVelocity.y + (desiredVelocity.y - newVelocity.y) * effectiveTurnRate * data.deltaTime;
    newVelocity.z = newVelocity.z + (desiredVelocity.z - newVelocity.z) * effectiveTurnRate * data.deltaTime;
  } else if (isLockedOn) {
    // Use advanced guidance when locked on
    const guidanceResult = updateIskanderLockedOnGuidance(
      newPosition,
      newVelocity,
      currentTargetPosition,
      data.speed,
      effectiveGuidanceStrength,
      effectiveMaxTurnRate,
      data.deltaTime,
    );
    newVelocity = guidanceResult.velocity;
    newRotation = guidanceResult.rotation;
  } else {
    // Use initial guidance before lock-on established
    const guidanceResult = updateIskanderInitialGuidance(
      newPosition,
      newVelocity,
      currentTargetPosition,
      data.speed,
      effectiveMaxTurnRate,
      data.deltaTime,
    );
    newVelocity = guidanceResult.velocity;
    newRotation = guidanceResult.rotation;
  }

  // Update lock-on system
  const lockResult = updateIskanderLockOnSystem(isLockedOn, lockOnTime, data.lockOnDuration, data.deltaTime);
  isLockedOn = lockResult.isLockedOn;
  lockOnTime = lockResult.lockOnTime;
  lockEstablished = lockResult.lockEstablished;

  // Ensure minimum velocity for guaranteed movement
  const velocityLength = vector3Length(newVelocity);
  if (velocityLength < data.speed * 0.1) {
    const directionToTarget = vector3Normalize(vector3Subtract(currentTargetPosition, newPosition));
    newVelocity = vector3Scale(directionToTarget, data.speed * 0.5);
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

  // Also check active flare positions if any exist - prioritize flares over actual target
  if (!flareExplosion && data.flareTargets && data.flareTargets.length > 0) {
    for (const flarePos of data.flareTargets) {
      const distanceToFlare = vector3Distance(newPosition, flarePos);
      if (distanceToFlare <= flareExplosionDistance) {
        // Missile explodes close to flare head when diverted
        flareExplosion = true;
        break;
      }
    }
  }

  reachedTarget = distanceToTarget <= 5 || newPosition.y <= 0 || flareExplosion;
  shouldExplode = reachedTarget;

  return {
    position: newPosition,
    velocity: newVelocity,
    rotation: newRotation,
    pathTime: newPathTime,
    reachedTarget,
    shouldExplode,
    distanceToTarget: vector3Distance(newPosition, data.targetPosition),
    isLockedOn,
    lockOnTime,
    lockProgress: Math.min(lockOnTime / data.lockOnDuration, 1.0),
    isTargetingFlare,
    flareTargets,
    lockEstablished,
  };
}

interface TomahawkPathRequest {
  launchPosition: Vector3;
  targetPosition: Vector3;
  animationOffset: Vector3;
}

function generateTomahawkPath(request: TomahawkPathRequest): { waypoints: Vector3[] } {
  const { launchPosition, targetPosition, animationOffset } = request;

  // Calculate predicted start position after launch animation
  const predictedStartPos = vector3Add(launchPosition, animationOffset);

  // Calculate direction from start to target
  const directionToTarget = vector3Normalize(vector3Subtract(targetPosition, predictedStartPos));
  const totalDistance = vector3Distance(predictedStartPos, targetPosition);

  // Define cruise altitude below bomber (bomber is at ~200, missile at ~100-120)
  // Ensure it's well below the bomber but above ground
  const cruiseAltitude = Math.max(predictedStartPos.y, targetPosition.y) - 80;
  const safeCruiseAltitude = Math.max(cruiseAltitude, 80); // Minimum 80 units above ground
  
  // Calculate horizontal distance (XZ plane)
  const horizontalDistance = Math.sqrt(
    (targetPosition.x - predictedStartPos.x) ** 2 + 
    (targetPosition.z - predictedStartPos.z) ** 2
  );

  // Calculate perpendicular vector for looping (90 degrees to direction)
  const perpendicular = {
    x: -directionToTarget.z,
    y: 0,
    z: directionToTarget.x,
  };

  // Calculate looping radius - make it large enough to avoid bomber
  // Use 40% of horizontal distance, minimum 150 units, maximum 400 units
  const loopRadius = Math.max(Math.min(horizontalDistance * 0.4, 400), 150);
  
  // Calculate center point for loops (midway between start and target, offset from bomber path)
  const loopCenter = vector3Lerp(predictedStartPos, targetPosition, 0.5);
  // Offset center away from bomber's path to avoid collision
  const centerOffset = horizontalDistance * 0.2;
  const offsetLoopCenter = {
    x: loopCenter.x + perpendicular.x * centerOffset,
    y: safeCruiseAltitude,
    z: loopCenter.z + perpendicular.z * centerOffset,
  };

  // Create waypoints for looping approach
  // Waypoint 1: Start position (after launch animation) - descend to cruise altitude
  const wp1 = {
    x: predictedStartPos.x,
    y: safeCruiseAltitude,
    z: predictedStartPos.z,
  };

  // First loop - approach from side
  // Waypoint 2: Entry point for first loop (east/north side)
  const angle1 = Math.atan2(perpendicular.x, perpendicular.z);
  const wp2 = {
    x: offsetLoopCenter.x + Math.sin(angle1) * loopRadius,
    y: safeCruiseAltitude,
    z: offsetLoopCenter.z + Math.cos(angle1) * loopRadius,
  };

  // Waypoint 3: South side of first loop
  const angle2 = angle1 + Math.PI * 0.5;
  const wp3 = {
    x: offsetLoopCenter.x + Math.sin(angle2) * loopRadius,
    y: safeCruiseAltitude,
    z: offsetLoopCenter.z + Math.cos(angle2) * loopRadius,
  };

  // Waypoint 4: West side of first loop
  const angle3 = angle1 + Math.PI;
  const wp4 = {
    x: offsetLoopCenter.x + Math.sin(angle3) * loopRadius,
    y: safeCruiseAltitude,
    z: offsetLoopCenter.z + Math.cos(angle3) * loopRadius,
  };

  // Waypoint 5: North side of first loop (completing first loop)
  const angle4 = angle1 + Math.PI * 1.5;
  const wp5 = {
    x: offsetLoopCenter.x + Math.sin(angle4) * loopRadius,
    y: safeCruiseAltitude,
    z: offsetLoopCenter.z + Math.cos(angle4) * loopRadius,
  };

  // Second loop - smaller radius, closer to target
  const loop2Radius = loopRadius * 0.7;
  const loop2Center = vector3Lerp(offsetLoopCenter, targetPosition, 0.4);
  const loop2CenterPos = {
    x: loop2Center.x,
    y: safeCruiseAltitude,
    z: loop2Center.z,
  };

  // Waypoint 6: Entry point for second loop
  const angle5 = angle1 + Math.PI * 0.25; // Offset from first loop
  const wp6 = {
    x: loop2CenterPos.x + Math.sin(angle5) * loop2Radius,
    y: safeCruiseAltitude,
    z: loop2CenterPos.z + Math.cos(angle5) * loop2Radius,
  };

  // Waypoint 7: Continue second loop
  const angle6 = angle5 + Math.PI * 0.5;
  const wp7 = {
    x: loop2CenterPos.x + Math.sin(angle6) * loop2Radius,
    y: safeCruiseAltitude,
    z: loop2CenterPos.z + Math.cos(angle6) * loop2Radius,
  };

  // Waypoint 8: Continue second loop
  const angle7 = angle5 + Math.PI;
  const wp8 = {
    x: loop2CenterPos.x + Math.sin(angle7) * loop2Radius,
    y: safeCruiseAltitude,
    z: loop2CenterPos.z + Math.cos(angle7) * loop2Radius,
  };

  // Waypoint 9: Complete second loop
  const angle8 = angle5 + Math.PI * 1.5;
  const wp9 = {
    x: loop2CenterPos.x + Math.sin(angle8) * loop2Radius,
    y: safeCruiseAltitude,
    z: loop2CenterPos.z + Math.cos(angle8) * loop2Radius,
  };

  // Waypoint 10: Terminal descent start point (above target, still at cruise altitude)
  const wp10 = {
    x: targetPosition.x + directionToTarget.x * 150, // 150 units ahead of target
    y: safeCruiseAltitude,
    z: targetPosition.z + directionToTarget.z * 150,
  };

  // Waypoint 11: Target position (final impact point)
  const wp11 = targetPosition;

  // Generate waypoints for looping path
  const waypoints = [wp1, wp2, wp3, wp4, wp5, wp6, wp7, wp8, wp9, wp10, wp11];

  return { waypoints };
}

// Handle worker messages
self.onmessage = (event) => {
  const { type, data, messageId } = event.data;

  switch (type) {
    case 'CALCULATE_DEFENSE_TRAJECTORY':
      const defenseResult = calculateDefenseMissileTrajectory(data);
      (self as any).postMessage({
        type: 'DEFENSE_TRAJECTORY_RESULT',
        data: defenseResult,
        messageId,
      });
      break;

    case 'UPDATE_TOMAHAWK_MISSILE':
      const tomahawkResult = updateTomahawkMissilePhysics(data);
      (self as any).postMessage({
        type: 'TOMAHAWK_MISSILE_RESULT',
        data: tomahawkResult,
        messageId,
      });
      break;

    case 'UPDATE_ISKANDER_MISSILE':
      const iskanderResult = updateIskanderMissilePhysics(data);
      (self as any).postMessage({
        type: 'ISKANDER_MISSILE_RESULT',
        data: iskanderResult,
        messageId,
      });
      break;

    case 'GENERATE_TOMAHAWK_PATH':
      const pathResult = generateTomahawkPath(data);
      (self as any).postMessage({
        type: 'TOMAHAWK_PATH_RESULT',
        data: pathResult,
        messageId,
      });
      break;

    default:
      // Silent handling of unknown message types
      break;
  }
};
