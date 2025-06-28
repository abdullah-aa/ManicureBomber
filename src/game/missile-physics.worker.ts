import { Vector3, vector3Add, vector3Subtract, vector3Scale, vector3Normalize, vector3Distance, vector3Lerp, vector3Length } from './worker-utils';

interface MissilePhysicsData {
    position: Vector3;
    velocity: Vector3;
    rotation: Vector3;
    targetPosition: Vector3;
    speed: number;
    turnRate: number;
    deltaTime: number;
    pathTime: number;
    pathSpeed: number;
    waypoints: Vector3[];
    launched: boolean;
    exploded: boolean;
    lifeTime: number;
    maxLifeTime: number;
    missileType: 'tomahawk' | 'defense' | 'iskander';
    targetSet: boolean;
    
    // Iskander-specific properties
    flareTargets?: Vector3[];
    flareDetectionRange?: number;
    flareAttractionStrength?: number;
    originalTargetPosition?: Vector3;
    isTargetingFlare?: boolean;
    lockOnRange?: number;
    isLockedOn?: boolean;
    lockOnTime?: number;
    lockOnDuration?: number;
    guidanceStrength?: number;
    maxTurnRate?: number;
    lastTargetUpdateTime?: number;
    targetUpdateInterval?: number;
    currentTime?: number;
}

interface MissilePhysicsResult {
    position: Vector3;
    velocity: Vector3;
    rotation: Vector3;
    pathTime: number;
    reachedTarget: boolean;
    shouldExplode: boolean;
    distanceToTarget: number;
    targetSet: boolean;
    
    // Iskander-specific results
    isLockedOn?: boolean;
    lockOnTime?: number;
    lockProgress?: number;
    isTargetingFlare?: boolean;
    flareTargets?: Vector3[];
    lockEstablished?: boolean;
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
        z: basePos.z + curveZ
    };
}

// Iskander missile curved path calculation (optimized)
function getIskanderCurvedPathPosition(waypoints: Vector3[], t: number): Vector3 {
    if (waypoints.length < 2) return waypoints[0] || { x: 0, y: 0, z: 0 };
    
    const startPos = waypoints[0];
    const endPos = waypoints[1];
    
    // Linear interpolation for base path
    const basePos = vector3Lerp(startPos, endPos, t);
    
    // Add curved deviation (smaller than Tomahawk for more direct flight)
    const distance = vector3Distance(startPos, endPos);
    const curveAmplitude = distance * 0.15; // 15% curve amplitude
    
    // Create a winding curve using sine waves
    const curveX = Math.sin(t * Math.PI * 2) * curveAmplitude;
    const curveZ = Math.cos(t * Math.PI * 1.5) * curveAmplitude;
    const curveY = Math.sin(t * Math.PI) * 30; // Height variation
    
    return {
        x: basePos.x + curveX,
        y: basePos.y + curveY,
        z: basePos.z + curveZ
    };
}

// Check for flare targets (optimized for performance)
function checkForFlareTargets(
    position: Vector3, 
    flareTargets: Vector3[], 
    flareDetectionRange: number,
    originalTargetPosition: Vector3
): { targetPosition: Vector3; isTargetingFlare: boolean; flareTargets: Vector3[] } {
    // Clear old flare targets that are too far away (optimization)
    const filteredFlareTargets = flareTargets.filter(flarePos => {
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
            flareTargets: filteredFlareTargets
        };
    }
    
    // If no flares in range, return to original target
    return {
        targetPosition: originalTargetPosition,
        isTargetingFlare: false,
        flareTargets: filteredFlareTargets
    };
}

