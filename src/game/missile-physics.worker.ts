import { Vector3, vector3Add, vector3Subtract, vector3Scale, vector3Normalize, vector3Distance, vector3Lerp } from './worker-utils';

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
    missileType: 'tomahawk' | 'defense';
}

interface MissilePhysicsResult {
    position: Vector3;
    velocity: Vector3;
    rotation: Vector3;
    pathTime: number;
    reachedTarget: boolean;
    shouldExplode: boolean;
    distanceToTarget: number;
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
            distanceToTarget: vector3Distance(data.position, data.targetPosition)
        };
    }

    let newPosition = { ...data.position };
    let newVelocity = { ...data.velocity };
    let newRotation = { ...data.rotation };
    let newPathTime = data.pathTime;
    let reachedTarget = false;
    let shouldExplode = false;

    if (data.missileType === 'tomahawk') {
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
        // Defense missile physics - simpler linear trajectory
        newVelocity = vector3Scale(vector3Normalize(vector3Subtract(data.targetPosition, newPosition)), data.speed);
        
        // Update rotation to match velocity direction for proper 3D orientation
        if (newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z > 0.01) {
            // Calculate yaw (horizontal rotation around Y axis)
            newRotation.y = Math.atan2(newVelocity.x, newVelocity.z);
            
            // Calculate pitch (vertical rotation around X axis) 
            const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
            const pitch = Math.atan2(newVelocity.y, horizontalSpeed);
            
            // Apply rotation adjustment for defense missile model orientation
            newRotation.x = pitch - Math.PI / 2; // Adjust for model's initial horizontal orientation
        } else {
            // If velocity is too small, use direction to target for initial orientation
            const direction = vector3Normalize(vector3Subtract(data.targetPosition, newPosition));
            newRotation.y = Math.atan2(direction.x, direction.z);
            const horizontalSpeed = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
            const pitch = Math.atan2(direction.y, horizontalSpeed);
            newRotation.x = pitch - Math.PI / 2;
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
    } else {
        // Defense missile has lifetime and distance checks
        const newLifeTime = data.lifeTime + data.deltaTime;
        reachedTarget = distanceToTarget < 5 || newLifeTime > data.maxLifeTime;
    }
    
    shouldExplode = reachedTarget;

    return {
        position: newPosition,
        velocity: newVelocity,
        rotation: newRotation,
        pathTime: newPathTime,
        reachedTarget,
        shouldExplode,
        distanceToTarget
    };
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