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

// Tomahawk missile curved path calculation
function getCurvedPathPosition(waypoints: Vector3[], t: number): Vector3 {
  if (waypoints.length < 2) return waypoints[0] || { x: 0, y: 0, z: 0 };

  const startPos = waypoints[0];
  const endPos = waypoints[1];

  // Linear interpolation for base path
  const basePos = vector3Lerp(startPos, endPos, t);

  // Add curved deviation
  const distance = vector3Distance(startPos, endPos);
  const curveAmplitude = distance * 0.2; // 20% curve amplitude

  // Create a winding curve using sine waves
  const curveX = Math.sin(t * Math.PI * 2) * curveAmplitude;
  const curveZ = Math.cos(t * Math.PI * 1.5) * curveAmplitude;
  const curveY = Math.sin(t * Math.PI) * 50; // Height variation

  return {
    x: basePos.x + curveX,
    y: basePos.y + curveY,
    z: basePos.z + curveZ,
  };
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
function checkForFlareTargets(
  position: Vector3,
  flareTargets: Vector3[],
  flareDetectionRange: number,
  originalTargetPosition: Vector3,
): { targetPosition: Vector3; isTargetingFlare: boolean; flareTargets: Vector3[] } {
  // Clear old flare targets that are too far away (optimization)
  const filteredFlareTargets = flareTargets.filter((flarePos) => {
    const distanceToFlare = vector3Distance(position, flarePos);
    return distanceToFlare <= flareDetectionRange * 2; // Keep flares within 2x detection range
  });

  // Check if any flares are within detection range
  let closestFlare: Vector3 | null = null;
  let closestDistance = Infinity;

  for (let i = 0; i < filteredFlareTargets.length; i++) {
    const flarePos = filteredFlareTargets[i];
    const distanceToFlare = vector3Distance(position, flarePos);

    if (distanceToFlare <= flareDetectionRange && distanceToFlare < closestDistance) {
      closestFlare = flarePos;
      closestDistance = distanceToFlare;
    }
  }

  if (closestFlare) {
    // Switch to targeting the closest flare
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

  newPathTime += data.deltaTime * data.pathSpeed;

  // Check if we should update orientation at curve segment boundaries
  const segmentSize = 0.2;
  const segmentProgress = (newPathTime % segmentSize) / segmentSize;
  const orientationUpdateThreshold = data.orientationUpdateThreshold;

  const shouldUpdateOrientation =
    (segmentProgress <= orientationUpdateThreshold || segmentProgress >= 0.9) &&
    currentTime - lastSegmentChangeTime > 0.2;

  if (newPathTime <= 1.0) {
    // Follow the curved path
    const targetPosition = getCurvedPathPosition(data.waypoints, newPathTime);
    const directionToTarget = vector3Normalize(vector3Subtract(targetPosition, newPosition));
    const desiredVelocity = vector3Scale(directionToTarget, data.speed);

    // Smoothly interpolate velocity for curved movement
    newVelocity.x = newVelocity.x + (desiredVelocity.x - newVelocity.x) * data.turnRate * data.deltaTime;
    newVelocity.y = newVelocity.y + (desiredVelocity.y - newVelocity.y) * data.turnRate * data.deltaTime;
    newVelocity.z = newVelocity.z + (desiredVelocity.z - newVelocity.z) * data.turnRate * data.deltaTime;

    // Update orientation with look-ahead if it's time
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
    newVelocity = vector3Scale(directionToTarget, data.speed);
  }

  // Update rotation based on velocity (only if not updating orientation to look ahead)
  if (!shouldUpdateOrientation && newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z > 0.01) {
    // Calculate target rotation based on velocity
    const targetYaw = Math.atan2(newVelocity.x, newVelocity.z);
    const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
    const targetPitch = horizontalSpeed > 0.001 ? Math.atan2(-newVelocity.y, horizontalSpeed) : 0;

    // Smooth rotation interpolation
    const rotationSpeed = 3.0;
    const maxRotationChange = rotationSpeed * data.deltaTime;

    // Handle yaw wrapping
    let yawDiff = targetYaw - newRotation.y;
    while (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
    while (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;

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

  // Update position
  newPosition.x += newVelocity.x * data.deltaTime;
  newPosition.y += newVelocity.y * data.deltaTime;
  newPosition.z += newVelocity.z * data.deltaTime;

  // Check collision conditions
  const distanceToTarget = vector3Distance(newPosition, data.targetPosition);
  reachedTarget = distanceToTarget <= 5 || newPosition.y <= 0;
  shouldExplode = reachedTarget;

  return {
    position: newPosition,
    velocity: newVelocity,
    rotation: newRotation,
    pathTime: newPathTime,
    reachedTarget,
    shouldExplode,
    distanceToTarget,
    lastSegmentChangeTime,
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

  // Handle flare targeting if flare targets exist - check every frame for responsiveness
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
  }

  // Check for overshoot condition - if we passed the target, increase turn rate dramatically
  const directionToTarget = vector3Normalize(vector3Subtract(currentTargetPosition, newPosition));
  const velocityDirection = vector3Normalize(newVelocity);
  const dotProduct =
    directionToTarget.x * velocityDirection.x +
    directionToTarget.y * velocityDirection.y +
    directionToTarget.z * velocityDirection.z;
  const isOvershooting = dotProduct < 0.3; // If angle > 72 degrees, we're likely overshooting

  // Adjust guidance parameters based on overshoot
  let effectiveGuidanceStrength = data.guidanceStrength;
  let effectiveMaxTurnRate = data.maxTurnRate;

  if (isOvershooting) {
    effectiveGuidanceStrength *= 3.0; // Triple guidance strength when overshooting
    effectiveMaxTurnRate *= 2.0; // Double turn rate for rapid correction
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

  // If missile is targeting a flare (or was targeting one), check distance to target position
  if (isTargetingFlare || data.isTargetingFlare) {
    // Use the distance to target which should be the flare position when targeting flares
    if (distanceToTarget <= 12) {
      // Explode when close to flare lock position
      flareExplosion = true;
    }
  }

  // Also check active flare positions if any exist
  if (!flareExplosion && data.flareTargets && data.flareTargets.length > 0) {
    for (const flarePos of data.flareTargets) {
      const distanceToFlare = vector3Distance(newPosition, flarePos);
      if (distanceToFlare <= 8) {
        // Explode when very close to active flare
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

  // Generate waypoints for curved path using original calculation
  const waypoints = [predictedStartPos, targetPosition];

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
