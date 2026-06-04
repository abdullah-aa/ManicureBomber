import { NoiseGenerator } from '../utils/NoiseGenerator';
import {
  Vector3,
  BuildingType,
  BuildingConfig,
  BuildingData,
  vector3Distance,
  vector2DistanceXZ,
} from './worker-utils';

interface ChunkData {
  chunkX: number;
  chunkZ: number;
  buildings: BuildingData[];
}

interface BuildingsInRadiusRequest {
  bomberPosition: Vector3;
  chunks: ChunkData[];
  radius: number;
}

interface TerrainHeightRequest {
  position: { x: number; z: number };
  heightmap: Float32Array;
  chunkSize: number;
  subdivisions: number;
}

interface ChunkDistanceRequest {
  position: { x: number; z: number };
  chunkSize: number;
}

interface ChunkGenerationRequest {
  currentChunkX: number;
  currentChunkZ: number;
  existingChunks: string[];
  maxTotalChunks: number;
  maxChunksPerUpdate: number;
  radius: number;
}

/**
 * Compute the keep-set used by BOTH generation and removal: a symmetric, heading-INDEPENDENT
 * Chebyshev square of radius `radius` chunks around the plane's chunk. Because it depends only on
 * (currentChunkX, currentChunkZ), turning never changes membership -> zero churn and no directional
 * gaps. The square (not a Euclidean disk) guarantees `radius * chunkSize` of coverage in every
 * direction including the 45-degree diagonal, so a turn toward any heading always faces loaded
 * terrain that fog hides before its edge (see TerrainManager: radius*chunkSize - 300 >= fogEnd).
 */
function computeKeepSet(currentChunkX: number, currentChunkZ: number, radius: number): Set<string> {
  const keep = new Set<string>();
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      keep.add(`${currentChunkX + dx}_${currentChunkZ + dz}`);
    }
  }
  return keep;
}

const noiseGenerator = new NoiseGenerator();

function calculateHeightFromNoise(x: number, z: number): number {
  let height = 0;
  height += noiseGenerator.fractalNoise(x * 0.005, z * 0.005, 4) * 25;
  height += noiseGenerator.fractalNoise(x * 0.015, z * 0.015, 3) * 15;
  height += noiseGenerator.fractalNoise(x * 0.03, z * 0.03, 2) * 8;
  height += noiseGenerator.fractalNoise(x * 0.08, z * 0.08, 1) * 3;
  return Math.max(0, Math.min(height, 60));
}

function generateHeightmap(chunkX: number, chunkZ: number, chunkSize: number, subdivisions: number): Float32Array {
  const worldX = chunkX * chunkSize;
  const worldZ = chunkZ * chunkSize;
  const heights = new Float32Array((subdivisions + 1) * (subdivisions + 1));

  for (let i = 0; i <= subdivisions; i++) {
    for (let j = 0; j <= subdivisions; j++) {
      const localX = (j / subdivisions - 0.5) * chunkSize;
      const localZ = (i / subdivisions - 0.5) * chunkSize;
      const x = localX + worldX;
      const z = localZ + worldZ;

      const height = calculateHeightFromNoise(x, z);
      const index = i * (subdivisions + 1) + j;
      heights[index] = height;
    }
  }
  return heights;
}

