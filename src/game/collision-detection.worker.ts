import { Vector3, vector3Distance, vector3Subtract, vector3Length } from './worker-utils';

interface BuildingData {
    id: string;
    position: Vector3;
    width: number;
    height: number;
    depth: number;
    isTarget: boolean;
    isDefenseLauncher: boolean;
    isDestroyed: boolean;
}

interface MissileData {
    id: string;
    position: Vector3;
    velocity: Vector3;
    radius: number;
    missileType: 'tomahawk' | 'defense';
}

interface BombData {
    id: string;
    position: Vector3;
    velocity: Vector3;
    radius: number;
}

interface CollisionDetectionData {
    buildings: BuildingData[];
    missiles: MissileData[];
    bombs: BombData[];
    bomberPosition: Vector3;
    terrainHeightmap: { [chunkKey: string]: Float32Array };
    chunkSize: number;
    subdivisions: number;
}

interface CollisionDetectionResult {
    missileCollisions: Array<{
        missileId: string;
        buildingId: string;
        distance: number;
    }>;
    bombCollisions: Array<{
        bombId: string;
        buildingId: string;
        distance: number;
    }>;
    terrainCollisions: Array<{
        objectId: string;
        objectType: 'missile' | 'bomb';
        terrainHeight: number;
        collisionPoint: Vector3;
    }>;
    buildingInRadius: Array<{
        buildingId: string;
        distance: number;
    }>;
}

interface BoundingBox {
    min: Vector3;
    max: Vector3;
}

interface CollisionObject {
    id: string;
    position: Vector3;
    bounds: BoundingBox;
    type: 'building' | 'missile' | 'bomber' | 'bomb';
    radius?: number;
}

interface GenericCollisionResult {
    objectId: string;
    collidedWith: string[];
    collisionPoints: Vector3[];
    penetrationDepth: number;
}

interface SpatialPartition {
    x: number;
    z: number;
    objects: CollisionObject[];
}

// Utility functions
function getHeightAtPosition(x: number, z: number, heightmap: { [chunkKey: string]: Float32Array }, chunkSize: number, subdivisions: number): number {
    const chunkX = Math.floor(x / chunkSize);
    const chunkZ = Math.floor(z / chunkSize);
    const chunkKey = `${chunkX}_${chunkZ}`;
    const heights = heightmap[chunkKey];

    if (!heights) {
        return 0; // Default height if chunk not loaded
    }

    const worldChunkX = chunkX * chunkSize;
    const worldChunkZ = chunkZ * chunkSize;
    
    const localX = x - worldChunkX;
    const localZ = z - worldChunkZ;
    
    const gridX = (localX + chunkSize / 2) / chunkSize * subdivisions;
    const gridZ = (localZ + chunkSize / 2) / chunkSize * subdivisions;
    
    const gridX0 = Math.floor(gridX);
    const gridZ0 = Math.floor(gridZ);

    if (gridX0 < 0 || gridX0 >= subdivisions || gridZ0 < 0 || gridZ0 >= subdivisions) {
        return 0;
    }

    const tx = gridX - gridX0;
    const tz = gridZ - gridZ0;
    
    const h00 = heights[gridZ0 * (subdivisions + 1) + gridX0];
    const h10 = heights[gridZ0 * (subdivisions + 1) + (gridX0 + 1)];
    const h01 = heights[(gridZ0 + 1) * (subdivisions + 1) + gridX0];
    const h11 = heights[(gridZ0 + 1) * (subdivisions + 1) + (gridX0 + 1)];

    if (h00 === undefined || h10 === undefined || h01 === undefined || h11 === undefined) {
        return 0;
    }
    
    const h_x1 = h00 * (1 - tx) + h10 * tx;
    const h_x2 = h01 * (1 - tx) + h11 * tx;

    return h_x1 * (1 - tz) + h_x2 * tz;
}

// Spatial partitioning for efficient collision detection
class SpatialGrid {
    private grid: Map<string, CollisionObject[]> = new Map();
    private cellSize: number = 50;

    clear(): void {
        this.grid.clear();
    }

    private getCellKey(position: Vector3): string {
        const cellX = Math.floor(position.x / this.cellSize);
        const cellZ = Math.floor(position.z / this.cellSize);
        return `${cellX}_${cellZ}`;
    }

    insert(object: CollisionObject): void {
        const cellKey = this.getCellKey(object.position);
        if (!this.grid.has(cellKey)) {
            this.grid.set(cellKey, []);
        }
        this.grid.get(cellKey)!.push(object);
    }

    getNearbyObjects(position: Vector3, radius: number): CollisionObject[] {
        const nearby: CollisionObject[] = [];
        const cellRadius = Math.ceil(radius / this.cellSize);
        const centerCell = this.getCellKey(position);
        const [centerX, centerZ] = centerCell.split('_').map(Number);

        for (let dx = -cellRadius; dx <= cellRadius; dx++) {
            for (let dz = -cellRadius; dz <= cellRadius; dz++) {
                const cellKey = `${centerX + dx}_${centerZ + dz}`;
                const cellObjects = this.grid.get(cellKey);
                if (cellObjects) {
                    nearby.push(...cellObjects);
                }
            }
        }

        return nearby;
    }
}

