import {
  Scene,
  Vector3,
  GroundMesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  DynamicTexture,
} from '@babylonjs/core';
import { Building, BuildingConfig } from '../entities/Building';
import { WorkerManager } from './WorkerManager';
import { Game } from './Game';

interface TerrainChunk {
  mesh: GroundMesh;
  buildings: Building[];
  x: number;
  z: number;
}

export class TerrainManager {
  private scene: Scene;
  private game: Game | null = null;
  private chunks: Map<string, TerrainChunk | null> = new Map();
  private chunkSize: number = 500;
  private generationThreshold: number = 400; // Increased for modern machines - can be reduced later if needed
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

  private isDisposing: boolean = false;

  // Track active worker calls to prevent overlapping requests
  private activeWorkerCalls: Set<string> = new Set();

  // Frame-spread mesh processing to prevent freezes
  private pendingChunkProcessing: Array<{
    result: any;
    chunkX: number;
    chunkZ: number;
    priority: number; // Higher priority = process first
  }> = [];
  private isProcessingChunk: boolean = false;
  private maxVerticesPerFrame: number = 1500; // Reduced from 2000 for smoother processing
  private lastChunkProcessTime: number = 0;
  private chunkProcessInterval: number = 16; // Minimum 16ms between chunk processing

  constructor(scene: Scene, workerManager: WorkerManager) {
    this.scene = scene;
    this.workerManager = workerManager;
    this.createTerrainMaterial();
    this.createClearSky();
  }

  private generateChunk(chunkX: number, chunkZ: number): Promise<void> {
    const chunkKey = `${chunkX}_${chunkZ}`;
    if (this.chunks.has(chunkKey)) return Promise.resolve();

    // Check if this chunk is already being generated
    if (this.activeWorkerCalls.has(chunkKey)) {
      return Promise.resolve(); // Already being processed
    }

    this.chunks.set(chunkKey, null); // Placeholder to prevent re-generation
    this.activeWorkerCalls.add(chunkKey); // Track this worker call

    return this.workerManager
      .generateTerrainChunk(chunkX, chunkZ, this.chunkSize, this.subdivisions)
      .then(
        (result: {
          chunkX: number;
          chunkZ: number;
          heightmap: Float32Array;
          buildingConfigs: Array<BuildingConfig>;
        }) => {
          // Only process result if we're still not disposing
          if (!this.isDisposing) {
            this.processTerrainChunkResult(result, chunkX, chunkZ);
          }
        },
      )
      .catch((error: any) => {
        // Remove failed chunk from tracking
        this.chunks.delete(chunkKey);
      })
      .finally(() => {
        // Always clean up the tracking
        this.activeWorkerCalls.delete(chunkKey);
      });
  }

  private processTerrainChunkResult(result: any, chunkX: number, chunkZ: number): void {
    // Calculate priority based on distance from bomber
    const bomberPos = this.bomber ? this.bomber.getPosition() : new Vector3(0, 0, 0);
    const chunkCenterX = chunkX * this.chunkSize;
    const chunkCenterZ = chunkZ * this.chunkSize;
    const distance = Math.sqrt((bomberPos.x - chunkCenterX) ** 2 + (bomberPos.z - chunkCenterZ) ** 2);
    const priority = Math.max(0, 1000 - distance); // Closer chunks get higher priority

    // Add to pending queue for frame-spread processing with priority
    this.pendingChunkProcessing.push({ result, chunkX, chunkZ, priority });

    // Sort by priority (higher priority first)
    this.pendingChunkProcessing.sort((a, b) => b.priority - a.priority);

    // Start processing if not already processing
    if (!this.isProcessingChunk) {
      this.processNextChunkFromQueue();
    }
  }

