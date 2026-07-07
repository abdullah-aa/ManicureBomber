import { NoiseGenerator } from '../utils/NoiseGenerator';
import { Vector3, BuildingType, BuildingConfig, TerrainChunkRequest, createChunkRng } from './worker-utils';

// This worker does one thing now: heightmap + building-config generation for a
// chunk. All trivial streaming math (keep-set, chunk-edge distance) and spatial
// queries moved to the main thread, where they're cheaper than a message round trip.

// Seeded from the world seed carried by every request (the seed is per-page-load
// constant; the lazy re-create only matters for the first message).
let noiseGenerator = new NoiseGenerator(0);
let noiseSeed: number | null = null;

function ensureNoiseSeed(seed: number): void {
  if (noiseSeed !== seed) {
    noiseGenerator = new NoiseGenerator(seed);
    noiseSeed = seed;
  }
}

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

function generateRandomBuildingConfig(position: Vector3, terrainHeight: number, rng: () => number): BuildingConfig {
  const types = Object.values(BuildingType);
  const type = types[Math.floor(rng() * types.length)] as BuildingType;

  let width: number, height: number, depth: number;

  switch (type) {
    case BuildingType.RESIDENTIAL:
      width = 8 + rng() * 8;
      height = 8 + rng() * 12;
      depth = 8 + rng() * 8;
      break;
    case BuildingType.COMMERCIAL:
      width = 12 + rng() * 15;
      height = 12 + rng() * 18;
      depth = 12 + rng() * 15;
      break;
    case BuildingType.INDUSTRIAL:
      width = 15 + rng() * 20;
      height = 10 + rng() * 15;
      depth = 15 + rng() * 20;
      break;
    case BuildingType.SKYSCRAPER:
      width = 10 + rng() * 12;
      height = 25 + rng() * 35;
      depth = 10 + rng() * 12;
      break;
    default:
      width = 8 + rng() * 10;
      height = 8 + rng() * 15;
      depth = 8 + rng() * 10;
  }

  // Launcher probability halved alongside the doubled building density below, so the absolute
  // number of defense launchers (and their per-frame cost / return fire) stays ~constant while
  // total building density increases.
  const isDefenseLauncher = rng() < 0.075;

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
  seed: number,
): BuildingConfig[] {
  // Deterministic per-chunk stream: same (seed, chunk) → same buildings,
  // regardless of the order chunks get generated in.
  const rng = createChunkRng(seed, chunkX, chunkZ);
  const worldX = chunkX * chunkSize;
  const worldZ = chunkZ * chunkSize;
  const buildingConfigs: BuildingConfig[] = [];
  // Per-area building density. Doubled from the original 0.0000125 now that buildings are cheap
  // (instanced meshes, shared materials/textures, lazy damage effects) — undamaged buildings cost
  // only a few instances sharing a material, so ~2x in-view buildings (~300-450) is affordable.
  const buildingDensity = 0.000025;
  const chunkArea = chunkSize * chunkSize;
  const numBuildings = Math.floor(chunkArea * buildingDensity * (0.5 + rng() * 0.8));

  for (let i = 0; i < numBuildings; i++) {
    const localX = (rng() - 0.5) * chunkSize * 0.8;
    const localZ = (rng() - 0.5) * chunkSize * 0.8;
    const buildingX = worldX + localX;
    const buildingZ = worldZ + localZ;

    // TerrainManager copies the heightmap rows z-flipped to match CreateGround's
    // vertex order, so the rendered ground equals this noise field directly —
    // sample it at the building's own local position.
    const terrainHeight = getHeightAtPosition(localX, localZ, heightmap, chunkSize, subdivisions);

    const sampleDistance = 5;
    const heightNorth = getHeightAtPosition(localX, localZ + sampleDistance, heightmap, chunkSize, subdivisions);
    const heightSouth = getHeightAtPosition(localX, localZ - sampleDistance, heightmap, chunkSize, subdivisions);
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

    const buildingConfig = generateRandomBuildingConfig({ x: buildingX, y: 0, z: buildingZ }, terrainHeight, rng);

    // The base spans the whole footprint, so rest it on the LOWEST ground under the
    // four corners — a center-height base shows air under the downhill edge on any
    // slope.
    const halfWidth = buildingConfig.width / 2;
    const halfDepth = buildingConfig.depth / 2;
    let minCornerHeight = terrainHeight;
    for (const cornerX of [localX - halfWidth, localX + halfWidth]) {
      for (const cornerZ of [localZ - halfDepth, localZ + halfDepth]) {
        minCornerHeight = Math.min(
          minCornerHeight,
          getHeightAtPosition(cornerX, cornerZ, heightmap, chunkSize, subdivisions),
        );
      }
    }
    buildingConfig.position.y = minCornerHeight;

    buildingConfig.isTarget = rng() < 0.1;
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

self.onmessage = (event) => {
  const { type, data, messageId } = event.data;

  switch (type) {
    case 'GENERATE_TERRAIN_CHUNK':
      const { chunkX, chunkZ, chunkSize, subdivisions, seed } = data as TerrainChunkRequest;
      ensureNoiseSeed(seed);
      const heightmap = generateHeightmap(chunkX, chunkZ, chunkSize, subdivisions);
      const buildingConfigs = generateBuildings(chunkX, chunkZ, chunkSize, heightmap, subdivisions, seed);

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

    default:
      // Unknown message type: no reply. WorkerManager only sends the typed
      // requests above (the old untyped "legacy" duplicate handler is gone).
      break;
  }
};
