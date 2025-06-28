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
    private particlePhysicsWorker!: Worker;
    
    private messageCallbacks: Map<string, (result: any) => void> = new Map();
    private messageIdCounter: number = 0;

    constructor() {
        this.initializeWorkers();
    }

    private initializeWorkers(): void {
        // Initialize terrain worker
        this.terrainWorker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
        this.setupWorkerListener(this.terrainWorker, 'terrainWorker');

        // Initialize missile physics worker
        this.missilePhysicsWorker = new Worker(new URL('./missile-physics.worker.ts', import.meta.url), { type: 'module' });
        this.setupWorkerListener(this.missilePhysicsWorker, 'missilePhysicsWorker');

        // Initialize collision detection worker
        this.collisionDetectionWorker = new Worker(new URL('./collision-detection.worker.ts', import.meta.url), { type: 'module' });
        this.setupWorkerListener(this.collisionDetectionWorker, 'collisionDetectionWorker');

        // Initialize particle physics worker
        this.particlePhysicsWorker = new Worker(new URL('./particle-physics.worker.ts', import.meta.url), { type: 'module' });
        this.setupWorkerListener(this.particlePhysicsWorker, 'particlePhysicsWorker');
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
            
            // Handle specific message types
            this.handleWorkerMessage(type, data, workerName);
        };

        worker.onerror = (error) => {
            // Silent error handling - no console logging
        };
    }

    private handleWorkerMessage(type: string, data: any, workerName: string): void {
        switch (type) {
            case 'TERRAIN_CHUNK_READY':
                // Handle terrain chunk completion
                break;
            case 'MISSILE_PHYSICS_RESULT':
                // Handle missile physics update
                break;
            case 'COLLISION_RESULT':
                // Handle collision detection result
                break;
            case 'PARTICLE_PHYSICS_RESULT':
                // Handle particle physics update
                break;
            default:
                // Silent handling of unknown message types
                break;
        }
    }

    // Terrain worker methods
    public generateTerrainChunk(chunkX: number, chunkZ: number, chunkSize: number, subdivisions: number): Promise<any> {
        return this.sendMessageToWorker(this.terrainWorker, {
            chunkX,
            chunkZ,
            chunkSize,
            subdivisions
        });
    }

    // Missile physics worker methods
    public updateMissilePhysics(missileData: any): Promise<any> {
        return this.sendMessageToWorker(this.missilePhysicsWorker, {
            type: 'UPDATE_MISSILE_PHYSICS',
            data: missileData
        });
    }

    public batchUpdateMissiles(missilesData: any[]): Promise<any> {
        return this.sendMessageToWorker(this.missilePhysicsWorker, {
            type: 'BATCH_UPDATE_MISSILES',
            data: { missiles: missilesData }
        });
    }

    // Collision detection worker methods
    public detectCollisions(collisionData: any): Promise<any> {
        return this.sendMessageToWorker(this.collisionDetectionWorker, {
            type: 'DETECT_COLLISIONS',
            data: collisionData
        });
    }

    public getBuildingsInRadius(bomberPosition: Vector3, buildings: any[], radius: number): Promise<any> {
        return this.sendMessageToWorker(this.collisionDetectionWorker, {
            type: 'GET_BUILDINGS_IN_RADIUS',
            data: {
                bomberPosition: { x: bomberPosition.x, y: bomberPosition.y, z: bomberPosition.z },
                buildings,
                radius
            }
        });
    }

    // Particle physics worker methods
    public updateParticleSystem(particleSystemData: any): Promise<any> {
        return this.sendMessageToWorker(this.particlePhysicsWorker, {
            type: 'UPDATE_PARTICLE_SYSTEM',
            data: particleSystemData
        });
    }

    public batchUpdateParticleSystems(particleSystemsData: any[]): Promise<any> {
        return this.sendMessageToWorker(this.particlePhysicsWorker, {
            type: 'BATCH_UPDATE_PARTICLE_SYSTEMS',
            data: { systems: particleSystemsData }
        });
    }

    public generateParticles(particleSystemData: any, deltaTime: number): Promise<any> {
        return this.sendMessageToWorker(this.particlePhysicsWorker, {
            type: 'GENERATE_PARTICLES',
            data: { system: particleSystemData, deltaTime }
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
                    reject(new Error(`Worker response timeout`));
                }
            }, 2000); // 2 second timeout
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
        this.particlePhysicsWorker.terminate();
        
        this.messageCallbacks.clear();
    }
} 