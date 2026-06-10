import { Vector3 } from './worker-utils';

interface IskanderMissileData {
  id: string;
  position: Vector3;
  isLaunched: boolean;
  hasExploded: boolean;
}

interface DefenseMissileData {
  id: string;
  position: Vector3;
  isLaunched: boolean;
  hasExploded: boolean;
  buildingId: string;
}

interface BomberData {
  position: Vector3;
  isDestroyed: boolean;
}

interface IskanderCollisionResult {
  missileId: string;
  collisionType: 'direct_hit' | 'proximity';
  distance: number;
  damage: number;
  shouldExplode: boolean;
}

interface DefenseCollisionResult {
  missileId: string;
  collisionType: 'direct_hit' | 'proximity';
  distance: number;
  damage: number;
  shouldExplode: boolean;
}

// Check Iskander missile collisions with bomber (optimized with squared distance)
function checkIskanderCollisions(
  iskanderMissiles: IskanderMissileData[],
  bomberData: BomberData,
  messageId: string,
): void {
  const collisions: IskanderCollisionResult[] = [];

  if (bomberData.isDestroyed) {
    (self as any).postMessage({
      type: 'ISKANDER_COLLISION_RESULT',
      data: { collisions },
      messageId,
    });
    return;
  }

  // Precompute squared thresholds to avoid sqrt in loop
  const directHitRadiusSquared = 8 * 8;
  const proximityRadiusSquared = 20 * 20;

  for (const missile of iskanderMissiles) {
    if (missile.isLaunched && !missile.hasExploded) {
      // Calculate squared distance (avoids expensive sqrt)
      const dx = bomberData.position.x - missile.position.x;
      const dy = bomberData.position.y - missile.position.y;
      const dz = bomberData.position.z - missile.position.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;

      // Check for direct hit or proximity explosion
      if (distanceSquared <= directHitRadiusSquared) {
        // Direct hit radius - compute actual distance only when needed
        const distance = Math.sqrt(distanceSquared);
        collisions.push({
          missileId: missile.id,
          collisionType: 'direct_hit',
          distance,
          damage: 50, // 50% of bomber health
          shouldExplode: true,
        });
      } else if (distanceSquared <= proximityRadiusSquared) {
        // Proximity explosion - compute actual distance only when needed
        const distance = Math.sqrt(distanceSquared);
        const damage = Math.max(10, 40 - distance);
        collisions.push({
          missileId: missile.id,
          collisionType: 'proximity',
          distance,
          damage,
          shouldExplode: true,
        });
      }
    }
  }

  (self as any).postMessage({
    type: 'ISKANDER_COLLISION_RESULT',
    data: { collisions },
    messageId,
  });
}

// Check defense missile collisions with bomber (optimized with squared distance)
function checkDefenseCollisions(
  defenseMissiles: DefenseMissileData[],
  bomberData: BomberData,
  messageId: string,
): void {
  const collisions: DefenseCollisionResult[] = [];

  if (bomberData.isDestroyed) {
    (self as any).postMessage({
      type: 'DEFENSE_COLLISION_RESULT',
      data: { collisions },
      messageId,
    });
    return;
  }

  // Precompute squared thresholds to avoid sqrt in loop
  const directHitRadiusSquared = 8 * 8;
  const proximityRadiusSquared = 20 * 20;

  for (const missile of defenseMissiles) {
    if (missile.isLaunched && !missile.hasExploded) {
      // Calculate squared distance (avoids expensive sqrt)
      const dx = bomberData.position.x - missile.position.x;
      const dy = bomberData.position.y - missile.position.y;
      const dz = bomberData.position.z - missile.position.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;

      // Check for direct hit or proximity explosion
      if (distanceSquared <= directHitRadiusSquared) {
        // Direct hit radius - compute actual distance only when needed
        const distance = Math.sqrt(distanceSquared);
        collisions.push({
          missileId: missile.id,
          collisionType: 'direct_hit',
          distance,
          damage: 25, // Direct hit damage
          shouldExplode: true,
        });
      } else if (distanceSquared <= proximityRadiusSquared) {
        // Proximity explosion - compute actual distance only when needed
        const distance = Math.sqrt(distanceSquared);
        const damage = Math.max(5, 20 - distance);
        collisions.push({
          missileId: missile.id,
          collisionType: 'proximity',
          distance,
          damage,
          shouldExplode: true,
        });
      }
    }
  }

  (self as any).postMessage({
    type: 'DEFENSE_COLLISION_RESULT',
    data: { collisions },
    messageId,
  });
}

// Handle worker messages
self.onmessage = (event) => {
  const { type, data, messageId } = event.data;

  switch (type) {
    case 'CHECK_ISKANDER_COLLISIONS':
      checkIskanderCollisions(data.iskanderMissiles, data.bomberData, messageId);
      break;

    case 'CHECK_DEFENSE_COLLISIONS':
      checkDefenseCollisions(data.defenseMissiles, data.bomberData, messageId);
      break;

    default:
      // Silent handling of unknown message types
      break;
  }
};
