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
  private chunkSize: number = 900;
  private generationThreshold: number = 300; // < chunkSize/2 (450) so it fires near an edge, not always
  // Symmetric, heading-independent Chebyshev keep-set of radius keepRadius (see terrain.worker
  // computeKeepSet): (2R+1)^2 chunks loaded around the plane. Sized so the nearest loaded edge is
  // always beyond fogEnd (keepRadius*chunkSize - 300 >= fogEnd), so no edge is ever visible.
  // R=2, S=900 -> 2*900-300 = 1500 >= fogEnd 1500. Few, large, low-poly chunks keep mobile fast.
  private keepRadius: number = 2;
  private maxTotalChunks: number = 30; // (2*2+1)^2 = 25 footprint + slack
  private maxChunksPerUpdate: number = 6;
  private terrainMaterial!: StandardMaterial;
  private lastTerrainUpdateTime: number = 0;
  private heightmapCache: Map<string, Float32Array> = new Map();
  private subdivisions = 48;
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
      .catch(() => {
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
      } catch {
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
    const chunkKey = `${chunk.x}_${chunk.z}`;
    const maxBuildingsPerFrame = 3; // Limit buildings per frame
    let processedBuildings = 0;

    const processBuildingBatch = () => {
      // If the chunk was removed or replaced while we spread building creation across
      // frames, stop — otherwise these buildings are orphaned (never disposed) and pile
      // up on revisit. (this.chunks.get returns undefined after removal, or a different
      // chunk object after regeneration.)
      if (this.isDisposing || this.chunks.get(chunkKey) !== chunk) {
        chunk.buildings.forEach((building) => building.dispose());
        chunk.buildings.length = 0;
        return;
      }

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

    // Linear distance fog fades distant terrain into the sky, hiding the edge of the
    // (small) loaded world and cutting fill-rate. fogColor MUST match clearColor RGB so
    // the horizon dissolves seamlessly, and fogEnd must stay below camera.maxZ (1800).
    this.scene.fogMode = Scene.FOGMODE_LINEAR;
    this.scene.fogColor = new Color3(0.5, 0.7, 0.9);
    this.scene.fogStart = 900;
    this.scene.fogEnd = 1500;
  }

  public generateInitialTerrain(center: Vector3): Promise<void> {
    if (!this.isSafeForWorkerCalls()) {
      return Promise.resolve();
    }

    const chunkX = Math.floor(center.x / this.chunkSize);
    const chunkZ = Math.floor(center.z / this.chunkSize);

    // Seed the full keep-radius disk so the very first frame is already blank-free out to fogEnd.
    const chunkPromises: Promise<void>[] = [];
    for (let x = chunkX - this.keepRadius; x <= chunkX + this.keepRadius; x++) {
      for (let z = chunkZ - this.keepRadius; z <= chunkZ + this.keepRadius; z++) {
        chunkPromises.push(this.generateChunk(x, z));
      }
    }

    return Promise.all(chunkPromises).then(() => {});
  }

  public update(bomberPosition: Vector3): void {
    const currentChunkX = Math.floor(bomberPosition.x / this.chunkSize);
    const currentChunkZ = Math.floor(bomberPosition.z / this.chunkSize);

    // Cadence is owned by the game loop (terrainUpdateInterval); no internal throttle here.
    this.lastTerrainUpdateTime = performance.now();

    // Check if we're in a safe state for worker calls
    if (!this.isSafeForWorkerCalls()) {
      // Don't generate new terrain when not safe.
      return;
    }

    // Generate whenever the keep-set may have holes: either we're near a chunk edge, or we simply
    // have room for more chunks (the worker returns [] when nothing's needed).
    if (this.chunks.size < this.maxTotalChunks) {
      this.generateChunksNearPlayerAsync(currentChunkX, currentChunkZ);
    } else {
      this.workerManager
        .getDistanceToNearestChunkEdge(bomberPosition, this.chunkSize)
        .then((result: { distance: number }) => {
          if (result.distance < this.generationThreshold) {
            this.generateChunksNearPlayerAsync(currentChunkX, currentChunkZ);
          }
        })
        .catch(() => {
          // Skip on failed updates - no fallback
          return;
        });
    }

    // Use worker to determine which chunks to remove (symmetric keep-set, mirrors generation).
    this.workerManager
      .getChunksToRemove(currentChunkX, currentChunkZ, Array.from(this.chunks.keys()), this.keepRadius)
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
    // Match the generation rate so retired (off-screen) chunks free their slots fast enough not to
    // pin chunks.size at the cap and starve generation when a new edge row enters at a crossing.
    const maxChunksToProcessPerFrame = 6;

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

  private generateChunksNearPlayerAsync(currentChunkX: number, currentChunkZ: number): void {
    // Don't generate chunks if not safe for worker calls
    if (!this.isSafeForWorkerCalls()) {
      return;
    }

    if (this.chunks.size >= this.maxTotalChunks) {
      return;
    }

    const existingChunks = Array.from(this.chunks.keys());

    // Use promise-based callbacks instead of async/await
    this.workerManager
      .generateChunksNearPlayer(
        currentChunkX,
        currentChunkZ,
        existingChunks,
        this.maxTotalChunks,
        this.maxChunksPerUpdate,
        this.keepRadius,
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

  public getBuildingsInRadius(position: Vector3, radius: number): Promise<Building[]> {
    const cacheKey = `${Math.floor(position.x / 50)}_${Math.floor(position.z / 50)}_${radius}`;
    const currentTime = performance.now();

    if (this.buildingCache.has(cacheKey) && currentTime - this.lastCacheTime < this.cacheTimeout) {
      // Use optimized radius check (avoids sqrt by using squared distance)
      return Promise.resolve(
        this.buildingCache.get(cacheKey)!.filter((building) => building.isWithinRadius(position, radius)),
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
    } catch {
      // Silent error handling - no console logging
    }
  }
}
