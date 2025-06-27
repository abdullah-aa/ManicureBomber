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
    
    // Performance monitoring
    private workerStats: {
        terrainWorker: { messagesSent: number; messagesReceived: number; totalTime: number };
        missilePhysicsWorker: { messagesSent: number; messagesReceived: number; totalTime: number };
        collisionDetectionWorker: { messagesSent: number; messagesReceived: number; totalTime: number };
        particlePhysicsWorker: { messagesSent: number; messagesReceived: number; totalTime: number };
    } = {
        terrainWorker: { messagesSent: 0, messagesReceived: 0, totalTime: 0 },
        missilePhysicsWorker: { messagesSent: 0, messagesReceived: 0, totalTime: 0 },
        collisionDetectionWorker: { messagesSent: 0, messagesReceived: 0, totalTime: 0 },
        particlePhysicsWorker: { messagesSent: 0, messagesReceived: 0, totalTime: 0 }
    };

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

    private setupWorkerListener(worker: Worker, workerName: keyof typeof this.workerStats): void {
        worker.onmessage = (event) => {
            const startTime = performance.now();
            const { type, data, messageId } = event.data;
            
            this.workerStats[workerName].messagesReceived++;
            
            // Handle callback if messageId exists
            if (messageId && this.messageCallbacks.has(messageId)) {
                const callback = this.messageCallbacks.get(messageId)!;
                callback(data);
                this.messageCallbacks.delete(messageId);
            }
            
            // Handle specific message types
            this.handleWorkerMessage(type, data, workerName);
            
            const endTime = performance.now();
            this.workerStats[workerName].totalTime += endTime - startTime;
        };

        worker.onerror = (error) => {
            console.error(`Error in ${workerName}:`, error);
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
                console.warn(`Unknown message type from ${workerName}:`, type);
        }
    }

    // Terrain worker methods
    public generateTerrainChunk(chunkX: number, chunkZ: number, chunkSize: number, subdivisions: number): Promise<any> {
        return this.sendMessageToWorker(this.terrainWorker, 'terrainWorker', {
            chunkX,
            chunkZ,
            chunkSize,
            subdivisions
        });
    }

    // Missile physics worker methods
    public updateMissilePhysics(missileData: any): Promise<any> {
        return this.sendMessageToWorker(this.missilePhysicsWorker, 'missilePhysicsWorker', {
            type: 'UPDATE_MISSILE_PHYSICS',
            data: missileData
        });
    }

    public batchUpdateMissiles(missilesData: any[]): Promise<any> {
        return this.sendMessageToWorker(this.missilePhysicsWorker, 'missilePhysicsWorker', {
            type: 'BATCH_UPDATE_MISSILES',
            data: { missiles: missilesData }
        });
    }

    // Collision detection worker methods
    public detectCollisions(collisionData: any): Promise<any> {
        return this.sendMessageToWorker(this.collisionDetectionWorker, 'collisionDetectionWorker', {
            type: 'DETECT_COLLISIONS',
            data: collisionData
        });
    }

    public getBuildingsInRadius(bomberPosition: Vector3, buildings: any[], radius: number): Promise<any> {
        return this.sendMessageToWorker(this.collisionDetectionWorker, 'collisionDetectionWorker', {
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
        return this.sendMessageToWorker(this.particlePhysicsWorker, 'particlePhysicsWorker', {
            type: 'UPDATE_PARTICLE_SYSTEM',
            data: particleSystemData
        });
    }

    public batchUpdateParticleSystems(particleSystemsData: any[]): Promise<any> {
        return this.sendMessageToWorker(this.particlePhysicsWorker, 'particlePhysicsWorker', {
            type: 'BATCH_UPDATE_PARTICLE_SYSTEMS',
            data: { systems: particleSystemsData }
        });
    }

    public generateParticles(particleSystemData: any, deltaTime: number): Promise<any> {
        return this.sendMessageToWorker(this.particlePhysicsWorker, 'particlePhysicsWorker', {
            type: 'GENERATE_PARTICLES',
            data: { system: particleSystemData, deltaTime }
        });
    }

    // Generic message sending with promise-based response
    private sendMessageToWorker(worker: Worker, workerName: keyof typeof this.workerStats, message: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const messageId = `msg_${this.messageIdCounter++}`;
            const messageWithId = { ...message, messageId };
            
            // Store callback for response
            this.messageCallbacks.set(messageId, resolve);
            
            // Send message to worker
            worker.postMessage(messageWithId);
            this.workerStats[workerName].messagesSent++;
            
            // Set timeout for response
            setTimeout(() => {
                if (this.messageCallbacks.has(messageId)) {
                    this.messageCallbacks.delete(messageId);
                    reject(new Error(`Worker ${workerName} response timeout`));
                }
            }, 5000); // 5 second timeout
        });
    }

    // Performance monitoring methods
    public getWorkerStats(): typeof this.workerStats {
        return { ...this.workerStats };
    }

    public resetWorkerStats(): void {
        Object.keys(this.workerStats).forEach(key => {
            const workerKey = key as keyof typeof this.workerStats;
            this.workerStats[workerKey] = { messagesSent: 0, messagesReceived: 0, totalTime: 0 };
        });
    }

    public logWorkerPerformance(): void {
        console.log('Worker Performance Stats:');
        Object.entries(this.workerStats).forEach(([workerName, stats]) => {
            const avgTime = stats.messagesReceived > 0 ? stats.totalTime / stats.messagesReceived : 0;
            console.log(`${workerName}:`, {
                messagesSent: stats.messagesSent,
                messagesReceived: stats.messagesReceived,
                totalTime: `${stats.totalTime.toFixed(2)}ms`,
                avgTime: `${avgTime.toFixed(2)}ms`
            });
        });
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