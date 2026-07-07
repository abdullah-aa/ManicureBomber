import {
  TerrainWorkerRequest,
  MissilePhysicsWorkerRequest,
  TerrainChunkResult,
  DefenseTrajectoryRequest,
  DefenseTrajectoryResult,
  TomahawkPathRequest,
  TomahawkPathResult,
} from '../workers/worker-utils';

export class WorkerManager {
  private terrainWorker!: Worker;
  private missilePhysicsWorker!: Worker;

  private messageCallbacks: Map<string, { resolve: (result: unknown) => void; timeoutId: ReturnType<typeof setTimeout> }> =
    new Map();
  private messageIdCounter: number = 0;

  private WORKER_TIMEOUT = 10000;

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
  }

  private setupWorkerListener(worker: Worker): void {
    worker.onmessage = (event) => {
      const { data, messageId } = event.data;

      // Handle callback if messageId exists
      if (messageId && this.messageCallbacks.has(messageId)) {
        const entry = this.messageCallbacks.get(messageId)!;
        clearTimeout(entry.timeoutId);
        this.messageCallbacks.delete(messageId);
        entry.resolve(data);
      }
    };

    worker.onerror = () => {
      // Silent error handling - no console logging
    };
  }

  // Terrain worker methods
  public generateTerrainChunk(
    chunkX: number,
    chunkZ: number,
    chunkSize: number,
    subdivisions: number,
    seed: number,
  ): Promise<TerrainChunkResult> {
    return this.sendMessageToWorker<TerrainChunkResult>(this.terrainWorker, {
      type: 'GENERATE_TERRAIN_CHUNK',
      data: { chunkX, chunkZ, chunkSize, subdivisions, seed },
    });
  }

  // Missile physics worker methods
  public calculateDefenseTrajectory(missileData: DefenseTrajectoryRequest): Promise<DefenseTrajectoryResult> {
    return this.sendMessageToWorker<DefenseTrajectoryResult>(this.missilePhysicsWorker, {
      type: 'CALCULATE_DEFENSE_TRAJECTORY',
      data: missileData,
    });
  }

  public generateTomahawkPath(pathData: TomahawkPathRequest): Promise<TomahawkPathResult> {
    return this.sendMessageToWorker<TomahawkPathResult>(this.missilePhysicsWorker, {
      type: 'GENERATE_TOMAHAWK_PATH',
      data: pathData,
    });
  }

  // Generic message sending with promise-based approach. One promise per message;
  // the timeout is cleared as soon as the response arrives so no timers accumulate.
  // The request union types above keep every payload compiler-checked; the result
  // type is asserted per call site (the worker's reply shape is part of the same
  // protocol contract in worker-utils).
  private sendMessageToWorker<TResult>(
    worker: Worker,
    message: TerrainWorkerRequest | MissilePhysicsWorkerRequest,
  ): Promise<TResult> {
    const messageId = `msg_${this.messageIdCounter++}`;
    const messageWithId = { ...message, messageId };

    return new Promise<TResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.messageCallbacks.has(messageId)) {
          this.messageCallbacks.delete(messageId);
          reject(new Error('Worker response timeout'));
        }
      }, this.WORKER_TIMEOUT);

      this.messageCallbacks.set(messageId, { resolve: resolve as (result: unknown) => void, timeoutId });
      worker.postMessage(messageWithId);
    });
  }
}
