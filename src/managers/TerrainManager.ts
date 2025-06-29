import { Scene, Vector3, GroundMesh, MeshBuilder, StandardMaterial, Color3, Color4, Texture, DynamicTexture, Mesh } from '@babylonjs/core';
import { NoiseGenerator } from '../utils/NoiseGenerator';
import { Building, BuildingConfig } from '../entities/Building';
import { WorkerManager } from './WorkerManager';

interface TerrainChunk {
    mesh: GroundMesh;
    buildings: Building[];
    x: number;
    z: number;
}

export class TerrainManager {
    private scene: Scene;
    private chunks: Map<string, TerrainChunk | null> = new Map();
    private chunkSize: number = 500;
    private viewDistance: number = 800;
    private generationThreshold: number = 300;
    private terrainMaterial!: StandardMaterial;
    private lastTerrainUpdateTime: number = 0;
    private heightmapCache: Map<string, Float32Array> = new Map();
    private subdivisions = 64;
    private lastBomberPosition: Vector3 = new Vector3(0, 0, 0);
    private bomber: any = null;

    private buildingCache: Map<string, Building[]> = new Map();
    private cacheTimeout: number = 1000;
    private lastCacheTime: number = 0;

    private workerManager: WorkerManager;
    private noiseGenerator: NoiseGenerator; // Kept for fallback height calculation

    private isDisposing: boolean = false;

    // Track active worker calls to prevent overlapping requests
    private activeWorkerCalls: Set<string> = new Set();

    constructor(scene: Scene, workerManager: WorkerManager) {
        this.scene = scene;
        this.workerManager = workerManager;
        this.noiseGenerator = new NoiseGenerator(); // Fallback for synchronous height requests
        this.createTerrainMaterial();
        this.createClearSky();
    }

    private async generateChunk(chunkX: number, chunkZ: number): Promise<void> {
        const chunkKey = `${chunkX}_${chunkZ}`;
        if (this.chunks.has(chunkKey)) return;

        // Check if this chunk is already being generated
        if (this.activeWorkerCalls.has(chunkKey)) {
            return; // Already being processed
        }

        this.chunks.set(chunkKey, null); // Placeholder to prevent re-generation
        this.activeWorkerCalls.add(chunkKey); // Track this worker call

        // Use synchronous generation during cleanup to avoid worker timeouts
        if (this.isDisposing) {
            this.generateChunkSynchronously(chunkX, chunkZ);
            this.activeWorkerCalls.delete(chunkKey);
            return;
        }

        try {
            // Use async/await with timeout
            const result = await this.workerManager.generateTerrainChunk(chunkX, chunkZ, this.chunkSize, this.subdivisions);
            
            // Only process result if we're still not disposing
            if (!this.isDisposing) {
                this.processTerrainChunkResult(result, chunkX, chunkZ);
            }
        } catch (error) {
            // Don't log timeout errors during disposal to reduce console noise
            if (!this.isDisposing) {
                // Silent error handling - no console logging
            }
            // Always fallback to synchronous generation if worker fails
            this.generateChunkSynchronously(chunkX, chunkZ);
        } finally {
            // Always clean up the tracking
            this.activeWorkerCalls.delete(chunkKey);
        }
    }

    private processTerrainChunkResult(result: any, chunkX: number, chunkZ: number): void {
        const chunkKey = `${chunkX}_${chunkZ}`;
        const { heightmap, buildingConfigs } = result;

        const worldX = chunkX * this.chunkSize;
        const worldZ = chunkZ * this.chunkSize;

        const ground = MeshBuilder.CreateGround(`ground_${chunkKey}`, {
            width: this.chunkSize,
            height: this.chunkSize,
            subdivisions: this.subdivisions
        }, this.scene);

        ground.position.x = worldX;
        ground.position.y = 0;
        ground.position.z = worldZ;
        ground.material = this.terrainMaterial;

        const positions = ground.getVerticesData('position');
        if (positions) {
            for (let i = 0; i < heightmap.length; i++) {
                positions[i * 3 + 1] = heightmap[i];
            }
            ground.updateVerticesData('position', positions);
            ground.createNormals(false);
        }

        this.heightmapCache.set(chunkKey, heightmap);

        const chunk: TerrainChunk = {
            mesh: ground,
            buildings: [],
            x: chunkX,
            z: chunkZ
        };

        this.chunks.set(chunkKey, chunk);

        this.createBuildingsFromConfigs(chunk, buildingConfigs);
    }