  private processNextChunkFromQueue(): void {
    if (this.pendingChunkProcessing.length === 0 || this.isDisposing) {
      this.isProcessingChunk = false;
      return;
    }

    // Respect minimum processing interval
    const currentTime = performance.now();
    if (currentTime - this.lastChunkProcessTime < this.chunkProcessInterval) {
      setTimeout(
        () => {
          this.processNextChunkFromQueue();
        },
        this.chunkProcessInterval - (currentTime - this.lastChunkProcessTime),
      );
      return;
    }

    this.isProcessingChunk = true;
    this.lastChunkProcessTime = currentTime;
    const { result, chunkX, chunkZ } = this.pendingChunkProcessing.shift()!;

    // Use requestAnimationFrame to spread work across frames
    requestAnimationFrame(() => {
      try {
        this.createTerrainChunkMesh(result, chunkX, chunkZ);
      } catch (error) {
        // Silent error handling
      }

      // Continue processing next chunk with proper timing
      requestAnimationFrame(() => {
        this.processNextChunkFromQueue();
      });
    });
  }

  private createTerrainChunkMesh(result: any, chunkX: number, chunkZ: number): void {
    const chunkKey = `${chunkX}_${chunkZ}`;
    const { heightmap, buildingConfigs } = result;

    const worldX = chunkX * this.chunkSize;
    const worldZ = chunkZ * this.chunkSize;

    // Split mesh creation into smaller operations
    const ground = MeshBuilder.CreateGround(
      `ground_${chunkKey}`,
      {
        width: this.chunkSize,
        height: this.chunkSize,
        subdivisions: this.subdivisions,
      },
      this.scene,
    );

    ground.position.x = worldX;
    ground.position.y = 0;
    ground.position.z = worldZ;
    ground.material = this.terrainMaterial;

    // Process vertex data in batches to prevent frame drops
    this.updateVertexDataInBatches(ground, heightmap, chunkKey, chunkX, chunkZ, buildingConfigs);
  }

  private updateVertexDataInBatches(
    ground: GroundMesh,
    heightmap: Float32Array,
    chunkKey: string,
    chunkX: number,
    chunkZ: number,
    buildingConfigs: any[],
  ): void {
    const positions = ground.getVerticesData('position');
    if (!positions) return;

    // Process vertices in smaller batches
    const batchSize = Math.min(this.maxVerticesPerFrame, heightmap.length);
    let processedVertices = 0;

    const processBatch = () => {
      const endIndex = Math.min(processedVertices + batchSize, heightmap.length);

      // Update vertex heights for this batch
      for (let i = processedVertices; i < endIndex; i++) {
        positions[i * 3 + 1] = heightmap[i];
      }

      processedVertices = endIndex;

      if (processedVertices >= heightmap.length) {
        // Finished processing all vertices
        ground.updateVerticesData('position', positions);
        ground.createNormals(false);

        this.heightmapCache.set(chunkKey, heightmap);

        const chunk: TerrainChunk = {
          mesh: ground,
          buildings: [],
          x: chunkX,
          z: chunkZ,
        };

        this.chunks.set(chunkKey, chunk);

        // Process buildings in the next frame to further spread the work
        requestAnimationFrame(() => {
          this.createBuildingsFromConfigs(chunk, buildingConfigs);
        });
      } else {
        // Continue processing in next frame
        requestAnimationFrame(processBatch);
      }
    };

    processBatch();
  }

  private createBuildingsFromConfigs(chunk: TerrainChunk, configs: BuildingConfig[]): void {
    // Process buildings in batches to prevent frame drops
    const maxBuildingsPerFrame = 3; // Limit buildings per frame
    let processedBuildings = 0;

    const processBuildingBatch = () => {
      const endIndex = Math.min(processedBuildings + maxBuildingsPerFrame, configs.length);

      for (let i = processedBuildings; i < endIndex; i++) {
        const config = configs[i];
        const position = new Vector3(config.position.x, config.position.y, config.position.z);
        const buildingConfig = { ...config, position };

        const building = new Building(this.scene, buildingConfig, this.workerManager);

        // Set Game reference for defense missile management
        if (this.game) {
          building.setGame(this.game);
        }

        if (buildingConfig.isDefenseLauncher && this.bomber) {
          building.setOnDestroyedCallback(() => {
            if (this.bomber && this.bomber.invalidateTargetCache) {
              this.bomber.invalidateTargetCache();
            }
          });
        }
        chunk.buildings.push(building);
      }

      processedBuildings = endIndex;

      if (processedBuildings < configs.length) {
        // Continue processing in next frame
        requestAnimationFrame(processBuildingBatch);
      }
    };

    processBuildingBatch();
  }

