// Episodic missile math: one-shot defense-missile trajectory solutions and
// Tomahawk waypoint-path generation. Per-frame Tomahawk/Iskander guidance lives
// on the main thread in managers/MissileGuidance.ts — at 1-3 concurrent missiles
// the round-trip cost outweighed the math.

import {
  Vector3,
  vector3Add,
  vector3Subtract,
  vector3Scale,
  vector3Normalize,
  vector3Distance,
  vector3Lerp,
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