    private generateChunkSynchronously(chunkX: number, chunkZ: number): void {
        // Fallback synchronous generation using existing logic
        const chunkKey = `${chunkX}_${chunkZ}`;
        const worldX = chunkX * this.chunkSize;
        const worldZ = chunkZ * this.chunkSize;

        const ground = MeshBuilder.CreateGround(`ground_${chunkKey}`, {
            width: this.chunkSize,
            height: this.chunkSize,
            subdivisions: this.subdivisions
        }, this.scene);

        ground.position.x = worldX;
        ground.position.y = 0;
        ground.position.z = worldZ;
        ground.material = this.terrainMaterial;

        // Generate heightmap synchronously
        const heightmap = this.generateHeightmapSynchronously(chunkX, chunkZ);
        const positions = ground.getVerticesData('position');
        if (positions) {
            for (let i = 0; i < heightmap.length; i++) {
                positions[i * 3 + 1] = heightmap[i];
            }
            ground.updateVerticesData('position', positions);
            ground.createNormals(false);
        }

        this.heightmapCache.set(chunkKey, heightmap);

        const chunk: TerrainChunk = {
            mesh: ground,
            buildings: [],
            x: chunkX,
            z: chunkZ
        };

        this.chunks.set(chunkKey, chunk);

        // Generate buildings synchronously
        const buildingConfigs = this.generateBuildingsSynchronously(chunkX, chunkZ, heightmap);
        this.createBuildingsFromConfigs(chunk, buildingConfigs);
    }

    private generateHeightmapSynchronously(chunkX: number, chunkZ: number): Float32Array {
        const worldX = chunkX * this.chunkSize;
        const worldZ = chunkZ * this.chunkSize;
        const heights = new Float32Array((this.subdivisions + 1) * (this.subdivisions + 1));

        for (let i = 0; i <= this.subdivisions; i++) {
            for (let j = 0; j <= this.subdivisions; j++) {
                const localX = (j / this.subdivisions - 0.5) * this.chunkSize;
                const localZ = (i / this.subdivisions - 0.5) * this.chunkSize;
                const x = localX + worldX;
                const z = localZ + worldZ;

                const height = this.calculateHeightFromNoise(x, z);
                const index = i * (this.subdivisions + 1) + j;
                heights[index] = height;
            }
        }
        return heights;
    }

    private generateBuildingsSynchronously(chunkX: number, chunkZ: number, heightmap: Float32Array): BuildingConfig[] {
        const worldX = chunkX * this.chunkSize;
        const worldZ = chunkZ * this.chunkSize;
        const buildingConfigs: BuildingConfig[] = [];
        const buildingDensity = 0.00005;
        const chunkArea = this.chunkSize * this.chunkSize;
        const numBuildings = Math.floor(chunkArea * buildingDensity * (0.5 + Math.random() * 0.8));

        for (let i = 0; i < numBuildings; i++) {
            const localX = (Math.random() - 0.5) * this.chunkSize * 0.8;
            const localZ = (Math.random() - 0.5) * this.chunkSize * 0.8;
            const buildingX = worldX + localX;
            const buildingZ = worldZ + localZ;

            const terrainHeight = this.getHeightAtPositionFromHeightmap(localX, localZ, heightmap);

            const sampleDistance = 5;
            const heightNorth = this.getHeightAtPositionFromHeightmap(localX, localZ - sampleDistance, heightmap);
            const heightSouth = this.getHeightAtPositionFromHeightmap(localX, localZ + sampleDistance, heightmap);
            const heightEast = this.getHeightAtPositionFromHeightmap(localX + sampleDistance, localZ, heightmap);
            const heightWest = this.getHeightAtPositionFromHeightmap(localX - sampleDistance, localZ, heightmap);

            const maxSlope = Math.max(
                Math.abs(heightNorth - terrainHeight),
                Math.abs(heightSouth - terrainHeight),
                Math.abs(heightEast - terrainHeight),
                Math.abs(heightWest - terrainHeight)
            );

            if (maxSlope > 8) {
                continue;
            }

            const buildingConfig = this.generateRandomBuildingConfig(
                new Vector3(buildingX, 0, buildingZ),
                terrainHeight
            );

            buildingConfig.isTarget = Math.random() < 0.1;
            buildingConfigs.push(buildingConfig);
        }
        return buildingConfigs;
    }

