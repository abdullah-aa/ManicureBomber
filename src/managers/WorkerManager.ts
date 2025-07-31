import { Vector3 } from '@babylonjs/core';


export class WorkerManager {
  private terrainWorker!: Worker;
  private missilePhysicsWorker!: Worker;
  private collisionDetectionWorker!: Worker;

  private messageCallbacks: Map<string, (result: any) => void> = new Map();
  private messageIdCounter: number = 0;

  private WORKER_TIMEOUT = 10000; // 5 second timeout

  constructor() {
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    // Initialize terrain worker
    this.terrainWorker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
    this.setupWorkerListener(this.terrainWorker);

    // Initialize missile physics worker
    this.missilePhysicsWorker = new Worker(new URL('../workers/missile-physics.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.setupWorkerListener(this.missilePhysicsWorker);

    // Initialize collision detection worker
    this.collisionDetectionWorker = new Worker(new URL('../workers/collision-detection.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.setupWorkerListener(this.collisionDetectionWorker);

  }

  private setupWorkerListener(worker: Worker): void {
    worker.onmessage = (event) => {
      const { data, messageId } = event.data;

      // Handle callback if messageId exists
      if (messageId && this.messageCallbacks.has(messageId)) {
        const callback = this.messageCallbacks.get(messageId)!;
        callback(data);
        this.messageCallbacks.delete(messageId);
      }
    };

    worker.onerror = () => {
      // Silent error handling - no console logging
    };
  }

  // Terrain worker methods
  public generateTerrainChunk(chunkX: number, chunkZ: number, chunkSize: number, subdivisions: number): Promise<any> {
    return this.sendMessageToWorker(this.terrainWorker, {
      type: 'GENERATE_TERRAIN_CHUNK',
      data: {
        chunkX,
        chunkZ,
        chunkSize,
        subdivisions,
      },
    });
  }

  public getDistanceToNearestChunkEdge(position: Vector3, chunkSize: number): Promise<any> {
    return this.sendMessageToWorker(this.terrainWorker, {
      type: 'GET_DISTANCE_TO_CHUNK_EDGE',
      data: {
        position: { x: position.x, z: position.z },
        chunkSize,
      },
    });
  }

  public generateChunksNearPlayer(
    currentChunkX: number,
    currentChunkZ: number,
    bomberPosition: Vector3,
    existingChunks: string[],
    maxTotalChunks: number,
    maxChunksPerUpdate: number
  ): Promise<any> {
    return this.sendMessageToWorker(this.terrainWorker, {
      type: 'GENERATE_CHUNKS_NEAR_PLAYER',
      data: {
        currentChunkX,
        currentChunkZ,
        bomberPosition: { x: bomberPosition.x, z: bomberPosition.z },
        existingChunks,
        maxTotalChunks,
        maxChunksPerUpdate,
      },
    });
  }

  public getChunksToRemove(currentChunkX: number, currentChunkZ: number, existingChunks: string[], maxDistance: number): Promise<any> {
    return this.sendMessageToWorker(this.terrainWorker, {
      type: 'GET_CHUNKS_TO_REMOVE',
      data: {
        currentChunkX,
        currentChunkZ,
        existingChunks,
        maxDistance,
      },
    });
  }

  public getBuildingsInRadiusMinimal(position: Vector3, buildings: any[], radius: number): Promise<any> {
    return this.sendMessageToWorker(this.terrainWorker, {
      type: 'GET_BUILDINGS_IN_RADIUS_MINIMAL',
      data: {
        position: { x: position.x, y: position.y, z: position.z },
        buildings,
        radius,
      },
    });
  }

  // Missile physics worker methods
  public updateMissilePhysics(missileData: any): Promise<any> {
    return this.sendMessageToWorker(this.missilePhysicsWorker, {
      type: 'UPDATE_MISSILE_PHYSICS',
      data: missileData,
    });
  }

  public checkIskanderCollisions(iskanderMissiles: any[], bomberData: any): Promise<any> {
    return this.sendMessageToWorker(this.collisionDetectionWorker, {
      type: 'CHECK_ISKANDER_COLLISIONS',
      data: {
        iskanderMissiles: iskanderMissiles.map((missile, index) => {
          const position = missile.getPosition();
          return {
            id: `iskander_${index}`,
            position: { x: position.x, y: position.y, z: position.z },
            isLaunched: missile.isLaunched(),
            hasExploded: missile.hasExploded(),
          };
        }),
        bomberData: {
          position: { x: bomberData.position.x, y: bomberData.position.y, z: bomberData.position.z },
          isDestroyed: bomberData.isDestroyed,
        },
      },
    });
  }

  public checkDefenseCollisions(defenseMissiles: any[], bomberData: any): Promise<any> {
    return this.sendMessageToWorker(this.collisionDetectionWorker, {
      type: 'CHECK_DEFENSE_COLLISIONS',
      data: {
        defenseMissiles: defenseMissiles.map((missile, index) => {
          const position = missile.getPosition();
          return {
            id: `defense_${index}`,
            position: { x: position.x, y: position.y, z: position.z },
            isLaunched: missile.isLaunched(),
            hasExploded: missile.hasExploded(),
            buildingId: `building_${index}`,
          };
        }),
        bomberData: {
          position: { x: bomberData.position.x, y: bomberData.position.y, z: bomberData.position.z },
          isDestroyed: bomberData.isDestroyed,
        },
      },
    });
  }

  public generateTomahawkPath(pathData: any): Promise<any> {
    return this.sendMessageToWorker(this.missilePhysicsWorker, {
      type: 'GENERATE_TOMAHAWK_PATH',
      data: pathData,
    });
  }


  // Generic message sending with promise-based approach
  private sendMessageToWorker(worker: Worker, message: any): Promise<any> {
    const messageId = `msg_${this.messageIdCounter++}`;
    const messageWithId = { ...message, messageId };

    // Create a promise that resolves when we get a response
    const responsePromise = new Promise<any>((resolve) => {
      // Store callback for response
      this.messageCallbacks.set(messageId, resolve);

      // Send message to worker
      worker.postMessage(messageWithId);
    });

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        if (this.messageCallbacks.has(messageId)) {
          this.messageCallbacks.delete(messageId);
          reject(new Error('Worker response timeout'));
        }
      }, this.WORKER_TIMEOUT);
    });

    // Race between response and timeout
    return Promise.race([responsePromise, timeoutPromise]);
  }
}
