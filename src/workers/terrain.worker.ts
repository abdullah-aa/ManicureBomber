import { NoiseGenerator } from '../utils/NoiseGenerator';
import { Vector3 } from '@babylonjs/core';

enum BuildingType {
  RESIDENTIAL = 'residential',
  COMMERCIAL = 'commercial',
  INDUSTRIAL = 'industrial',
  SKYSCRAPER = 'skyscraper',
}

interface BuildingConfig {
  position: { x: number; y: number; z: number };
  type: BuildingType;
  width: number;
  height: number;
  depth: number;
  isTarget?: boolean;
  isDefenseLauncher?: boolean;
}

interface BuildingData {
  id: string;
  position: { x: number; y: number; z: number };
  width: number;
  height: number;
  depth: number;
  isTarget: boolean;
  isDefenseLauncher: boolean;
  isDestroyed: boolean;
}

interface ChunkData {
  chunkX: number;
  chunkZ: number;
  buildings: BuildingData[];
}

interface BuildingsInRadiusRequest {
  bomberPosition: { x: number; y: number; z: number };
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
  bomberPosition: { x: number; z: number };
  existingChunks: string[];
  maxTotalChunks: number;
  maxChunksPerUpdate: number;
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

  const isDefenseLauncher = Math.random() < 0.15;

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
  const buildingDensity = 0.00005;
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

    const buildingConfig = generateRandomBuildingConfig(new Vector3(buildingX, 0, buildingZ), terrainHeight);

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

function calculateDistance(pos1: { x: number; y: number; z: number }, pos2: { x: number; y: number; z: number }): number {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getBuildingsInRadius(request: BuildingsInRadiusRequest): BuildingData[] {
  const { bomberPosition, chunks, radius } = request;
  const buildings: BuildingData[] = [];

  for (const chunk of chunks) {
    for (const building of chunk.buildings) {
      // Return ALL buildings within radius, not just defense launchers
      if (!building.isDestroyed) {
        const distance = calculateDistance(bomberPosition, building.position);
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
  const { currentChunkX, currentChunkZ, bomberPosition, existingChunks, maxTotalChunks, maxChunksPerUpdate } = request;
  
  const chunksToGenerate: { chunkX: number; chunkZ: number }[] = [];
  let chunksGenerated = 0;

  // Generate chunks in immediate vicinity
  for (let x = currentChunkX - 1; x <= currentChunkX + 1 && chunksGenerated < maxChunksPerUpdate; x++) {
    for (let z = currentChunkZ - 1; z <= currentChunkZ + 1 && chunksGenerated < maxChunksPerUpdate; z++) {
      const chunkKey = `${x}_${z}`;
      if (!existingChunks.includes(chunkKey)) {
        chunksToGenerate.push({ chunkX: x, chunkZ: z });
        chunksGenerated++;
      }
    }
  }

  // Generate additional chunks based on direction if needed
  if (chunksGenerated < maxChunksPerUpdate && existingChunks.length < maxTotalChunks) {
    // Calculate direction based on bomber position relative to current chunk center
    const chunkCenterX = (currentChunkX + 0.5) * 500; // Assuming chunkSize = 500
    const chunkCenterZ = (currentChunkZ + 0.5) * 500;
    
    const directionX = bomberPosition.x > chunkCenterX ? 1 : -1;
    const directionZ = bomberPosition.z > chunkCenterZ ? 1 : -1;
    
    // Prioritize direction with larger offset
    const offsetX = Math.abs(bomberPosition.x - chunkCenterX);
    const offsetZ = Math.abs(bomberPosition.z - chunkCenterZ);
    
    if (offsetX > offsetZ) {
      // Generate chunks in X direction
      for (let z = currentChunkZ - 1; z <= currentChunkZ + 1 && chunksGenerated < maxChunksPerUpdate; z++) {
        const chunkKey = `${currentChunkX + directionX * 2}_${z}`;
        if (!existingChunks.includes(chunkKey)) {
          chunksToGenerate.push({ chunkX: currentChunkX + directionX * 2, chunkZ: z });
          chunksGenerated++;
        }
      }
    } else {
      // Generate chunks in Z direction
      for (let x = currentChunkX - 1; x <= currentChunkX + 1 && chunksGenerated < maxChunksPerUpdate; x++) {
        const chunkKey = `${x}_${currentChunkZ + directionZ * 2}`;
        if (!existingChunks.includes(chunkKey)) {
          chunksToGenerate.push({ chunkX: x, chunkZ: currentChunkZ + directionZ * 2 });
          chunksGenerated++;
        }
      }
    }
  }

  return chunksToGenerate;
}

function getChunksToRemove(request: { currentChunkX: number; currentChunkZ: number; existingChunks: string[]; maxDistance: number }): string[] {
  const { currentChunkX, currentChunkZ, existingChunks, maxDistance } = request;
  const chunksToRemove: string[] = [];

  for (const chunkKey of existingChunks) {
    const [chunkX, chunkZ] = chunkKey.split('_').map(Number);
    const distance = Math.abs(chunkX - currentChunkX) + Math.abs(chunkZ - currentChunkZ);
    if (distance > maxDistance) {
      chunksToRemove.push(chunkKey);
    }
  }

  return chunksToRemove;
}

function prepareBuildingDataForRadius(request: { position: { x: number; y: number; z: number }; radius: number; chunkSize: number; chunks: [string, any][] }): string[] {
  const { position, radius, chunkSize, chunks } = request;
  const relevantChunkKeys: string[] = [];
  
  for (const [chunkKey, chunk] of chunks) {
    const [chunkX, chunkZ] = chunkKey.split('_').map(Number);
    
    // Check if chunk is within radius
    const chunkCenterX = chunkX * chunkSize;
    const chunkCenterZ = chunkZ * chunkSize;
    const chunkDistance = Math.sqrt(
      Math.pow(position.x - chunkCenterX, 2) + Math.pow(position.z - chunkCenterZ, 2)
    );

    if (chunkDistance <= radius + chunkSize * 0.7) {
      relevantChunkKeys.push(chunkKey);
    }
  }

  return relevantChunkKeys;
}

function getBuildingsInRadiusMinimal(request: { position: { x: number; y: number; z: number }, buildings: any[], radius: number }): string[] {
  const { position, buildings, radius } = request;
  const ids: string[] = [];
  
  for (const building of buildings) {
    if (!building.isDestroyed) {
      const dx = position.x - building.position.x;
      const dy = position.y - building.position.y;
      const dz = position.z - building.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
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
