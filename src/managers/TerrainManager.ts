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
import { Cloud, CLOUD_BAND_MIN_Y, CLOUD_BAND_MAX_Y } from '../entities/Cloud';
import { WorkerManager } from './WorkerManager';
import { Game } from './Game';

interface TerrainChunk {
  mesh: GroundMesh;
  buildings: Building[];
  clouds: Cloud[];
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
  private subdivisions = 48;
  private bomber: any = null;

  private workerManager: WorkerManager;

  private isDisposing: boolean = false;

  // Clouds whose home chunk unloaded while they were (possibly) still in view —
  // they shrink out over CLOUD_FADE_SECONDS instead of popping, then dispose.
  private dyingClouds: Cloud[] = [];
  private readonly createdAt: number = performance.now();

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

  /**
   * Rendered-terrain surface height at world (x, z); 0 when the chunk isn't
   * loaded. Reads the chunk's GroundMesh directly (getHeightAtCoordinates), so it
   * always matches what's drawn regardless of how the heightmap was copied in.
   */
  public getTerrainHeightAt(x: number, z: number): number {
    const chunkX = Math.round(x / this.chunkSize);
    const chunkZ = Math.round(z / this.chunkSize);
    const chunk = this.chunks.get(`${chunkX}_${chunkZ}`);
    if (!chunk) return 0;
    return chunk.mesh.getHeightAtCoordinates(x, z);
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

    // Split mesh creation into smaller operations.
    // updatable is REQUIRED: Babylon's Buffer.update() on a non-updatable buffer is
    // a silent no-op on the GPU — the CPU-side array still reads back the new
    // heights (getVerticesData/getHeightAtCoordinates), so the bug is invisible to
    // any code that asks the mesh, while the screen keeps showing the flat plane.
    const ground = MeshBuilder.CreateGround(
      `ground_${chunkKey}`,
      {
        width: this.chunkSize,
        height: this.chunkSize,
        subdivisions: this.subdivisions,
        updatable: true,
      },
      this.scene,
    );

    ground.position.x = worldX;
    ground.position.y = 0;
    ground.position.z = worldZ;
    ground.material = this.terrainMaterial;
    ground.isPickable = false; // nothing in the game picks terrain (input reads raw pointer coords)
    // Keep the flat placeholder off-screen until the heights are applied.
    ground.setEnabled(false);

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

    const rowLength = this.subdivisions + 1;
    const processBatch = () => {
      const endIndex = Math.min(processedVertices + batchSize, heightmap.length);

      // Update vertex heights for this batch. The worker heightmap's row 0 is the
      // -z edge, but CreateGround's row 0 is the +z edge, so copy rows flipped —
      // the rendered surface then equals the worker's continuous noise field and
      // chunks join seamlessly (a straight copy z-mirrors every chunk and cliffs
      // at the seams).
      for (let i = processedVertices; i < endIndex; i++) {
        const row = Math.floor(i / rowLength);
        const col = i - row * rowLength;
        positions[i * 3 + 1] = heightmap[(this.subdivisions - row) * rowLength + col];
      }

      processedVertices = endIndex;

      if (processedVertices >= heightmap.length) {
        // Finished processing all vertices
        ground.updateVerticesData('position', positions);
        ground.createNormals(false);
        ground.setEnabled(true);

        // The chunk never moves again: freeze its transform, sync its (hill-aware)
        // bounding box to world space once, then opt out of per-frame bounds sync.
        ground.refreshBoundingInfo();
        ground.freezeWorldMatrix();
        ground.getBoundingInfo().update(ground.getWorldMatrix());
        ground.doNotSyncBoundingInfo = true;

        // Prewarm Babylon's lazy _heightQuads: the first getHeightAtCoordinates
        // on a chunk otherwise builds ~2,304 quads mid-combat (missile ground
        // checks); one throwaway read moves that cost into this frame-spread
        // chunk pipeline.
        ground.getHeightAtCoordinates(chunkX * this.chunkSize, chunkZ * this.chunkSize);

        const chunk: TerrainChunk = {
          mesh: ground,
          buildings: [],
          clouds: [],
          x: chunkX,
          z: chunkZ,
        };

        this.chunks.set(chunkKey, chunk);
        this.spawnCloudsForChunk(chunk);

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

        // (No destroyed-callback needed for target acquisition anymore — the
        // bomber's target query is synchronous and always fresh.)
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
    // Static for the scene's lifetime (texture assigned above; lights are a fixed
    // pool and fog is set once at startup, both before first render): freeze so
    // Babylon skips its per-frame material sync. Writes would silently no-op.
    this.terrainMaterial.freeze();
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

    // Chunk meshes are CENTERED on chunkX * chunkSize, so the containing chunk
    // is round(), not floor() — same convention as getTerrainHeightAt.
    const chunkX = Math.round(center.x / this.chunkSize);
    const chunkZ = Math.round(center.z / this.chunkSize);

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
    // round(), not floor(): chunks are center-anchored, and a floor()-centered
    // keep-set lags the true containing chunk by up to half a chunk — enough to
    // pull the nearest unloaded edge inside fogEnd (see keepRadius invariant).
    const currentChunkX = Math.round(bomberPosition.x / this.chunkSize);
    const currentChunkZ = Math.round(bomberPosition.z / this.chunkSize);

    // Cadence is owned by the game loop (terrainUpdateInterval); no internal throttle here.
    this.lastTerrainUpdateTime = performance.now();

    // Check if we're in a safe state for worker calls
    if (!this.isSafeForWorkerCalls()) {
      // Don't generate new terrain when not safe.
      return;
    }

    // Generate whenever the keep-set may have holes: either we're near a chunk edge, or we
    // simply have room for more chunks. These streaming decisions are a handful of arithmetic
    // ops, so they run inline — only heightmap generation is worth a worker round trip.
    if (this.chunks.size < this.maxTotalChunks || this.distanceToNearestChunkEdge(bomberPosition) < this.generationThreshold) {
      this.generateMissingKeepSetChunks(currentChunkX, currentChunkZ);
    }

    // Remove anything outside the symmetric keep-set (mirrors generation).
    this.removeChunks(this.chunksOutsideKeepSet(currentChunkX, currentChunkZ));
  }

  private distanceToNearestChunkEdge(position: Vector3): number {
    // Center-anchored chunks: the containing chunk's center is at
    // round(pos / size) * size and its edges at center ± size/2.
    const chunkCenterX = Math.round(position.x / this.chunkSize) * this.chunkSize;
    const chunkCenterZ = Math.round(position.z / this.chunkSize) * this.chunkSize;
    return Math.min(
      this.chunkSize / 2 - Math.abs(position.x - chunkCenterX),
      this.chunkSize / 2 - Math.abs(position.z - chunkCenterZ),
    );
  }

  private computeKeepSet(currentChunkX: number, currentChunkZ: number): Set<string> {
    const keep = new Set<string>();
    for (let dx = -this.keepRadius; dx <= this.keepRadius; dx++) {
      for (let dz = -this.keepRadius; dz <= this.keepRadius; dz++) {
        keep.add(`${currentChunkX + dx}_${currentChunkZ + dz}`);
      }
    }
    return keep;
  }

  private chunksOutsideKeepSet(currentChunkX: number, currentChunkZ: number): string[] {
    const keep = this.computeKeepSet(currentChunkX, currentChunkZ);
    const toRemove: string[] = [];
    this.chunks.forEach((_, chunkKey) => {
      if (!keep.has(chunkKey)) toRemove.push(chunkKey);
    });
    return toRemove;
  }

  /** Queue generation for missing keep-set chunks, nearest-to-the-plane first. */
  private generateMissingKeepSetChunks(currentChunkX: number, currentChunkZ: number): void {
    if (this.chunks.size >= this.maxTotalChunks) return;

    const missing: { chunkX: number; chunkZ: number; distSq: number }[] = [];
    for (let dx = -this.keepRadius; dx <= this.keepRadius; dx++) {
      for (let dz = -this.keepRadius; dz <= this.keepRadius; dz++) {
        const chunkX = currentChunkX + dx;
        const chunkZ = currentChunkZ + dz;
        if (this.chunks.has(`${chunkX}_${chunkZ}`)) continue;
        missing.push({ chunkX, chunkZ, distSq: dx * dx + dz * dz });
      }
    }
    missing.sort((a, b) => a.distSq - b.distSq);

    const budget = Math.min(this.maxChunksPerUpdate, this.maxTotalChunks - this.chunks.size);
    missing.slice(0, budget).forEach(({ chunkX, chunkZ }) => {
      this.generateChunk(chunkX, chunkZ);
    });
  }

  /**
   * Sparse decorative clouds, spawned synchronously with the chunk record (a
   * cloud is ~14 cheap instances, no frame-spreading or orphan guard needed).
   * The initial keep-set seed spawns fully grown so mission start isn't one
   * synchronized mass grow-in; streamed chunks grow in beyond the fog anyway.
   */
  private spawnCloudsForChunk(chunk: TerrainChunk): void {
    const count = Math.random() < 0.55 ? (Math.random() < 0.25 ? 2 : 1) : 0;
    const fullGrown = performance.now() - this.createdAt < 8000;
    for (let i = 0; i < count; i++) {
      const position = new Vector3(
        (chunk.x + Math.random() - 0.5) * this.chunkSize,
        CLOUD_BAND_MIN_Y + Math.random() * (CLOUD_BAND_MAX_Y - CLOUD_BAND_MIN_Y),
        (chunk.z + Math.random() - 0.5) * this.chunkSize,
      );
      chunk.clouds.push(new Cloud(this.scene, position, fullGrown ? 1 : 0));
    }
  }

  /** Per-frame cloud drift/fade — called every frame by Game, unlike the 10Hz streaming update. */
  public updateClouds(deltaTime: number): void {
    if (this.isDisposing) return;
    this.chunks.forEach((chunk) => {
      if (chunk) {
        for (const cloud of chunk.clouds) {
          cloud.update(deltaTime);
        }
      }
    });
    for (let i = this.dyingClouds.length - 1; i >= 0; i--) {
      this.dyingClouds[i].update(deltaTime);
      if (this.dyingClouds[i].isDisposed()) {
        this.dyingClouds.splice(i, 1);
      }
    }
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

        // A cloud may have drifted into view even though its home chunk is far
        // behind — fade it out via the dying list instead of popping it.
        for (const cloud of chunk.clouds) {
          cloud.beginFadeOut();
          this.dyingClouds.push(cloud);
        }
        chunk.clouds.length = 0;

        chunk.mesh.dispose();
        this.chunks.delete(key);
        chunksProcessed++;
      }
    });
  }

  /**
   * Synchronous spatial query: chunks are the spatial index. Only the 1-9 chunks
   * overlapping the radius are visited, and Building.isWithinRadius avoids sqrt.
   * At the game's worst case (~9 chunks × ~26 buildings) this is a few hundred
   * squared-distance checks — far cheaper than the old serialize-everything
   * worker round trip it replaces, and always fresh so no cache is needed.
   */
  public getBuildingsInRadiusSync(position: Vector3, radius: number): Building[] {
    const minChunkX = Math.floor((position.x - radius) / this.chunkSize + 0.5);
    const maxChunkX = Math.floor((position.x + radius) / this.chunkSize + 0.5);
    const minChunkZ = Math.floor((position.z - radius) / this.chunkSize + 0.5);
    const maxChunkZ = Math.floor((position.z + radius) / this.chunkSize + 0.5);

    const result: Building[] = [];
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
      for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
        const chunk = this.chunks.get(`${chunkX}_${chunkZ}`);
        if (!chunk) continue;
        for (const building of chunk.buildings) {
          if (building.isWithinRadius(position, radius)) {
            result.push(building);
          }
        }
      }
    }
    return result;
  }

  public updateDefenseLaunchers(
    bomberPosition: Vector3,
    bomberVelocity: Vector3,
    currentTime: number,
    deltaTime: number,
  ): void {
    const maxRange = 400;

    const buildings = this.getBuildingsInRadiusSync(bomberPosition, maxRange);
    for (const building of buildings) {
      if (building.isDefenseLauncher()) {
        building.updateDefenseLauncher(bomberPosition, bomberVelocity, currentTime, deltaTime);
      }
    }
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
          chunk.clouds.forEach((cloud) => cloud.dispose());
          chunk.clouds.length = 0;
          chunk.mesh.dispose();
        }
      });
      this.dyingClouds.forEach((cloud) => cloud.dispose());
      this.dyingClouds.length = 0;

      // Clear all maps
      this.chunks.clear();

      // Dispose of terrain material
      if (this.terrainMaterial) {
        this.terrainMaterial.dispose();
      }
    } catch {
      // Silent error handling - no console logging
    }
  }
}
