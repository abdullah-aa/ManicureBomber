import {
  Scene,
  Mesh,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  ParticleSystem,
  Texture,
  Color4,
  PointLight,
  TransformNode,
  DynamicTexture,
} from '@babylonjs/core';
import { WorkerManager } from '../managers/WorkerManager';

export class DefenseMissile {
  private scene: Scene;
  private workerManager: WorkerManager;
  private missileGroup: TransformNode;
  private fuselage!: Mesh;
  private position: Vector3;
  private velocity: Vector3;
  private targetPosition: Vector3;
  private speed: number = 80; // Slower than Tomahawk
  private launched: boolean = false;
  private exploded: boolean = false;
  private exhaustParticles!: ParticleSystem;
  private light!: PointLight;
  private lifeTime: number = 0;
  private maxLifeTime: number = 10; // Missiles self-destruct after 10 seconds
  private targetSet: boolean = false; // Performance optimization flag
  
  // Worker-related properties
  private pendingPhysicsUpdate: boolean = false;
  private lastWorkerUpdateTime: number = 0;
  private workerUpdateInterval: number = 1 / 60; // 60 FPS max updates

  constructor(scene: Scene, launchPosition: Vector3, targetPosition: Vector3, workerManager: WorkerManager) {
    this.scene = scene;
    this.workerManager = workerManager;
    this.position = launchPosition.clone();
    this.targetPosition = targetPosition.clone();

    // Calculate direction to target
    const direction = this.targetPosition.subtract(this.position).normalize();
    this.velocity = direction.scale(this.speed);

    this.missileGroup = new TransformNode('defenseMissileGroup', this.scene);
    this.missileGroup.position = this.position.clone();

    // Orient missile toward target with both yaw and pitch
    const yaw = Math.atan2(direction.x, direction.z) + Math.PI; // Add 180° to flip missile
    const horizontalSpeed = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
    const pitch = Math.atan2(direction.y, horizontalSpeed) + Math.PI;

    this.missileGroup.rotation.y = yaw;
    this.missileGroup.rotation.x = pitch;

    this.createMissileModel();
    this.setupParticleEffects();
  }

  private createMissileModel(): void {
    // Simple missile body
    this.fuselage = MeshBuilder.CreateCylinder(
      'defenseMissileFuselage',
      {
        height: 4,
        diameter: 0.25,
        tessellation: 6,
      },
      this.scene,
    );

    this.fuselage.rotation.x = Math.PI / 2; // Orient horizontally
    this.fuselage.parent = this.missileGroup;

    const fuselageMaterial = new StandardMaterial('defenseMissileFuselage', this.scene);
    fuselageMaterial.diffuseColor = new Color3(0.7, 0.7, 0.6); // Light gray
    fuselageMaterial.specularColor = new Color3(0.3, 0.3, 0.3);
    fuselageMaterial.emissiveColor = new Color3(0.1, 0.1, 0.1);
    this.fuselage.material = fuselageMaterial;

    // Nose cone
    const noseCone = MeshBuilder.CreateCylinder(
      'defenseMissileNose',
      {
        height: 1,
        diameterTop: 0,
        diameterBottom: 0.25,
        tessellation: 6,
      },
      this.scene,
    );

    noseCone.position.z = 2.5;
    noseCone.rotation.x = Math.PI / 2;
    noseCone.parent = this.missileGroup;

    const noseMaterial = new StandardMaterial('defenseMissileNoseMaterial', this.scene);
    noseMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
    noseMaterial.specularColor = new Color3(0.5, 0.5, 0.5);
    noseCone.material = noseMaterial;

    // Simple fins
    const finPositions = [
      { pos: new Vector3(0, 0.2, -1.5), rot: new Vector3(0, 0, 0) },
      { pos: new Vector3(0, -0.2, -1.5), rot: new Vector3(0, 0, Math.PI) },
      { pos: new Vector3(0.2, 0, -1.5), rot: new Vector3(0, 0, Math.PI / 2) },
      { pos: new Vector3(-0.2, 0, -1.5), rot: new Vector3(0, 0, -Math.PI / 2) },
    ];

    finPositions.forEach((finData, index) => {
      const fin = MeshBuilder.CreateBox(
        `defenseMissileFin${index}`,
        {
          width: 0.03,
          height: 0.8,
          depth: 0.4,
        },
        this.scene,
      );

      fin.position = finData.pos;
      fin.rotation = finData.rot;
      fin.parent = this.missileGroup;

      const finMaterial = new StandardMaterial(`defenseMissileFinMaterial${index}`, this.scene);
      finMaterial.diffuseColor = new Color3(0.6, 0.6, 0.5);
      fin.material = finMaterial;
    });

    // Add missile light
    this.light = new PointLight('defenseMissileLight', new Vector3(0, 0, 0), this.scene);
    this.light.diffuse = new Color3(1, 0.8, 0.4);
    this.light.specular = new Color3(1, 0.8, 0.4);
    this.light.intensity = 1.5;
    this.light.range = 30;
    this.light.parent = this.missileGroup;
  }