function generateRandomBuildingConfig(position: Vector3, terrainHeight: number): BuildingConfig {
  const types = Object.values(BuildingType);
  const type = types[Math.floor(Math.random() * types.length)] as BuildingType;

  let width: number, height: number, depth: number;

  switch (type) {
    case BuildingType.RESIDENTIAL:
      width = 8 + Math.random() * 8;
      height = 8 + Math.random() * 12;
      depth = 8 + Math.random() * 8;
      break;
    case BuildingType.COMMERCIAL:
      width = 12 + Math.random() * 15;
      height = 12 + Math.random() * 18;
      depth = 12 + Math.random() * 15;
      break;
    case BuildingType.INDUSTRIAL:
      width = 15 + Math.random() * 20;
      height = 10 + Math.random() * 15;
      depth = 15 + Math.random() * 20;
      break;
    case BuildingType.SKYSCRAPER:
      width = 10 + Math.random() * 12;
      height = 25 + Math.random() * 35;
      depth = 10 + Math.random() * 12;
      break;
    default:
      width = 8 + Math.random() * 10;
      height = 8 + Math.random() * 15;
      depth = 8 + Math.random() * 10;
  }

  // Launcher probability halved alongside the doubled building density below, so the absolute
  // number of defense launchers (and their per-frame cost / return fire) stays ~constant while
  // total building density increases.
  const isDefenseLauncher = Math.random() < 0.075;

  return {
    position: { x: position.x, y: terrainHeight, z: position.z },
    type: type,
    width: width,
    height: height,
    depth: depth,
    isDefenseLauncher: isDefenseLauncher,
  };
}

function generateBuildings(
  chunkX: number,
  chunkZ: number,
  chunkSize: number,
  heightmap: Float32Array,
  subdivisions: number,
): BuildingConfig[] {
  const worldX = chunkX * chunkSize;
  const worldZ = chunkZ * chunkSize;
  const buildingConfigs: BuildingConfig[] = [];
  // Per-area building density. Doubled from the original 0.0000125 now that buildings are cheap
  // (instanced meshes, shared materials/textures, lazy damage effects) — undamaged buildings cost
  // only a few instances sharing a material, so ~2x in-view buildings (~300-450) is affordable.
  const buildingDensity = 0.000025;
  const chunkArea = chunkSize * chunkSize;
  const numBuildings = Math.floor(chunkArea * buildingDensity * (0.5 + Math.random() * 0.8));

  for (let i = 0; i < numBuildings; i++) {
    const localX = (Math.random() - 0.5) * chunkSize * 0.8;
    const localZ = (Math.random() - 0.5) * chunkSize * 0.8;
    const buildingX = worldX + localX;
    const buildingZ = worldZ + localZ;

    const terrainHeight = getHeightAtPosition(localX, localZ, heightmap, chunkSize, subdivisions);

    const sampleDistance = 5;
    const heightNorth = getHeightAtPosition(localX, localZ - sampleDistance, heightmap, chunkSize, subdivisions);
    const heightSouth = getHeightAtPosition(localX, localZ + sampleDistance, heightmap, chunkSize, subdivisions);
    const heightEast = getHeightAtPosition(localX + sampleDistance, localZ, heightmap, chunkSize, subdivisions);
    const heightWest = getHeightAtPosition(localX - sampleDistance, localZ, heightmap, chunkSize, subdivisions);

    const maxSlope = Math.max(
      Math.abs(heightNorth - terrainHeight),
      Math.abs(heightSouth - terrainHeight),
      Math.abs(heightEast - terrainHeight),
      Math.abs(heightWest - terrainHeight),
    );

    if (maxSlope > 8) {
      continue;
    }

    const buildingConfig = generateRandomBuildingConfig({ x: buildingX, y: 0, z: buildingZ }, terrainHeight);

    buildingConfig.isTarget = Math.random() < 0.1;
    buildingConfigs.push(buildingConfig);
  }
  return buildingConfigs;
}