// Update Iskander lock-on system
function updateIskanderLockOnSystem(
    position: Vector3,
    targetPosition: Vector3,
    lockOnRange: number,
    isLockedOn: boolean,
    lockOnTime: number,
    lockOnDuration: number,
    deltaTime: number
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
        lockEstablished
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
    deltaTime: number
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
    deltaTime: number
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

// Update missile physics
function updateMissilePhysics(data: MissilePhysicsData): MissilePhysicsResult {
    if (!data.launched || data.exploded) {
        return {
            position: data.position,
            velocity: data.velocity,
            rotation: data.rotation,
            pathTime: data.pathTime,
            reachedTarget: false,
            shouldExplode: false,
            distanceToTarget: vector3Distance(data.position, data.targetPosition),
            targetSet: false
        };
    }

    let newPosition = { ...data.position };
    let newVelocity = { ...data.velocity };
    let newRotation = { ...data.rotation };
    let newPathTime = data.pathTime;
    let reachedTarget = false;
    let shouldExplode = false;
    let isLockedOn = data.isLockedOn || false;
    let lockOnTime = data.lockOnTime || 0;
    let isTargetingFlare = data.isTargetingFlare || false;
    let flareTargets = data.flareTargets || [];
    let lockEstablished = false;

    if (data.missileType === 'iskander') {
        // Simplified Iskander missile physics - ensure basic movement works first
        const currentTime = data.currentTime || 0;
        
        // Basic guidance: always move toward target
        const directionToTarget = vector3Normalize(vector3Subtract(data.targetPosition, newPosition));
        const desiredVelocity = vector3Scale(directionToTarget, data.speed);
        
        // Simple velocity interpolation
        const turnRate = data.turnRate || 1.5;
        newVelocity.x = newVelocity.x + (desiredVelocity.x - newVelocity.x) * turnRate * data.deltaTime;
        newVelocity.y = newVelocity.y + (desiredVelocity.y - newVelocity.y) * turnRate * data.deltaTime;
        newVelocity.z = newVelocity.z + (desiredVelocity.z - newVelocity.z) * turnRate * data.deltaTime;
        
        // Ensure minimum velocity
        const velocityLength = vector3Length(newVelocity);
        if (velocityLength < data.speed * 0.1) {
            newVelocity = vector3Scale(directionToTarget, data.speed * 0.5);
        }
        
        // Update rotation to match velocity direction
        if (newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z > 0.01) {
            newRotation.y = Math.atan2(newVelocity.x, newVelocity.z);
            const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
            if (horizontalSpeed > 0.001) {
                newRotation.x = Math.atan2(-newVelocity.y, horizontalSpeed);
            }
        }
        
        // Simple lock-on system - always allow lock regardless of distance
        if (!isLockedOn) {
            lockOnTime += data.deltaTime;
            if (lockOnTime >= (data.lockOnDuration || 1.0)) {
                isLockedOn = true;
                lockEstablished = true;
            }
        }
        
    } else if (data.missileType === 'tomahawk') {
        // Tomahawk missile physics with curved path
        newPathTime += data.deltaTime * data.pathSpeed;
        
        if (newPathTime <= 1.0) {
            // Follow the curved path
            const targetPosition = getCurvedPathPosition(data.waypoints, newPathTime);
            const directionToTarget = vector3Normalize(vector3Subtract(targetPosition, newPosition));
            const desiredVelocity = vector3Scale(directionToTarget, data.speed);
            
            // Smoothly interpolate velocity for curved movement
            newVelocity.x = newVelocity.x + (desiredVelocity.x - newVelocity.x) * data.turnRate * data.deltaTime;
            newVelocity.y = newVelocity.y + (desiredVelocity.y - newVelocity.y) * data.turnRate * data.deltaTime;
            newVelocity.z = newVelocity.z + (desiredVelocity.z - newVelocity.z) * data.turnRate * data.deltaTime;
        } else {
            // Head directly to target when curve is complete
            const directionToTarget = vector3Normalize(vector3Subtract(data.targetPosition, newPosition));
            newVelocity = vector3Scale(directionToTarget, data.speed);
        }

        // Update rotation to match velocity direction
        if (newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z > 0.01) {
            // Calculate yaw (horizontal rotation around Y axis)
            newRotation.y = Math.atan2(newVelocity.x, newVelocity.z);
            
            // Calculate pitch (vertical rotation around X axis) 
            const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
            newRotation.x = Math.atan2(newVelocity.y, horizontalSpeed);
        }
    } else {
        // Defense missile physics - optimized for performance
        if (!data.targetSet) {
            // Initial target setting - calculate direction once
            newVelocity = vector3Scale(vector3Normalize(vector3Subtract(data.targetPosition, newPosition)), data.speed);
            
            // Calculate yaw (horizontal rotation around Y axis)
            newRotation.y = Math.atan2(newVelocity.x, newVelocity.z) + Math.PI; // Add 180° to flip missile
                
            // Calculate pitch (vertical rotation around X axis) 
            const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
            newRotation.x = Math.atan2(newVelocity.y, horizontalSpeed) + Math.PI;
            
            // Mark target as set to avoid future recalculations
            data.targetSet = true;
        } else {
            // Target already set - maintain current velocity and rotation
            newVelocity = data.velocity;
            newRotation = data.rotation;
        }
    }

    // Update position
    newPosition.x += newVelocity.x * data.deltaTime;
    newPosition.y += newVelocity.y * data.deltaTime;
    newPosition.z += newVelocity.z * data.deltaTime;

    // Check collision conditions
    const distanceToTarget = vector3Distance(newPosition, data.targetPosition);
    
    if (data.missileType === 'tomahawk') {
        reachedTarget = distanceToTarget <= 5 || newPosition.y <= 0;
    } else if (data.missileType === 'iskander') {
        reachedTarget = distanceToTarget <= 5 || newPosition.y <= 0;
    } else {
        // Defense missile has lifetime and distance checks
        const newLifeTime = data.lifeTime + data.deltaTime;
        reachedTarget = distanceToTarget < 5 || newLifeTime > data.maxLifeTime;
    }
    
    shouldExplode = reachedTarget;

    const result: MissilePhysicsResult = {
        position: newPosition,
        velocity: newVelocity,
        rotation: newRotation,
        pathTime: newPathTime,
        reachedTarget,
        shouldExplode,
        distanceToTarget,
        targetSet: data.targetSet
    };

    // Add Iskander-specific results
    if (data.missileType === 'iskander') {
        result.isLockedOn = isLockedOn;
        result.lockOnTime = lockOnTime;
        result.lockProgress = Math.min(lockOnTime / (data.lockOnDuration || 1.0), 1.0);
        result.isTargetingFlare = isTargetingFlare;
        result.flareTargets = flareTargets;
        result.lockEstablished = lockEstablished;
    }

    return result;
}

// Handle worker messages
self.onmessage = (event) => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'UPDATE_MISSILE_PHYSICS':
            const result = updateMissilePhysics(data);
            (self as any).postMessage({
                type: 'MISSILE_PHYSICS_RESULT',
                data: result
            });
            break;
            
        case 'BATCH_UPDATE_MISSILES':
            const results = data.missiles.map((missileData: MissilePhysicsData) => 
                updateMissilePhysics(missileData)
            );
            (self as any).postMessage({
                type: 'BATCH_MISSILE_PHYSICS_RESULT',
                data: { results }
            });
            break;
            
        default:
            console.warn('Unknown message type in missile physics worker:', type);
    }
}; 