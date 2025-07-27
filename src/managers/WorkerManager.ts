import { Vector3 } from '@babylonjs/core';

interface WorkerMessage {
  type: string;
  data: any;
}

interface WorkerResult {
  type: string;
  data: any;
}

export class WorkerManager {
  private terrainWorker!: Worker;
  private missilePhysicsWorker!: Worker;
  private collisionDetectionWorker!: Worker;

  private messageCallbacks: Map<string, (result: any) => void> = new Map();
  private messageIdCounter: number = 0;

  private WORKER_TIMEOUT = 5000; // 5 second timeout

  constructor() {
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    // Initialize terrain worker
    this.terrainWorker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
    this.setupWorkerListener(this.terrainWorker, 'terrainWorker');

    // Initialize missile physics worker
    this.missilePhysicsWorker = new Worker(new URL('../workers/missile-physics.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.setupWorkerListener(this.missilePhysicsWorker, 'missilePhysicsWorker');

    // Initialize collision detection worker
    this.collisionDetectionWorker = new Worker(new URL('../workers/collision-detection.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.setupWorkerListener(this.collisionDetectionWorker, 'collisionDetectionWorker');

  }

  private setupWorkerListener(worker: Worker, workerName: string): void {
    worker.onmessage = (event) => {
      const { type, data, messageId } = event.data;

      // Handle callback if messageId exists
      if (messageId && this.messageCallbacks.has(messageId)) {
        const callback = this.messageCallbacks.get(messageId)!;
        callback(data);
        this.messageCallbacks.delete(messageId);
      }
    };

    worker.onerror = (error) => {
      // Silent error handling - no console logging
    };
  }

  // Terrain worker methods
  public generateTerrainChunk(chunkX: number, chunkZ: number, chunkSize: number, subdivisions: number): Promise<any> {
    return this.sendMessageToWorker(this.terrainWorker, {
      chunkX,
      chunkZ,
      chunkSize,
      subdivisions,
    });
  }

  // Missile physics worker methods
  public updateMissilePhysics(missileData: any): Promise<any> {
    return this.sendMessageToWorker(this.missilePhysicsWorker, {
      type: 'UPDATE_MISSILE_PHYSICS',
      data: missileData,
    });
  }

  public batchUpdateMissiles(missilesData: any[]): Promise<any> {
    return this.sendMessageToWorker(this.missilePhysicsWorker, {
      type: 'BATCH_UPDATE_MISSILES',
      data: { missiles: missilesData },
    });
  }

  // Collision detection worker methods
  public detectCollisions(collisionData: any): Promise<any> {
    return this.sendMessageToWorker(this.collisionDetectionWorker, {
      type: 'DETECT_COLLISIONS',
      data: collisionData,
    });
  }

  public getBuildingsInRadius(bomberPosition: Vector3, buildings: any[], radius: number): Promise<any> {
    return this.sendMessageToWorker(this.collisionDetectionWorker, {
      type: 'GET_BUILDINGS_IN_RADIUS',
      data: {
        bomberPosition: { x: bomberPosition.x, y: bomberPosition.y, z: bomberPosition.z },
        buildings,
        radius,
      },
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


  // Generic message sending with async/await and timeout
  private async sendMessageToWorker(worker: Worker, message: any): Promise<any> {
    const messageId = `msg_${this.messageIdCounter++}`;
    const messageWithId = { ...message, messageId };

    // Create a promise that resolves when we get a response
    const responsePromise = new Promise<any>((resolve, reject) => {
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

    try {
      // Race between response and timeout
      const result = await Promise.race([responsePromise, timeoutPromise]);
      return result;
    } catch (error) {
      // Clean up callback if it still exists
      this.messageCallbacks.delete(messageId);
      throw error;
    }
  }

  // Cleanup method
  public dispose(): void {
    this.terrainWorker.terminate();
    this.missilePhysicsWorker.terminate();
    this.collisionDetectionWorker.terminate();

    this.messageCallbacks.clear();
  }
}
