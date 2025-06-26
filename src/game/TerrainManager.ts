import { Scene, Vector3, GroundMesh, MeshBuilder, StandardMaterial, Color3, Texture, DynamicTexture, Mesh, TransformNode, VertexData, Ray } from '@babylonjs/core';
import { NoiseGenerator } from '../utils/NoiseGenerator';
import { Building, BuildingConfig } from './Building';

interface TerrainChunk {
    mesh: GroundMesh;
    buildings: Building[];
    x: number;
    z: number;
}

export class TerrainManager {
    private scene: Scene;
    private chunks: Map<string, TerrainChunk> = new Map();
    private chunkSize: number = 500; // Increased from 200 to 500 for larger chunks
    private viewDistance: number = 800; // Increased view distance
    private generationThreshold: number = 300; // Distance from edge to trigger new chunk generation
    private noiseGenerator: NoiseGenerator;
    private terrainMaterial!: StandardMaterial;
    private skyMesh: Mesh | null = null;
    private lastTerrainUpdateTime: number = 0; // Add timing control for updates

    constructor(scene: Scene) {
        this.scene = scene;
        this.noiseGenerator = new NoiseGenerator();
        this.createTerrainMaterial();
        this.createClearSky();
    }

    private createTerrainMaterial(): void {
        this.terrainMaterial = new StandardMaterial('terrainMaterial', this.scene);
        
        // Create a procedural texture for varied terrain
        const groundTexture = new DynamicTexture('groundTexture', {width: 256, height: 256}, this.scene);
        const context = groundTexture.getContext();
        
        // Create varied terrain texture with grass, dirt, and rock
        const imageData = context.getImageData(0, 0, 256, 256);
        for (let i = 0; i < imageData.data.length; i += 4) {
            const noise = Math.random();
            const variation = Math.random();
            
            let r, g, b;
            if (variation < 0.4) {
                // Grass areas
                r = Math.floor(60 + noise * 40);  // Dark green
                g = Math.floor(80 + noise * 50);
                b = Math.floor(30 + noise * 20);
            } else if (variation < 0.7) {
                // Dirt/soil areas
                r = Math.floor(100 + noise * 60); // Brown
                g = Math.floor(70 + noise * 40);
                b = Math.floor(40 + noise * 30);
            } else {
                // Rocky areas
                r = Math.floor(80 + noise * 40);  // Gray-brown
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
        this.terrainMaterial.diffuseColor = new Color3(0.9, 0.8, 0.7); // Natural terrain color
        this.terrainMaterial.specularColor = new Color3(0.2, 0.2, 0.2); // Moderate specularity
    }

    private createClearSky(): void {
        // Create a large sphere for the sky dome
        this.skyMesh = MeshBuilder.CreateSphere('sky', { 
            diameter: this.viewDistance * 12,
            segments: 32
        }, this.scene);
        
        const skyMaterial = new StandardMaterial('skyMaterial', this.scene);
        
        // Create a clear sky gradient texture
        const skyTexture = new DynamicTexture('skyTexture', {width: 1024, height: 512}, this.scene);
        const context = skyTexture.getContext();
        
        // Create gradient from horizon to zenith
        const gradient = context.createLinearGradient(0, 0, 0, 512);
        gradient.addColorStop(0, '#87CEEB');    // Sky blue at horizon
        gradient.addColorStop(0.3, '#87CEFA');  // Light sky blue
        gradient.addColorStop(0.7, '#4169E1');  // Royal blue higher up
        gradient.addColorStop(1, '#191970');    // Midnight blue at zenith
        
        context.fillStyle = gradient;
        context.fillRect(0, 0, 1024, 512);
        
        // Add some subtle clouds
        context.globalAlpha = 0.1;
        context.fillStyle = 'white';
        
        // Generate random cloud-like shapes
        for (let i = 0; i < 50; i++) {
            const x = Math.random() * 1024;
            const y = Math.random() * 200 + 100; // Keep clouds in lower part of sky
            const width = 40 + Math.random() * 80;
            const height = 20 + Math.random() * 30;
            
            // Create soft cloud shapes with multiple overlapping circles
            for (let j = 0; j < 5; j++) {
                const cloudX = x + (Math.random() - 0.5) * width;
                const cloudY = y + (Math.random() - 0.5) * height;
                const cloudRadius = (width + height) / 4 * (0.5 + Math.random() * 0.5);
                
                context.beginPath();
                context.arc(cloudX, cloudY, cloudRadius, 0, 2 * Math.PI);
                context.fill();
            }
        }
        
        context.globalAlpha = 1.0;
        skyTexture.update();
        
        skyMaterial.diffuseTexture = skyTexture;
        skyMaterial.emissiveTexture = skyTexture;
        skyMaterial.emissiveColor = new Color3(0.8, 0.8, 0.9);  // Bright sky emission
        skyMaterial.disableLighting = true;
        skyMaterial.backFaceCulling = false;
        
        this.skyMesh.material = skyMaterial;
        this.skyMesh.position.y = 0; // Center at ground level
        this.skyMesh.infiniteDistance = true;
    }

    public generateInitialTerrain(center: Vector3): void {
        const chunkX = Math.floor(center.x / this.chunkSize);
        const chunkZ = Math.floor(center.z / this.chunkSize);

        // Generate initial 3x3 grid of chunks
        for (let x = chunkX - 1; x <= chunkX + 1; x++) {
            for (let z = chunkZ - 1; z <= chunkZ + 1; z++) {
                this.generateChunk(x, z);
            }
        }
    }

    private generateChunk(chunkX: number, chunkZ: number): void {
        const chunkKey = `${chunkX}_${chunkZ}`;
        if (this.chunks.has(chunkKey)) return;

        const worldX = chunkX * this.chunkSize;
        const worldZ = chunkZ * this.chunkSize;

        // Create ground mesh with more subdivisions for better terrain detail
        const ground = MeshBuilder.CreateGround(`ground_${chunkX}_${chunkZ}`, {
            width: this.chunkSize,
            height: this.chunkSize,
            subdivisions: 64  // Increased from 32 for more detailed terrain
        }, this.scene);

        ground.position.x = worldX;
        ground.position.y = 0; // Explicitly set terrain base at ground level
        ground.position.z = worldZ;
        ground.material = this.terrainMaterial;

        // Apply height map using noise
        this.applyHeightMap(ground, worldX, worldZ);

        const chunk: TerrainChunk = {
            mesh: ground,
            buildings: [],
            x: chunkX,
            z: chunkZ
        };

        // Generate buildings for this chunk
        this.generateBuildingsForChunk(chunk, worldX, worldZ);

        this.chunks.set(chunkKey, chunk);
    }

    private applyHeightMap(ground: GroundMesh, worldX: number, worldZ: number): void {
        const positions = ground.getVerticesData('position');
        if (!positions) return;

        for (let i = 1; i < positions.length; i += 3) {
            const x = positions[i - 1] + worldX;
            const z = positions[i + 1] + worldZ;
            
            // Generate varied terrain with reasonable heights (max ~50 units for reliability)
            let height = 0;
            
            // Base terrain using fractal noise [0,1] range 
            height += this.noiseGenerator.fractalNoise(x * 0.005, z * 0.005, 4) * 25; // Base hills
            height += this.noiseGenerator.fractalNoise(x * 0.015, z * 0.015, 3) * 15; // Medium features
            height += this.noiseGenerator.fractalNoise(x * 0.03, z * 0.03, 2) * 8;    // Surface variation
            height += this.noiseGenerator.fractalNoise(x * 0.08, z * 0.08, 1) * 3;    // Fine detail
            
            // Ensure height is always reasonable and positive
            height = Math.max(0, Math.min(height, 60)); // Cap at 60 units max
            
            positions[i] = Math.max(0, height); // No negative heights, but allow very low areas
        }

        ground.updateVerticesData('position', positions);
        ground.createNormals(false);
    }

    private generateBuildingsForChunk(chunk: TerrainChunk, worldX: number, worldZ: number): void {
        const buildingDensity = 0.00005; // Buildings per square unit (adjust for more/fewer buildings)
        const chunkArea = this.chunkSize * this.chunkSize;
        const numBuildings = Math.floor(chunkArea * buildingDensity * (0.5 + Math.random() * 0.8)); // Random variation

        for (let i = 0; i < numBuildings; i++) {
            // Random position within chunk boundaries
            const localX = (Math.random() - 0.5) * this.chunkSize * 0.8; // Leave some margin from edges
            const localZ = (Math.random() - 0.5) * this.chunkSize * 0.8;
            const buildingX = worldX + localX;
            const buildingZ = worldZ + localZ;
            
            // Get terrain height at this position
            const terrainHeight = this.getHeightAtPosition(buildingX, buildingZ);
            
            // Skip if terrain is too steep (simple slope check)
            const sampleDistance = 5;
            const heightNorth = this.getHeightAtPosition(buildingX, buildingZ - sampleDistance);
            const heightSouth = this.getHeightAtPosition(buildingX, buildingZ + sampleDistance);
            const heightEast = this.getHeightAtPosition(buildingX + sampleDistance, buildingZ);
            const heightWest = this.getHeightAtPosition(buildingX - sampleDistance, buildingZ);
            
            const maxSlope = Math.max(
                Math.abs(heightNorth - terrainHeight),
                Math.abs(heightSouth - terrainHeight),
                Math.abs(heightEast - terrainHeight),
                Math.abs(heightWest - terrainHeight)
            );
            
            // Skip building if terrain is too steep (more than 8 units difference over 5 units distance)
            if (maxSlope > 8) {
                continue;
            }
            
            // Generate building configuration
            const buildingConfig = Building.generateRandomBuildingConfig(
                new Vector3(buildingX, 0, buildingZ),
                terrainHeight
            );
            
            // Randomly designate 10% of buildings as targets
            buildingConfig.isTarget = Math.random() < 0.1;
            
            // Create and add building
            const building = new Building(this.scene, buildingConfig);
            chunk.buildings.push(building);
        }
    }

    public getHeightAtPosition(x: number, z: number): number {
        // Calculate height using the same algorithm as terrain generation for consistency
        let height = 0;
        
        // Base terrain using fractal noise [0,1] range - MUST match applyHeightMap exactly
        height += this.noiseGenerator.fractalNoise(x * 0.005, z * 0.005, 4) * 25; // Base hills
        height += this.noiseGenerator.fractalNoise(x * 0.015, z * 0.015, 3) * 15; // Medium features
        height += this.noiseGenerator.fractalNoise(x * 0.03, z * 0.03, 2) * 8;    // Surface variation
        height += this.noiseGenerator.fractalNoise(x * 0.08, z * 0.08, 1) * 3;    // Fine detail
        
        // Ensure height is always reasonable and positive - MUST match applyHeightMap exactly
        height = Math.max(0, Math.min(height, 60)); // Cap at 60 units max
        
        return height;
    }

    public update(bomberPosition: Vector3): void {
        const currentChunkX = Math.floor(bomberPosition.x / this.chunkSize);
        const currentChunkZ = Math.floor(bomberPosition.z / this.chunkSize);

        // Only update terrain generation periodically, not every frame
        // This prevents expensive operations from causing freezing
        const currentTime = performance.now();
        if (currentTime - this.lastTerrainUpdateTime < 100) {
            // Still update sky position every frame for smooth movement
            if (this.skyMesh) {
                this.skyMesh.position.x = bomberPosition.x;
                this.skyMesh.position.z = bomberPosition.z;
            }
            return;
        }
        this.lastTerrainUpdateTime = currentTime;

        // Check if bomber is approaching the edge of explored territory
        const distanceToChunkEdge = this.getDistanceToNearestChunkEdge(bomberPosition);
        
        if (distanceToChunkEdge < this.generationThreshold) {
            // Generate new chunks in the direction of movement
            this.generateChunksNearPlayer(currentChunkX, currentChunkZ, bomberPosition);
        }

        // Remove distant chunks to save memory (limit how many we process per frame)
        const chunksToRemove: string[] = [];
        let chunksProcessed = 0;
        const maxChunksToProcessPerFrame = 2; // Limit to prevent freezing
        
        this.chunks.forEach((chunk, key) => {
            if (chunksProcessed >= maxChunksToProcessPerFrame) return;
            
            const distance = Math.abs(chunk.x - currentChunkX) + Math.abs(chunk.z - currentChunkZ);
            if (distance > 3) { // Reduced from 4 since chunks are bigger now
                chunksToRemove.push(key);
                chunksProcessed++;
            }
        });

        chunksToRemove.forEach(key => {
            const chunk = this.chunks.get(key);
            if (chunk) {
                // Dispose of all buildings in the chunk
                chunk.buildings.forEach(building => building.dispose());
                chunk.buildings.length = 0;
                
                // Dispose of the terrain mesh
                chunk.mesh.dispose();
                this.chunks.delete(key);
            }
        });

        // Update sky position to follow player
        if (this.skyMesh) {
            this.skyMesh.position.x = bomberPosition.x;
            this.skyMesh.position.z = bomberPosition.z;
        }
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
        // Add safeguard: limit total number of chunks to prevent memory issues
        const maxTotalChunks = 25; // 5x5 grid maximum
        if (this.chunks.size >= maxTotalChunks) {
            return; // Don't generate more chunks if we're at the limit
        }
        
        // Generate chunks in a 3x3 grid around current position
        let chunksGenerated = 0;
        const maxChunksPerUpdate = 4; // Limit chunks generated per update to prevent freezing
        
        for (let x = currentChunkX - 1; x <= currentChunkX + 1 && chunksGenerated < maxChunksPerUpdate; x++) {
            for (let z = currentChunkZ - 1; z <= currentChunkZ + 1 && chunksGenerated < maxChunksPerUpdate; z++) {
                const chunkKey = `${x}_${z}`;
                if (!this.chunks.has(chunkKey)) {
                    this.generateChunk(x, z);
                    chunksGenerated++;
                }
            }
        }
        
        // Only generate forward chunks if we haven't hit our limit
        if (chunksGenerated < maxChunksPerUpdate && this.chunks.size < maxTotalChunks) {
            // Also generate chunks in the direction the bomber is moving
            const bomberVelocity = this.getBomberDirection(bomberPosition);
            if (Math.abs(bomberVelocity.x) > Math.abs(bomberVelocity.z)) {
                // Moving more in X direction
                const directionX = bomberVelocity.x > 0 ? 1 : -1;
                for (let z = currentChunkZ - 1; z <= currentChunkZ + 1 && chunksGenerated < maxChunksPerUpdate; z++) {
                    const chunkKey = `${currentChunkX + directionX * 2}_${z}`;
                    if (!this.chunks.has(chunkKey)) {
                        this.generateChunk(currentChunkX + directionX * 2, z);
                        chunksGenerated++;
                    }
                }
            } else {
                // Moving more in Z direction
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

    private lastBomberPosition: Vector3 = new Vector3(0, 0, 0);

    private getBomberDirection(bomberPosition: Vector3): Vector3 {
        // This is a simplified direction calculation
        // In a real implementation, you might get this from the bomber's velocity
        const direction = bomberPosition.subtract(this.lastBomberPosition);
        this.lastBomberPosition = bomberPosition.clone();
        return direction;
    }

    public getMaxBuildingHeight(): number {
        let maxHeight = 0;
        this.chunks.forEach(chunk => {
            chunk.buildings.forEach(building => {
                maxHeight = Math.max(maxHeight, building.getMaxHeight());
            });
        });
        return maxHeight;
    }

    public getBuildingsInRadius(position: Vector3, radius: number): Building[] {
        const buildings: Building[] = [];
        
        // Calculate which chunks might contain buildings in range
        const chunkRadius = Math.ceil(radius / this.chunkSize) + 1;
        const centerChunkX = Math.floor(position.x / this.chunkSize);
        const centerChunkZ = Math.floor(position.z / this.chunkSize);
        
        // Only check chunks that could contain buildings in range
        for (let x = centerChunkX - chunkRadius; x <= centerChunkX + chunkRadius; x++) {
            for (let z = centerChunkZ - chunkRadius; z <= centerChunkZ + chunkRadius; z++) {
                const chunkKey = `${x}_${z}`;
                const chunk = this.chunks.get(chunkKey);
                
                if (chunk) {
                    // Pre-filter by chunk distance to avoid unnecessary calculations
                    const chunkCenterX = x * this.chunkSize;
                    const chunkCenterZ = z * this.chunkSize;
                    const chunkDistance = Math.sqrt(
                        Math.pow(position.x - chunkCenterX, 2) + 
                        Math.pow(position.z - chunkCenterZ, 2)
                    );
                    
                    // Only check buildings in chunks that are close enough
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
        
        return buildings;
    }
} 