  private createTerrainMaterial(): void {
    this.terrainMaterial = new StandardMaterial('terrainMaterial', this.scene);
    const groundTexture = new DynamicTexture('groundTexture', { width: 256, height: 256 }, this.scene);
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

  public generateInitialTerrain(center: Vector3): Promise<void> {
    if (!this.isSafeForWorkerCalls()) {
      return Promise.resolve();
    }

    const chunkX = Math.floor(center.x / this.chunkSize);
    const chunkZ = Math.floor(center.z / this.chunkSize);

    const chunkPromises: Promise<void>[] = [];
    for (let x = chunkX - 1; x <= chunkX + 1; x++) {
      for (let z = chunkZ - 1; z <= chunkZ + 1; z++) {
        chunkPromises.push(this.generateChunk(x, z));
      }
    }

    return Promise.all(chunkPromises).then(() => {});
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

    // Use worker to calculate distance to chunk edge and generate chunks if needed
    this.workerManager
      .getDistanceToNearestChunkEdge(bomberPosition, this.chunkSize)
      .then((result: { distance: number }) => {
        if (result.distance < this.generationThreshold) {
          this.generateChunksNearPlayerAsync(currentChunkX, currentChunkZ, bomberPosition);
        }
      })
      .catch(() => {
        // Skip on failed updates - no fallback
        return;
      });

    // Use worker to determine which chunks to remove
    this.workerManager
      .getChunksToRemove(currentChunkX, currentChunkZ, Array.from(this.chunks.keys()), 3)
      .then((result: { chunksToRemove: string[] }) => {
        this.removeChunks(result.chunksToRemove);
      })
      .catch(() => {
        // Skip on failed updates - no fallback
        return;
      });
  }

  private removeChunks(chunksToRemove: string[]): void {
    let chunksProcessed = 0;
    const maxChunksToProcessPerFrame = 2;

    chunksToRemove.forEach((key) => {
      if (chunksProcessed >= maxChunksToProcessPerFrame) return;

      const chunk = this.chunks.get(key);
      if (chunk) {
        chunk.buildings.forEach((building) => building.dispose());
        chunk.buildings.length = 0;

        this.heightmapCache.delete(key);
        chunk.mesh.dispose();
        this.chunks.delete(key);
        chunksProcessed++;
      }
    });
  }

  private generateChunksNearPlayerAsync(currentChunkX: number, currentChunkZ: number, bomberPosition: Vector3): void {
    // Don't generate chunks if not safe for worker calls
    if (!this.isSafeForWorkerCalls()) {
      return;
    }

    const maxTotalChunks = 20; // Reduced from 25 to prevent too many concurrent chunks
    if (this.chunks.size >= maxTotalChunks) {
      return;
    }

    const existingChunks = Array.from(this.chunks.keys());
    const maxChunksPerUpdate = 2; // Reduced from 4 to spread generation over more frames

    // Use promise-based callbacks instead of async/await
    this.workerManager
      .generateChunksNearPlayer(
        currentChunkX,
        currentChunkZ,
        bomberPosition,
        existingChunks,
        maxTotalChunks,
        maxChunksPerUpdate,
      )
      .then((result) => {
        const chunksToGenerate = result.chunks as { chunkX: number; chunkZ: number }[];
        chunksToGenerate.forEach(({ chunkX, chunkZ }) => {
          this.generateChunk(chunkX, chunkZ);
        });
      })
      .catch(() => {
        // Skip on failed updates - no fallback
        return;
      });
  }

  public getMaxBuildingHeight(): number {
    let maxHeight = 0;
    this.chunks.forEach((chunk) => {
      if (chunk) {
        chunk.buildings.forEach((building) => {
          const height = building.getMaxHeight();
          if (height > maxHeight) {
            maxHeight = height;
          }
        });
      }
    });
    return maxHeight;
  }

  public getBuildingsInRadius(position: Vector3, radius: number): Promise<Building[]> {
    const cacheKey = `${Math.floor(position.x / 50)}_${Math.floor(position.z / 50)}_${radius}`;
    const currentTime = performance.now();

    if (this.buildingCache.has(cacheKey) && currentTime - this.lastCacheTime < this.cacheTimeout) {
      return Promise.resolve(
        this.buildingCache.get(cacheKey)!.filter((building) => {
          const distance = Vector3.Distance(position, building.getPosition());
          return distance <= radius;
        }),
      );
    }

    // Gather all buildings in all loaded chunks (or optimize to only nearby chunks)
    const buildingData: any[] = [];
    const buildingMap: Map<string, Building> = new Map();

    this.chunks.forEach((chunk) => {
      if (chunk) {
        chunk.buildings.forEach((building) => {
          const id = building.getPosition().toString();
          buildingData.push({
            id,
            position: {
              x: building.getPosition().x,
              y: building.getPosition().y,
              z: building.getPosition().z,
            },
            isTarget: building.isTarget(),
            isDefenseLauncher: building.isDefenseLauncher(),
            isDestroyed: building.getIsDestroyed(),
          });
          buildingMap.set(id, building);
        });
      }
    });

    return this.workerManager
      .getBuildingsInRadiusMinimal(position, buildingData, radius)
      .then((result) => {
        const buildingIds = result.buildingIds as string[];

        const buildings: Building[] = [];
        for (const id of buildingIds) {
          const b = buildingMap.get(id);
          if (b) buildings.push(b);
        }

        this.buildingCache.set(cacheKey, buildings);
        this.lastCacheTime = currentTime;

        return buildings;
      })
      .catch(() => {
        // Skip on failed updates - no fallback
        return [];
      });
  }

  // Simple synchronous fallback for when worker fails
  private getBuildingsInRadiusSync(position: Vector3, radius: number): Building[] {
    const buildings: Building[] = [];

    this.chunks.forEach((chunk) => {
      if (chunk) {
        chunk.buildings.forEach((building) => {
          const distance = Vector3.Distance(position, building.getPosition());
          if (distance <= radius) {
            buildings.push(building);
          }
        });
      }
    });

    return buildings;
  }

  public getTerrainChunkAtPosition(position: Vector3): TerrainChunk | undefined {
    const chunkX = Math.floor(position.x / this.chunkSize);
    const chunkZ = Math.floor(position.z / this.chunkSize);
    const chunkKey = `${chunkX}_${chunkZ}`;
    return this.chunks.get(chunkKey) ?? undefined;
  }

  public updateDefenseLaunchers(
    bomberPosition: Vector3,
    bomberVelocity: Vector3,
    currentTime: number,
    deltaTime: number,
  ): void {
    const maxRange = 400;

    // Use promise-based callbacks instead of async/await
    this.getBuildingsInRadius(bomberPosition, maxRange)
      .then((buildings) => {
        buildings.forEach((building) => {
          if (building.isDefenseLauncher()) {
            building.updateDefenseLauncher(bomberPosition, bomberVelocity, currentTime, deltaTime);
          }
        });
      })
      .catch(() => {
        // Skip on failed updates - no fallback
        return;
      });
  }

  public setBomber(bomber: any): void {
    this.bomber = bomber;
  }

  public setGame(game: Game): void {
    this.game = game;

    // Set Game reference on all existing buildings
    this.chunks.forEach((chunk) => {
      if (chunk) {
        chunk.buildings.forEach((building) => {
          building.setGame(game);
        });
      }
    });
  }

  private isSafeForWorkerCalls(): boolean {
    return !this.isDisposing && this.bomber && !this.bomber.isBomberDestroyed();
  }

  public dispose(): void {
    try {
      // Set disposing flag to prevent worker calls
      this.isDisposing = true;

      // Clear processing queues
      this.pendingChunkProcessing.length = 0;
      this.isProcessingChunk = false;

      // Clear active worker calls
      this.activeWorkerCalls.clear();

      // Dispose of all chunks and their buildings
      this.chunks.forEach((chunk) => {
        if (chunk) {
          chunk.buildings.forEach((building) => building.dispose());
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