  private setupParticleEffects(): void {
    // Engine exhaust particles
    this.exhaustParticles = new ParticleSystem('defenseMissileExhaust', 50, this.scene);
    this.exhaustParticles.particleTexture = new Texture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      this.scene,
    );

    // Create emitter at rear of missile
    const emitterMesh = MeshBuilder.CreateSphere('defenseMissileEmitter', { diameter: 0.05 }, this.scene);
    emitterMesh.position = new Vector3(0, 0, -2.5);
    emitterMesh.parent = this.missileGroup;
    emitterMesh.isVisible = false;

    this.exhaustParticles.emitter = emitterMesh;
    this.exhaustParticles.minEmitBox = new Vector3(-0.05, -0.05, -0.05);
    this.exhaustParticles.maxEmitBox = new Vector3(0.05, 0.05, 0.05);

    this.exhaustParticles.color1 = new Color4(1, 0.7, 0.3, 1.0);
    this.exhaustParticles.color2 = new Color4(1, 0.4, 0.1, 0.8);
    this.exhaustParticles.colorDead = new Color4(0.3, 0.1, 0.05, 0.1);

    this.exhaustParticles.emitRate = 50;
    this.exhaustParticles.minLifeTime = 0.3;
    this.exhaustParticles.maxLifeTime = 0.6;
    this.exhaustParticles.minSize = 0.3;
    this.exhaustParticles.maxSize = 0.6;
    this.exhaustParticles.minEmitPower = 20;
    this.exhaustParticles.maxEmitPower = 30;
    this.exhaustParticles.updateSpeed = 0.01;