    private getHeightAtPositionFromHeightmap(localX: number, localZ: number, heights: Float32Array): number {
        const gridX = (localX + this.chunkSize / 2) / this.chunkSize * this.subdivisions;
        const gridZ = (localZ + this.chunkSize / 2) / this.chunkSize * this.subdivisions;
        
        const gridX0 = Math.floor(gridX);
        const gridZ0 = Math.floor(gridZ);

        if (gridX0 < 0 || gridX0 >= this.subdivisions || gridZ0 < 0 || gridZ0 >= this.subdivisions) {
            return 0;
        }

        const tx = gridX - gridX0;
        const tz = gridZ - gridZ0;
        
        const h00 = heights[gridZ0 * (this.subdivisions + 1) + gridX0];
        const h10 = heights[gridZ0 * (this.subdivisions + 1) + (gridX0 + 1)];
        const h01 = heights[(gridZ0 + 1) * (this.subdivisions + 1) + gridX0];
        const h11 = heights[(gridZ0 + 1) * (this.subdivisions + 1) + (gridX0 + 1)];

        if (h00 === undefined || h10 === undefined || h01 === undefined || h11 === undefined) {
            return 0;
        }
        
        const h_x1 = h00 * (1 - tx) + h10 * tx;
        const h_x2 = h01 * (1 - tx) + h11 * tx;

        return h_x1 * (1 - tz) + h_x2 * tz;
    }