function getHeightAtPosition(
  localX: number,
  localZ: number,
  heights: Float32Array,
  chunkSize: number,
  subdivisions: number,
): number {
  const gridX = ((localX + chunkSize / 2) / chunkSize) * subdivisions;
  const gridZ = ((localZ + chunkSize / 2) / chunkSize) * subdivisions;

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

// New functions for offloaded calculations

function getBuildingsInRadius(request: BuildingsInRadiusRequest): BuildingData[] {
  const { bomberPosition, chunks, radius } = request;
  const buildings: BuildingData[] = [];

  for (const chunk of chunks) {
    for (const building of chunk.buildings) {
      // Return ALL buildings within radius, not just defense launchers
      if (!building.isDestroyed) {
        const distance = vector3Distance(bomberPosition, building.position);
        if (distance <= radius) {
          buildings.push(building);
        }
      }
    }
  }

  return buildings;
}

function getDistanceToNearestChunkEdge(request: ChunkDistanceRequest): number {
  const { position, chunkSize } = request;

  const chunkX = Math.floor(position.x / chunkSize);
  const chunkZ = Math.floor(position.z / chunkSize);

  const chunkCenterX = (chunkX + 0.5) * chunkSize;
  const chunkCenterZ = (chunkZ + 0.5) * chunkSize;

  const distanceToEdgeX = Math.abs(position.x - chunkCenterX);
  const distanceToEdgeZ = Math.abs(position.z - chunkCenterZ);

  return Math.min(chunkSize / 2 - distanceToEdgeX, chunkSize / 2 - distanceToEdgeZ);
}

function getTerrainHeight(request: TerrainHeightRequest): number {
  const { position, heightmap, chunkSize, subdivisions } = request;

  const localX = position.x;
  const localZ = position.z;

  return getHeightAtPosition(localX, localZ, heightmap, chunkSize, subdivisions);
}

function generateChunksNearPlayer(request: ChunkGenerationRequest): { chunkX: number; chunkZ: number }[] {
  const { currentChunkX, currentChunkZ, existingChunks, maxTotalChunks, maxChunksPerUpdate, radius } = request;

  if (existingChunks.length >= maxTotalChunks) {
    return [];
  }

  const keep = computeKeepSet(currentChunkX, currentChunkZ, radius);
  const existing = new Set(existingChunks);

  // Missing chunks of the keep-set, nearest-to-the-plane first (chunk-space distance, so it is
  // independent of chunkSize) so the ground under/around the plane fills before the outer ring.
  const missing: { chunkX: number; chunkZ: number; distSq: number }[] = [];
  for (const chunkKey of keep) {
    if (existing.has(chunkKey)) continue;
    const [chunkX, chunkZ] = chunkKey.split('_').map(Number);
    const dx = chunkX - currentChunkX;
    const dz = chunkZ - currentChunkZ;
    missing.push({ chunkX, chunkZ, distSq: dx * dx + dz * dz });
  }

  missing.sort((a, b) => a.distSq - b.distSq);

  const budget = Math.min(maxChunksPerUpdate, maxTotalChunks - existingChunks.length);
  return missing.slice(0, budget).map(({ chunkX, chunkZ }) => ({ chunkX, chunkZ }));
}

function getChunksToRemove(request: {
  currentChunkX: number;
  currentChunkZ: number;
  existingChunks: string[];
  radius: number;
}): string[] {
  const { currentChunkX, currentChunkZ, existingChunks, radius } = request;

  // Remove anything outside the symmetric keep-set (mirrors generation).
  const keep = computeKeepSet(currentChunkX, currentChunkZ, radius);
  return existingChunks.filter((chunkKey) => !keep.has(chunkKey));
}

function prepareBuildingDataForRadius(request: {
  position: Vector3;
  radius: number;
  chunkSize: number;
  chunks: [string, any][];
}): string[] {
  const { position, radius, chunkSize, chunks } = request;
  const relevantChunkKeys: string[] = [];

  for (const [chunkKey, chunk] of chunks) {
    const [chunkX, chunkZ] = chunkKey.split('_').map(Number);

    // Check if chunk is within radius
    const chunkCenterX = chunkX * chunkSize;
    const chunkCenterZ = chunkZ * chunkSize;
    const chunkDistance = vector2DistanceXZ(
      position,
      { x: chunkCenterX, y: 0, z: chunkCenterZ },
    );

    if (chunkDistance <= radius + chunkSize * 0.7) {
      relevantChunkKeys.push(chunkKey);
    }
  }

  return relevantChunkKeys;
}

function getBuildingsInRadiusMinimal(request: {
  position: Vector3;
  buildings: any[];
  radius: number;
}): string[] {
  const { position, buildings, radius } = request;
  const ids: string[] = [];

  for (const building of buildings) {
    if (!building.isDestroyed) {
      const dist = vector3Distance(position, building.position);
      if (dist <= radius) {
        ids.push(building.id);
      }
    }
  }

  return ids;
}

self.onmessage = (event) => {
  const { type, data, messageId } = event.data;

  switch (type) {
    case 'GENERATE_TERRAIN_CHUNK':
      const { chunkX, chunkZ, chunkSize, subdivisions } = data;
      const heightmap = generateHeightmap(chunkX, chunkZ, chunkSize, subdivisions);
      const buildingConfigs = generateBuildings(chunkX, chunkZ, chunkSize, heightmap, subdivisions);

      (self as any).postMessage({
        type: 'TERRAIN_CHUNK_READY',
        messageId,
        data: {
          chunkX,
          chunkZ,
          heightmap,
          buildingConfigs,
        },
      });
      break;

    case 'GET_BUILDINGS_IN_RADIUS':
      const buildingsInRadius = getBuildingsInRadius(data);
      (self as any).postMessage({
        type: 'BUILDINGS_IN_RADIUS_RESULT',
        messageId,
        data: { buildings: buildingsInRadius },
      });
      break;

    case 'GET_DISTANCE_TO_CHUNK_EDGE':
      const distance = getDistanceToNearestChunkEdge(data);
      (self as any).postMessage({
        type: 'CHUNK_DISTANCE_RESULT',
        messageId,
        data: { distance },
      });
      break;

    case 'GET_TERRAIN_HEIGHT':
      const height = getTerrainHeight(data);
      (self as any).postMessage({
        type: 'TERRAIN_HEIGHT_RESULT',
        messageId,
        data: { height },
      });
      break;

    case 'GENERATE_CHUNKS_NEAR_PLAYER':
      const chunksToGenerate = generateChunksNearPlayer(data);
      (self as any).postMessage({
        type: 'CHUNKS_TO_GENERATE_RESULT',
        messageId,
        data: { chunks: chunksToGenerate },
      });
      break;

    case 'GET_CHUNKS_TO_REMOVE':
      const chunksToRemove = getChunksToRemove(data);
      (self as any).postMessage({
        type: 'CHUNKS_TO_REMOVE_RESULT',
        messageId,
        data: { chunksToRemove },
      });
      break;

    case 'PREPARE_BUILDING_DATA_FOR_RADIUS':
      const relevantChunkKeys = prepareBuildingDataForRadius(data);
      (self as any).postMessage({
        type: 'BUILDING_DATA_PREPARED_RESULT',
        messageId,
        data: { relevantChunkKeys },
      });
      break;

    case 'GET_BUILDINGS_IN_RADIUS_MINIMAL':
      const buildingIds = getBuildingsInRadiusMinimal(data);
      (self as any).postMessage({
        type: 'BUILDINGS_IN_RADIUS_MINIMAL_RESULT',
        messageId,
        data: { buildingIds },
      });
      break;

    default:
      // Handle legacy terrain chunk generation
      if (data.chunkX !== undefined && data.chunkZ !== undefined) {
        const { chunkX, chunkZ, chunkSize, subdivisions } = data;
        const heightmap = generateHeightmap(chunkX, chunkZ, chunkSize, subdivisions);
        const buildingConfigs = generateBuildings(chunkX, chunkZ, chunkSize, heightmap, subdivisions);

        (self as any).postMessage({
          type: 'TERRAIN_CHUNK_READY',
          messageId,
          data: {
            chunkX,
            chunkZ,
            heightmap,
            buildingConfigs,
          },
        });
      }
      break;
  }
};
