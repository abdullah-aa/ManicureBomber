import { NoiseGenerator } from '../utils/NoiseGenerator';
import { Vector3 } from '@babylonjs/core';

enum BuildingType {
    RESIDENTIAL = 'residential',
    COMMERCIAL = 'commercial',
    INDUSTRIAL = 'industrial',
    SKYSCRAPER = 'skyscraper'
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
        isDefenseLauncher: isDefenseLauncher
    };
}

function generateBuildings(chunkX: number, chunkZ: number, chunkSize: number, heightmap: Float32Array, subdivisions: number): BuildingConfig[] {
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
            Math.abs(heightWest - terrainHeight)
        );

        if (maxSlope > 8) {
            continue;
        }

        const buildingConfig = generateRandomBuildingConfig(
            new Vector3(buildingX, 0, buildingZ),
            terrainHeight
        );

        buildingConfig.isTarget = Math.random() < 0.1;
        buildingConfigs.push(buildingConfig);
    }
    return buildingConfigs;
}

function getHeightAtPosition(localX: number, localZ: number, heights: Float32Array, chunkSize: number, subdivisions: number): number {
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


self.onmessage = (event) => {
    const { chunkX, chunkZ, chunkSize, subdivisions } = event.data;
    const heightmap = generateHeightmap(chunkX, chunkZ, chunkSize, subdivisions);
    const buildingConfigs = generateBuildings(chunkX, chunkZ, chunkSize, heightmap, subdivisions);

    (self as any).postMessage({
        chunkX,
        chunkZ,
        heightmap,
        buildingConfigs
    }, [heightmap.buffer]);
};