    private generateRandomBuildingConfig(position: Vector3, terrainHeight: number): BuildingConfig {
        const types = ['residential', 'commercial', 'industrial', 'skyscraper'];
        const type = types[Math.floor(Math.random() * types.length)] as any;
        
        let width: number, height: number, depth: number;
        
        switch (type) {
            case 'residential':
                width = 8 + Math.random() * 8;
                height = 8 + Math.random() * 12;
                depth = 8 + Math.random() * 8;
                break;
            case 'commercial':
                width = 12 + Math.random() * 15;
                height = 12 + Math.random() * 18;
                depth = 12 + Math.random() * 15;
                break;
            case 'industrial':
                width = 15 + Math.random() * 20;
                height = 10 + Math.random() * 15;
                depth = 15 + Math.random() * 20;
                break;
            case 'skyscraper':
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

    private createBuildingsFromConfigs(chunk: TerrainChunk, configs: BuildingConfig[]): void {
        configs.forEach(config => {
            const position = new Vector3(config.position.x, config.position.y, config.position.z);
            const buildingConfig = { ...config, position };

            const building = new Building(this.scene, buildingConfig);
            if (buildingConfig.isDefenseLauncher && this.bomber) {
                building.setOnDestroyedCallback(() => {
                    if (this.bomber && this.bomber.invalidateTargetCache) {
                        this.bomber.invalidateTargetCache();
                    }
                });
            }
            chunk.buildings.push(building);
        });
    }

    private createTerrainMaterial(): void {
        this.terrainMaterial = new StandardMaterial('terrainMaterial', this.scene);
        const groundTexture = new DynamicTexture('groundTexture', {width: 256, height: 256}, this.scene);
        const context = groundTexture.getContext();
        const imageData = context.getImageData(0, 0, 256, 256);
        for (let i = 0; i < imageData.data.length; i += 4) {
            const noise = Math.random();
            const variation = Math.random();
            let r, g, b;
            if (variation < 0.4) {
                r = Math.floor(60 + noise * 40);
                g = Math.floor(80 + noise * 50);
                b = Math.floor(30 + noise * 20);
            } else if (variation < 0.7) {
                r = Math.floor(100 + noise * 60);
                g = Math.floor(70 + noise * 40);
                b = Math.floor(40 + noise * 30);
            } else {
                r = Math.floor(80 + noise * 40);
                g = Math.floor(75 + noise * 35);
                b = Math.floor(70 + noise * 30);
            }
            imageData.data[i] = r;
            imageData.data[i + 1] = g;
            imageData.data[i + 2] = b;
            imageData.data[i + 3] = 255;
        }
        context.putImageData(imageData, 0, 0);
        groundTexture.update();
        this.terrainMaterial.diffuseTexture = groundTexture;
        this.terrainMaterial.diffuseColor = new Color3(0.9, 0.8, 0.7);
        this.terrainMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
    }

    private createClearSky(): void {
        // Set scene clear color to a clear sky blue
        this.scene.clearColor = new Color4(0.5, 0.7, 0.9, 1.0);
    }

    public async generateInitialTerrain(center: Vector3): Promise<void> {
        // Don't generate initial terrain if not safe for worker calls
        if (!this.isSafeForWorkerCalls()) {
            return;
        }
        
        const chunkX = Math.floor(center.x / this.chunkSize);
        const chunkZ = Math.floor(center.z / this.chunkSize);
        for (let x = chunkX - 1; x <= chunkX + 1; x++) {
            for (let z = chunkZ - 1; z <= chunkZ + 1; z++) {
                this.generateChunk(x, z);
            }
        }
    }

    private calculateHeightFromNoise(x: number, z: number): number {
        let height = 0;
        height += this.noiseGenerator.fractalNoise(x * 0.005, z * 0.005, 4) * 25;
        height += this.noiseGenerator.fractalNoise(x * 0.015, z * 0.015, 3) * 15;
        height += this.noiseGenerator.fractalNoise(x * 0.03, z * 0.03, 2) * 8;
        height += this.noiseGenerator.fractalNoise(x * 0.08, z * 0.08, 1) * 3;
        return Math.max(0, Math.min(height, 60));
    }

    public getHeightAtPosition(x: number, z: number): number {
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkZ = Math.floor(z / this.chunkSize);
        const chunkKey = `${chunkX}_${chunkZ}`;
        const heights = this.heightmapCache.get(chunkKey);

        if (!heights) {
            return this.calculateHeightFromNoise(x, z);
        }

        const worldChunkX = chunkX * this.chunkSize;
        const worldChunkZ = chunkZ * this.chunkSize;
        
        const localX = x - worldChunkX;
        const localZ = z - worldChunkZ;
        
        const gridX = (localX + this.chunkSize / 2) / this.chunkSize * this.subdivisions;
        const gridZ = (localZ + this.chunkSize / 2) / this.chunkSize * this.subdivisions;
        
        const gridX0 = Math.floor(gridX);
        const gridZ0 = Math.floor(gridZ);

        if (gridX0 < 0 || gridX0 >= this.subdivisions || gridZ0 < 0 || gridZ0 >= this.subdivisions) {
            return this.calculateHeightFromNoise(x, z);
        }

        const tx = gridX - gridX0;
        const tz = gridZ - gridZ0;
        
        const h00 = heights[gridZ0 * (this.subdivisions + 1) + gridX0];
        const h10 = heights[gridZ0 * (this.subdivisions + 1) + (gridX0 + 1)];
        const h01 = heights[(gridZ0 + 1) * (this.subdivisions + 1) + gridX0];
        const h11 = heights[(gridZ0 + 1) * (this.subdivisions + 1) + (gridX0 + 1)];

        if (h00 === undefined || h10 === undefined || h01 === undefined || h11 === undefined) {
            return this.calculateHeightFromNoise(x, z);
        }
        
        const h_x1 = h00 * (1 - tx) + h10 * tx;
        const h_x2 = h01 * (1 - tx) + h11 * tx;

        return h_x1 * (1 - tz) + h_x2 * tz;
    }

    public update(bomberPosition: Vector3): void {
        const currentChunkX = Math.floor(bomberPosition.x / this.chunkSize);
        const currentChunkZ = Math.floor(bomberPosition.z / this.chunkSize);
        
        // Performance optimization: limit update frequency and prevent updates during game over
        const currentTime = performance.now();
        if (currentTime - this.lastTerrainUpdateTime < 100) {
            return;
        }
        this.lastTerrainUpdateTime = currentTime;

        // Check if we're in a safe state for worker calls
        if (!this.isSafeForWorkerCalls()) {
            // Don't generate new terrain when not safe
            return;
        }

        const distanceToChunkEdge = this.getDistanceToNearestChunkEdge(bomberPosition);
        
        if (distanceToChunkEdge < this.generationThreshold) {
            this.generateChunksNearPlayer(currentChunkX, currentChunkZ, bomberPosition);
        }

        const chunksToRemove: string[] = [];
        let chunksProcessed = 0;
        const maxChunksToProcessPerFrame = 2;
        
        this.chunks.forEach((chunk, key) => {
            if (chunksProcessed >= maxChunksToProcessPerFrame) return;
            
            if (chunk) {
                const distance = Math.abs(chunk.x - currentChunkX) + Math.abs(chunk.z - currentChunkZ);
                if (distance > 3) {
                    chunksToRemove.push(key);
                    chunksProcessed++;
                }
            }
        });

        chunksToRemove.forEach(key => {
            const chunk = this.chunks.get(key);
            if (chunk) {
                chunk.buildings.forEach(building => building.dispose());
                chunk.buildings.length = 0;
                
                this.heightmapCache.delete(key);
                chunk.mesh.dispose();
                this.chunks.delete(key);
            }
        });
    }

    private getDistanceToNearestChunkEdge(position: Vector3): number {
        const chunkX = Math.floor(position.x / this.chunkSize);
        const chunkZ = Math.floor(position.z / this.chunkSize);
        
        const chunkCenterX = (chunkX + 0.5) * this.chunkSize;
        const chunkCenterZ = (chunkZ + 0.5) * this.chunkSize;
        
        const distanceToEdgeX = Math.abs(position.x - chunkCenterX);
        const distanceToEdgeZ = Math.abs(position.z - chunkCenterZ);
        
        return Math.min(this.chunkSize / 2 - distanceToEdgeX, this.chunkSize / 2 - distanceToEdgeZ);
    }

    private generateChunksNearPlayer(currentChunkX: number, currentChunkZ: number, bomberPosition: Vector3): void {
        // Don't generate chunks if not safe for worker calls
        if (!this.isSafeForWorkerCalls()) {
            return;
        }
        
        const maxTotalChunks = 25;
        if (this.chunks.size >= maxTotalChunks) {
            return;
        }
        
        let chunksGenerated = 0;
        const maxChunksPerUpdate = 4;
        
        for (let x = currentChunkX - 1; x <= currentChunkX + 1 && chunksGenerated < maxChunksPerUpdate; x++) {
            for (let z = currentChunkZ - 1; z <= currentChunkZ + 1 && chunksGenerated < maxChunksPerUpdate; z++) {
                const chunkKey = `${x}_${z}`;
                if (!this.chunks.has(chunkKey)) {
                    this.generateChunk(x, z);
                    chunksGenerated++;
                }
            }
        }
        
        if (chunksGenerated < maxChunksPerUpdate && this.chunks.size < maxTotalChunks) {
            const bomberVelocity = this.getBomberDirection(bomberPosition);
            if (Math.abs(bomberVelocity.x) > Math.abs(bomberVelocity.z)) {
                const directionX = bomberVelocity.x > 0 ? 1 : -1;
                for (let z = currentChunkZ - 1; z <= currentChunkZ + 1 && chunksGenerated < maxChunksPerUpdate; z++) {
                    const chunkKey = `${currentChunkX + directionX * 2}_${z}`;
                    if (!this.chunks.has(chunkKey)) {
                        this.generateChunk(currentChunkX + directionX * 2, z);
                        chunksGenerated++;
                    }
                }
            } else {
                const directionZ = bomberVelocity.z > 0 ? 1 : -1;
                for (let x = currentChunkX - 1; x <= currentChunkX + 1 && chunksGenerated < maxChunksPerUpdate; x++) {
                    const chunkKey = `${x}_${currentChunkZ + directionZ * 2}`;
                    if (!this.chunks.has(chunkKey)) {
                        this.generateChunk(x, currentChunkZ + directionZ * 2);
                        chunksGenerated++;
                    }
                }
            }
        }
    }

    private getBomberDirection(bomberPosition: Vector3): Vector3 {
        const direction = bomberPosition.subtract(this.lastBomberPosition);
        this.lastBomberPosition = bomberPosition.clone();
        return direction;
    }

    public getMaxBuildingHeight(): number {
        let maxHeight = 0;
        this.chunks.forEach(chunk => {
            if (chunk) {
                chunk.buildings.forEach(building => {
                    const height = building.getMaxHeight();
                    if (height > maxHeight) {
                        maxHeight = height;
                    }
                });
            }
        });
        return maxHeight;
    }

    public getBuildingsInRadius(position: Vector3, radius: number): Building[] {
        const cacheKey = `${Math.floor(position.x / 50)}_${Math.floor(position.z / 50)}_${radius}`;
        const currentTime = performance.now();
        
        if (this.buildingCache.has(cacheKey) && (currentTime - this.lastCacheTime) < this.cacheTimeout) {
            return this.buildingCache.get(cacheKey)!.filter(building => {
                const distance = Vector3.Distance(position, building.getPosition());
                return distance <= radius;
            });
        }

        const buildings: Building[] = [];
        
        const chunkRadius = Math.ceil(radius / this.chunkSize) + 1;
        const centerChunkX = Math.floor(position.x / this.chunkSize);
        const centerChunkZ = Math.floor(position.z / this.chunkSize);
        
        for (let x = centerChunkX - chunkRadius; x <= centerChunkX + chunkRadius; x++) {
            for (let z = centerChunkZ - chunkRadius; z <= centerChunkZ + chunkRadius; z++) {
                const chunkKey = `${x}_${z}`;
                const chunk = this.chunks.get(chunkKey);
                
                if (chunk) {
                    const chunkCenterX = x * this.chunkSize;
                    const chunkCenterZ = z * this.chunkSize;
                    const chunkDistance = Math.sqrt(
                        Math.pow(position.x - chunkCenterX, 2) + 
                        Math.pow(position.z - chunkCenterZ, 2)
                    );
                    
                    if (chunkDistance <= radius + this.chunkSize * 0.7) {
                        chunk.buildings.forEach(building => {
                            const distance = Vector3.Distance(position, building.getPosition());
                            if (distance <= radius) {
                                buildings.push(building);
                            }
                        });
                    }
                }
            }
        }
        
        this.buildingCache.set(cacheKey, buildings);
        this.lastCacheTime = currentTime;
        
        return buildings;
    }

    public getTerrainChunkAtPosition(position: Vector3): TerrainChunk | undefined {
        const chunkX = Math.floor(position.x / this.chunkSize);
        const chunkZ = Math.floor(position.z / this.chunkSize);
        const chunkKey = `${chunkX}_${chunkZ}`;
        return this.chunks.get(chunkKey) ?? undefined;
    }

    public updateDefenseLaunchers(bomberPosition: Vector3, currentTime: number, deltaTime: number): void {
        const maxRange = 400;
        const buildings = this.getBuildingsInRadius(bomberPosition, maxRange);
        
        buildings.forEach(building => {
            if (building.isDefenseLauncher()) {
                building.updateDefenseLauncher(bomberPosition, currentTime, deltaTime);
            }
        });
    }

    public setBomber(bomber: any): void {
        this.bomber = bomber;
    }

    private isSafeForWorkerCalls(): boolean {
        return !this.isDisposing && this.bomber && !this.bomber.isBomberDestroyed();
    }

    public dispose(): void {
        try {
            // Set disposing flag to prevent worker calls
            this.isDisposing = true;
            
            // Clear active worker calls
            this.activeWorkerCalls.clear();
            
            // Dispose of all chunks and their buildings
            this.chunks.forEach((chunk, key) => {
                if (chunk) {
                    chunk.buildings.forEach(building => building.dispose());
                    chunk.buildings.length = 0;
                    chunk.mesh.dispose();
                }
            });
            
            // Clear all maps
            this.chunks.clear();
            this.heightmapCache.clear();
            this.buildingCache.clear();
            
            // Dispose of terrain material
            if (this.terrainMaterial) {
                this.terrainMaterial.dispose();
            }
            
        } catch (error) {
            // Silent error handling - no console logging
        }
    }
}