    this.exhaustParticles.direction1 = new Vector3(-0.1, -0.1, -1);
    this.exhaustParticles.direction2 = new Vector3(0.1, 0.1, -1);
    this.exhaustParticles.gravity = new Vector3(0, -5, 0);
    this.exhaustParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  }

  public launch(): void {
    if (this.launched) return;

    this.launched = true;
    this.exhaustParticles.start();
  }

  public update(deltaTime: number): void {
    if (!this.launched || this.exploded) return;

    this.lifeTime += deltaTime;
    const currentTime = performance.now() / 1000;
    
    // Use worker for physics calculations
    this.updatePhysicsWorker(deltaTime, currentTime);
  }
  
  private updatePhysicsWorker(deltaTime: number, currentTime: number): void {
    // Performance optimization: limit worker update frequency
    if (currentTime - this.lastWorkerUpdateTime < this.workerUpdateInterval) {
      return;
    }
    
    // Don't send new requests if one is already pending
    if (this.pendingPhysicsUpdate) {
      return;
    }
    
    this.lastWorkerUpdateTime = currentTime;
    this.pendingPhysicsUpdate = true;
    
    // Prepare physics data for worker
    const physicsData = {
      missileType: 'defense',
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      targetPosition: { x: this.targetPosition.x, y: this.targetPosition.y, z: this.targetPosition.z },
      speed: this.speed,
      deltaTime: deltaTime,
      launched: this.launched,
      exploded: this.exploded,
      lifeTime: this.lifeTime,
      maxLifeTime: this.maxLifeTime,
      targetSet: this.targetSet
    };
    
    // Send to worker and handle response
    this.workerManager.updateMissilePhysics(physicsData)
      .then((result) => {
        this.pendingPhysicsUpdate = false;
        this.applyPhysicsResult(result);
      })
      .catch(() => {
        this.pendingPhysicsUpdate = false;
        // Fallback: update position slightly to prevent missile from being stuck
        this.position.addInPlace(this.velocity.scale(deltaTime));
        this.missileGroup.position = this.position;
      });
  }
  
  private applyPhysicsResult(result: any): void {
    if (!result || this.exploded) return;
    
    // Apply new position and velocity from worker
    this.position.set(result.position.x, result.position.y, result.position.z);
    this.velocity.set(result.velocity.x, result.velocity.y, result.velocity.z);
    
    // Update target set flag
    if (result.targetSet !== undefined) {
      this.targetSet = result.targetSet;
    }
    
    // Apply rotation if provided
    if (result.rotation && !this.targetSet) {
      this.missileGroup.rotation.set(result.rotation.x, result.rotation.y, result.rotation.z);
    }
    
    // Apply transforms
    this.missileGroup.position = this.position.clone();
    
    // Check for explosion from worker
    if (result.shouldExplode) {
      this.explode();
    }
  }

  public explode(): void {
    if (this.exploded) return;

    this.exploded = true;
    this.exhaustParticles.stop();

    // Create procedural explosion texture
    const explosionTexture = new DynamicTexture(
      'defenseMissileExplosionTexture',
      { width: 64, height: 64 },
      this.scene,
    );
    const explosionContext = explosionTexture.getContext();

    // Create explosion effect with bright center and fading edges
    const explosionGradient = explosionContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    explosionGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    explosionGradient.addColorStop(0.2, 'rgba(255, 255, 0, 0.9)');
    explosionGradient.addColorStop(0.5, 'rgba(255, 100, 0, 0.6)');
    explosionGradient.addColorStop(0.8, 'rgba(255, 50, 0, 0.3)');
    explosionGradient.addColorStop(1, 'rgba(200, 0, 0, 0)');

    explosionContext.fillStyle = explosionGradient;
    explosionContext.fillRect(0, 0, 64, 64);
    explosionTexture.update();

    // Create explosion effect
    const explosionParticles = new ParticleSystem('defenseMissileExplosion', 350, this.scene);
    explosionParticles.particleTexture = explosionTexture;
    explosionParticles.emitter = this.position;
    explosionParticles.minEmitBox = new Vector3(-0.8, -0.8, -0.8);
    explosionParticles.maxEmitBox = new Vector3(0.8, 0.8, 0.8);

    explosionParticles.color1 = new Color4(1, 0.9, 0.1, 1.0);
    explosionParticles.color2 = new Color4(1, 0.4, 0, 1.0);
    explosionParticles.colorDead = new Color4(0.3, 0.1, 0, 0.0);

    explosionParticles.minSize = 0.8;
    explosionParticles.maxSize = 3.0;
    explosionParticles.minLifeTime = 0.4;
    explosionParticles.maxLifeTime = 1.2;
    explosionParticles.emitRate = 700;
    explosionParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    explosionParticles.gravity = new Vector3(0, -9.81, 0);
    explosionParticles.direction1 = new Vector3(-4, 2, -4);
    explosionParticles.direction2 = new Vector3(4, 6, 4);
    explosionParticles.minEmitPower = 4;
    explosionParticles.maxEmitPower = 10;

    explosionParticles.start();

    // Stop particles after a short time
    setTimeout(() => {
      explosionParticles.stop();
      setTimeout(() => {
        explosionParticles.dispose();
      }, 2000);
    }, 100);

    // Hide the missile mesh
    this.missileGroup.setEnabled(false);
  }

  public getPosition(): Vector3 {
    return this.position.clone();
  }

  public isLaunched(): boolean {
    return this.launched;
  }

  public hasExploded(): boolean {
    return this.exploded;
  }

  public dispose(): void {
    if (this.exhaustParticles) {
      this.exhaustParticles.dispose();
    }
    if (this.light) {
      this.light.dispose();
    }
    this.missileGroup.dispose();
  }
}