// Check if two bounding boxes intersect
function boxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
    return !(a.max.x < b.min.x || a.min.x > b.max.x ||
             a.max.y < b.min.y || a.min.y > b.max.y ||
             a.max.z < b.min.z || a.min.z > b.max.z);
}

// Check if a sphere intersects with a bounding box
function sphereBoxIntersect(sphereCenter: Vector3, sphereRadius: number, box: BoundingBox): boolean {
    const closestPoint = {
        x: Math.max(box.min.x, Math.min(sphereCenter.x, box.max.x)),
        y: Math.max(box.min.y, Math.min(sphereCenter.y, box.max.y)),
        z: Math.max(box.min.z, Math.min(sphereCenter.z, box.max.z))
    };

    const distance = vector3Distance(sphereCenter, closestPoint);
    return distance <= sphereRadius;
}

// Check collision between two objects
function checkCollision(obj1: CollisionObject, obj2: CollisionObject): GenericCollisionResult | null {
    // Skip self-collision
    if (obj1.id === obj2.id) return null;

    // Sphere-sphere collision (for missiles, bombs)
    if (obj1.radius && obj2.radius) {
        const distance = vector3Distance(obj1.position, obj2.position);
        const combinedRadius = obj1.radius + obj2.radius;
        
        if (distance <= combinedRadius) {
            const penetrationDepth = combinedRadius - distance;
            const collisionPoint = {
                x: (obj1.position.x + obj2.position.x) / 2,
                y: (obj1.position.y + obj2.position.y) / 2,
                z: (obj1.position.z + obj2.position.z) / 2
            };
            
            return {
                objectId: obj1.id,
                collidedWith: [obj2.id],
                collisionPoints: [collisionPoint],
                penetrationDepth
            };
        }
        return null;
    }

    // Sphere-box collision (missile/bomb vs building)
    if (obj1.radius && !obj2.radius) {
        if (sphereBoxIntersect(obj1.position, obj1.radius, obj2.bounds)) {
            return {
                objectId: obj1.id,
                collidedWith: [obj2.id],
                collisionPoints: [obj1.position],
                penetrationDepth: 1.0
            };
        }
        return null;
    }

    if (obj2.radius && !obj1.radius) {
        if (sphereBoxIntersect(obj2.position, obj2.radius, obj1.bounds)) {
            return {
                objectId: obj1.id,
                collidedWith: [obj2.id],
                collisionPoints: [obj2.position],
                penetrationDepth: 1.0
            };
        }
        return null;
    }

    // Box-box collision (building vs building)
    if (boxesIntersect(obj1.bounds, obj2.bounds)) {
        return {
            objectId: obj1.id,
            collidedWith: [obj2.id],
            collisionPoints: [obj1.position],
            penetrationDepth: 1.0
        };
    }

    return null;
}

// Perform collision detection on a set of objects
function performCollisionDetection(objects: CollisionObject[]): GenericCollisionResult[] {
    const results: GenericCollisionResult[] = [];
    const spatialGrid = new SpatialGrid();

    // Insert all objects into spatial grid
    objects.forEach(obj => spatialGrid.insert(obj));

    // Check collisions for each object
    objects.forEach(obj => {
        const nearbyObjects = spatialGrid.getNearbyObjects(obj.position, 100);
        const collisions: string[] = [];
        const collisionPoints: Vector3[] = [];
        let maxPenetration = 0;

        nearbyObjects.forEach(otherObj => {
            const collision = checkCollision(obj, otherObj);
            if (collision) {
                collisions.push(...collision.collidedWith);
                collisionPoints.push(...collision.collisionPoints);
                maxPenetration = Math.max(maxPenetration, collision.penetrationDepth);
            }
        });

        if (collisions.length > 0) {
            results.push({
                objectId: obj.id,
                collidedWith: collisions,
                collisionPoints,
                penetrationDepth: maxPenetration
            });
        }
    });

    return results;
}

// Handle worker messages
self.onmessage = (event) => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'DETECT_COLLISIONS':
            const collisionResults = performCollisionDetection(data.objects);
            (self as any).postMessage({
                type: 'COLLISION_RESULTS',
                data: { results: collisionResults }
            });
            break;
            
        case 'CHECK_SPECIFIC_COLLISION':
            const collision = checkCollision(data.object1, data.object2);
            (self as any).postMessage({
                type: 'SPECIFIC_COLLISION_RESULT',
                data: { collision }
            });
            break;
            
        case 'GET_BUILDINGS_IN_RADIUS':
            const buildingsInRadius = data.buildings
                .filter((building: BuildingData) => 
                    building.isDefenseLauncher && !building.isDestroyed
                )
                .map((building: BuildingData) => ({
                    buildingId: building.id,
                    distance: vector3Distance(data.bomberPosition, building.position)
                }))
                .filter((item: any) => item.distance <= data.radius);
                
            (self as any).postMessage({
                type: 'BUILDINGS_IN_RADIUS_RESULT',
                data: { buildingsInRadius }
            });
            break;
            
        default:
            console.warn('Unknown message type in collision detection worker:', type);
    }
}; 