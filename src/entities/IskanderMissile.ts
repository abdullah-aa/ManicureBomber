import {
  Scene,
  Mesh,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  ParticleSystem,
  Color4,
  TransformNode,
} from '@babylonjs/core';
import { Bomber } from './Bomber';
import { WorkerManager } from '../managers/WorkerManager';
import type { TerrainManager } from '../managers/TerrainManager';
import { LightManager, LightHandle, LightPriority } from '../managers/LightManager';
import { EffectTextures } from '../effects/EffectTextures';
import { ExplosionPool } from '../effects/ExplosionPool';
import { updateIskanderMissilePhysics } from '../managers/MissileGuidance';

export class IskanderMissile {
  private scene: Scene;
  private missileGroup: TransformNode;
  private fuselage!: Mesh;
  private position: Vector3;
  private velocity: Vector3;
  private rotation: Vector3;
  private targetPosition: Vector3;
  private bomber: Bomber;
  private speed: number = 120;
  private turnRate: number = 1.25; // Increased turn rate for better responsiveness
  private launched: boolean = false;
  private exploded: boolean = false;
  private exhaustParticles!: ParticleSystem;
  private trailParticles!: ParticleSystem;
  private flightSmokeParticles!: ParticleSystem;
  private lightHandle: LightHandle = LightHandle.inert();

  // Curved path navigation properties (like Tomahawk)
  private pathTime: number = 0;
  private pathSpeed: number = 0.4; // Speed along the curved path
  private waypoints: Vector3[] = [];

  // Performance optimization: cached calculations
  private lastUpdateTime: number = 0;
  private updateInterval: number = 1 / 60; // 60 FPS max updates

  // Terrain-surface detonation: armed once the missile is clearly airborne so a
  // launch from raised terrain doesn't detonate on the pad
  private terrainManager: TerrainManager | null = null;
  private groundCheckArmed: boolean = false;

  // Countermeasure flare targeting
  private flareTargets: Vector3[] = [];
  private flareDetectionRange: number = 150; // Increased from 100 - real IR seekers are very sensitive
  private originalTargetPosition: Vector3;
  private isTargetingFlare: boolean = false;

  // Lock-on system properties
  private lockOnRange: number = Infinity; // Remove distance limitation - always allow lock
  private isLockedOn: boolean = false;
  private lockOnTime: number = 4;
  private lockOnDuration: number = 4; // Faster lock-on for more responsive tracking
  private guidanceStrength: number = 3.0; // Increased guidance strength for better tracking
  private maxTurnRate: number = 3.5; // Higher maximum turn rate for sharper turns
  private lastTargetUpdateTime: number = 0;
  private targetUpdateInterval: number = 0.1; // Update target position every 100ms

  // Lock establishment callback
  private onLockEstablishedCallback: (() => void) | null = null;

  // Worker integration (kept for API stability; per-frame guidance is main-thread now)
  private workerManager: WorkerManager;

  constructor(scene: Scene, launchPosition: Vector3, bomber: Bomber, workerManager: WorkerManager) {
    this.scene = scene;
    this.position = launchPosition.clone();
    this.bomber = bomber;
    this.targetPosition = bomber.getPosition().clone();
    this.originalTargetPosition = this.targetPosition.clone();
    this.rotation = new Vector3(0, 0, 0);
    this.velocity = new Vector3(0, 0, 0); // Start stationary
    this.workerManager = workerManager;

    this.missileGroup = new TransformNode('iskanderGroup', this.scene);
    this.missileGroup.position = this.position.clone();
    this.missileGroup.rotation = this.rotation.clone();

    this.createMissileModel();
    this.setupParticleEffects();
    this.generateCurvedPath();
    this.missileGroup.getChildMeshes().forEach((m) => (m.isPickable = false));
  }

  private generateCurvedPath(): void {
    // Create a curved path from launch position to bomber
    this.waypoints = [this.position.clone(), this.targetPosition.clone()];
  }

  private createMissileModel(): void {
    // Main fuselage - sleek ballistic missile body
    this.fuselage = MeshBuilder.CreateCylinder(
      'iskanderFuselage',
      {
        height: 10,
        diameter: 0.75,
        tessellation: 12,
      },
      this.scene,
    );

    this.fuselage.rotation.x = Math.PI / 2; // Orient horizontally pointing forward
    this.fuselage.parent = this.missileGroup;

    const fuselageMaterial = new StandardMaterial('iskanderFuselage', this.scene);
    fuselageMaterial.diffuseColor = new Color3(0.6, 0.6, 0.7); // Dark gray
    fuselageMaterial.specularColor = new Color3(0.4, 0.4, 0.5);
    fuselageMaterial.emissiveColor = new Color3(0.05, 0.05, 0.08);
    this.fuselage.material = fuselageMaterial;

    // Nose cone
    const noseCone = MeshBuilder.CreateCylinder(
      'iskanderNose',
      {
        height: 1.5,
        diameterTop: 0,
        diameterBottom: 0.75,
        tessellation: 12,
      },
      this.scene,
    );

    noseCone.position.z = 5.5; // Front of missile
    noseCone.rotation.x = Math.PI / 2;
    noseCone.parent = this.missileGroup;

    const noseMaterial = new StandardMaterial('iskanderNoseMaterial', this.scene);
    noseMaterial.diffuseColor = new Color3(0.3, 0.3, 0.35);
    noseMaterial.specularColor = new Color3(0.7, 0.7, 0.8);
    noseCone.material = noseMaterial;

    // Control fins
    this.createControlFins();

    // Engine nozzle
    const engineNozzle = MeshBuilder.CreateCylinder(
      'iskanderEngine',
      {
        height: 1.2,
        diameter: 0.65,
        tessellation: 12,
      },
      this.scene,
    );

    engineNozzle.position.z = -5.5; // Rear of missile
    engineNozzle.rotation.x = Math.PI / 2;
    engineNozzle.parent = this.missileGroup;

    const engineMaterial = new StandardMaterial('iskanderEngineMaterial', this.scene);
    engineMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
    engineMaterial.emissiveColor = new Color3(0.4, 0.15, 0.05);
    engineNozzle.material = engineMaterial;

    // Add missile light with red tint
    // Pooled missile light; follows the missile in world space (never parented)
    this.lightHandle = LightManager.get(this.scene).acquire(LightPriority.HIGH);
    this.lightHandle.setColor(1, 0.2, 0.1);
    this.lightHandle.setIntensity(4);
    this.lightHandle.setRange(60);
    this.lightHandle.setPosition(this.position);
  }

  private createControlFins(): void {
    // Control fins for guidance
    const finPositions = [
      { pos: new Vector3(0, 0.4, -4), rot: new Vector3(0, 0, 0) },
      { pos: new Vector3(0, -0.4, -4), rot: new Vector3(0, 0, Math.PI) },
      { pos: new Vector3(0.4, 0, -4), rot: new Vector3(0, 0, Math.PI / 2) },
      { pos: new Vector3(-0.4, 0, -4), rot: new Vector3(0, 0, -Math.PI / 2) },
    ];

    finPositions.forEach((finData, index) => {
      const fin = MeshBuilder.CreateBox(
        `iskanderFin${index}`,
        {
          width: 0.08,
          height: 1.5,
          depth: 0.8,
        },
        this.scene,
      );

      fin.position = finData.pos;
      fin.rotation = finData.rot;
      fin.parent = this.missileGroup;

      const finMaterial = new StandardMaterial(`iskanderFinMaterial${index}`, this.scene);
      finMaterial.diffuseColor = new Color3(0.5, 0.5, 0.6);
      finMaterial.specularColor = new Color3(0.3, 0.3, 0.4);
      fin.material = finMaterial;
    });
  }

  private setupParticleEffects(): void {
    // Engine exhaust particles
    this.exhaustParticles = new ParticleSystem('iskanderExhaust', 100, this.scene);
    this.exhaustParticles.particleTexture = EffectTextures.get(this.scene).getPixelTexture();

    // Create emitter at rear of missile
    const emitterMesh = MeshBuilder.CreateSphere('iskanderEmitter', { diameter: 0.1 }, this.scene);
    emitterMesh.position = new Vector3(0, 0, -7.25); // Rear of missile
    emitterMesh.parent = this.missileGroup;
    emitterMesh.isVisible = false;

    this.exhaustParticles.emitter = emitterMesh;
    this.exhaustParticles.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
    this.exhaustParticles.maxEmitBox = new Vector3(0.1, 0.1, 0.1);

    // Red-orange exhaust for Iskander
    this.exhaustParticles.color1 = new Color4(1, 0.3, 0.1, 1.0); // Bright red-orange
    this.exhaustParticles.color2 = new Color4(1, 0.1, 0.05, 0.9); // Deep red
    this.exhaustParticles.colorDead = new Color4(0.3, 0.05, 0.02, 0.1);

    this.exhaustParticles.emitRate = 100;
    this.exhaustParticles.minLifeTime = 0.4;
    this.exhaustParticles.maxLifeTime = 0.8;
    this.exhaustParticles.minSize = 0.4;
    this.exhaustParticles.maxSize = 1.5;
    this.exhaustParticles.minEmitPower = 50;
    this.exhaustParticles.maxEmitPower = 80;
    this.exhaustParticles.updateSpeed = 0.01;

    this.exhaustParticles.direction1 = new Vector3(-0.2, -0.1, -1);
    this.exhaustParticles.direction2 = new Vector3(0.2, 0.1, -1);
    this.exhaustParticles.gravity = new Vector3(0, 0, 0);
    this.exhaustParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;

    // Vapor trail particles
    this.trailParticles = new ParticleSystem('iskanderTrail', 200, this.scene);
    this.trailParticles.particleTexture = EffectTextures.get(this.scene).getRedTrailTexture();
    this.trailParticles.emitter = emitterMesh;
    this.trailParticles.minEmitBox = new Vector3(0, 0, 0);
    this.trailParticles.maxEmitBox = new Vector3(0, 0, 0);

    // Red-tinted trail colors
    this.trailParticles.color1 = new Color4(1.0, 0.4, 0.4, 0.6);
    this.trailParticles.color2 = new Color4(0.8, 0.2, 0.2, 0.4);
    this.trailParticles.colorDead = new Color4(0.4, 0.1, 0.1, 0.0);

    this.trailParticles.emitRate = 100;
    this.trailParticles.minLifeTime = 2.0;
    this.trailParticles.maxLifeTime = 4.0;
    this.trailParticles.minSize = 1.0;
    this.trailParticles.maxSize = 3.0;
    this.trailParticles.minEmitPower = 3;
    this.trailParticles.maxEmitPower = 8;
    this.trailParticles.updateSpeed = 0.01;

    this.trailParticles.direction1 = new Vector3(0, 0, -0.3);
    this.trailParticles.direction2 = new Vector3(0, 0, 0.3);
    this.trailParticles.gravity = new Vector3(0, -1, 0);
    this.trailParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    this.flightSmokeParticles = new ParticleSystem('iskanderSmoke', 80, this.scene);
    this.flightSmokeParticles.particleTexture = EffectTextures.get(this.scene).getSmokeTexture();
    this.flightSmokeParticles.emitter = emitterMesh;
    this.flightSmokeParticles.minEmitBox = new Vector3(0, 0, 0);
    this.flightSmokeParticles.maxEmitBox = new Vector3(0, 0, 0);

    this.flightSmokeParticles.color1 = new Color4(0.3, 0.3, 0.3, 0.4);
    this.flightSmokeParticles.color2 = new Color4(0.5, 0.5, 0.5, 0.3);
    this.flightSmokeParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);

    this.flightSmokeParticles.emitRate = 50;
    this.flightSmokeParticles.minLifeTime = 3.0;
    this.flightSmokeParticles.maxLifeTime = 6.0;
    this.flightSmokeParticles.minSize = 1.5;
    this.flightSmokeParticles.maxSize = 4.0;
    this.flightSmokeParticles.minEmitPower = 2;
    this.flightSmokeParticles.maxEmitPower = 5;
    this.flightSmokeParticles.updateSpeed = 0.01;

    this.flightSmokeParticles.direction1 = new Vector3(0, 0, -0.2);
    this.flightSmokeParticles.direction2 = new Vector3(0, 0, 0.2);
    this.flightSmokeParticles.gravity = new Vector3(0, -0.8, 0);
    this.flightSmokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  }

  public setTerrainManager(terrainManager: TerrainManager): void {
    this.terrainManager = terrainManager;
  }

  public launch(): void {
    if (this.launched) return;

    this.launched = true;

    // Set initial velocity toward target
    const directionToTarget = this.targetPosition.subtract(this.position).normalize();
    this.velocity = directionToTarget.scale(this.speed * 0.5); // Start at half speed

    // Calculate initial rotation to face target
    if (this.velocity.lengthSquared() > 0.01) {
      this.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
      const horizontalSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      if (horizontalSpeed > 0.001) {
        this.rotation.x = Math.atan2(-this.velocity.y, horizontalSpeed);
      }
    }

    // Update visual representation
    this.missileGroup.position = this.position.clone();
    this.missileGroup.rotation = this.rotation.clone();

    // Start all particle effects
    this.exhaustParticles.start();
    this.trailParticles.start();
    this.flightSmokeParticles.start();
  }

  public addFlareTarget(flarePosition: Vector3): void {
    // Don't add duplicate flare positions - check if this flare is already tracked
    const isDuplicate = this.flareTargets.some(existing =>
      Vector3.Distance(existing, flarePosition) < 1 // Within 1 unit = same flare
    );

    if (!isDuplicate) {
      this.flareTargets.push(flarePosition.clone());
    }
  }

  public clearFlareTargets(): void {
    this.flareTargets = [];
  }

  public updateFlareTargets(activeFlares: Vector3[]): void {
    // Store the (read-only) array reference. It is only ever read here — serialized
    // to plain {x,y,z} objects in updatePhysicsWorker — so no per-frame cloning of
    // every flare for every missile is needed. The bomber rebuilds the array when
    // flares are added/removed, which also prevents stale-position accumulation.
    this.flareTargets = activeFlares;
  }

  public update(deltaTime: number): void {
    if (!this.launched || this.exploded) return;

    this.lightHandle.setPosition(this.position);

    // Performance optimization: limit update frequency
    const currentTime = performance.now() / 1000;
    if (currentTime - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = currentTime;

    // Update target position periodically for better performance
    if (currentTime - this.lastTargetUpdateTime > this.targetUpdateInterval) {
      if (!this.isTargetingFlare) {
        this.targetPosition = this.bomber.getPosition();
        this.originalTargetPosition = this.targetPosition.clone();
        // Update waypoints when target changes
        this.waypoints = [this.position.clone(), this.targetPosition.clone()];
      }
      this.lastTargetUpdateTime = currentTime;
    }

    // Terrain-surface detonation height; 0 (legacy flat-world floor) until the
    // missile has once been clearly above the local terrain
    let groundHeight = 0;
    if (this.terrainManager) {
      const terrainY = this.terrainManager.getTerrainHeightAt(this.position.x, this.position.z);
      if (!this.groundCheckArmed && this.position.y > terrainY + 10) {
        this.groundCheckArmed = true;
      }
      if (this.groundCheckArmed) {
        groundHeight = terrainY;
      }
    }

    // Per-frame guidance runs on the main thread (no round-trip latency — flare
    // diversion and lock-on react within the same frame).
    const result = updateIskanderMissilePhysics({
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      rotation: { x: this.rotation.x, y: this.rotation.y, z: this.rotation.z },
      targetPosition: { x: this.targetPosition.x, y: this.targetPosition.y, z: this.targetPosition.z },
      speed: this.speed,
      turnRate: this.turnRate,
      deltaTime: deltaTime,
      pathTime: this.pathTime,
      pathSpeed: this.pathSpeed,
      waypoints: this.waypoints,
      launched: this.launched,
      exploded: this.exploded,
      currentTime: currentTime,

      // Iskander-specific properties. flareTargets is the bomber's live array
      // (read-only contract) — the guidance code only reads x/y/z and returns a
      // filtered copy, never mutating the input.
      flareTargets: this.flareTargets,
      flareDetectionRange: this.flareDetectionRange,
      originalTargetPosition: this.originalTargetPosition,
      isTargetingFlare: this.isTargetingFlare,
      lockOnRange: this.lockOnRange,
      isLockedOn: this.isLockedOn,
      lockOnTime: this.lockOnTime,
      lockOnDuration: this.lockOnDuration,
      guidanceStrength: this.guidanceStrength,
      maxTurnRate: this.maxTurnRate,
      groundHeight: groundHeight,
    });
    this.applyPhysicsResult(result);
  }

  private applyPhysicsResult(result: any): void {
    // Update position and rotation
    this.position.set(result.position.x, result.position.y, result.position.z);
    this.velocity.set(result.velocity.x, result.velocity.y, result.velocity.z);
    this.rotation.set(result.rotation.x, result.rotation.y, result.rotation.z);
    this.pathTime = result.pathTime;

    // Update Iskander-specific properties
    if (result.isLockedOn !== undefined) this.isLockedOn = result.isLockedOn;
    if (result.lockOnTime !== undefined) this.lockOnTime = result.lockOnTime;
    if (result.isTargetingFlare !== undefined) this.isTargetingFlare = result.isTargetingFlare;
    if (result.flareTargets) {
      this.flareTargets = result.flareTargets.map((ft: any) => new Vector3(ft.x, ft.y, ft.z));
    }

    // Check for lock establishment
    if (result.lockEstablished && this.onLockEstablishedCallback) {
      this.onLockEstablishedCallback();
    }

    // Update visual representation
    this.missileGroup.position = this.position.clone();
    this.missileGroup.rotation = this.rotation.clone();

    // Check for explosion conditions
    if (result.shouldExplode) {
      this.explode();
    }
  }

  public explode(): void {
    if (this.exploded) return;

    this.exploded = true;

    // Stop flight effects
    this.exhaustParticles.stop();
    this.trailParticles.stop();
    this.flightSmokeParticles.stop();
    this.lightHandle.release();

    ExplosionPool.get(this.scene).explode(this.position, 0.85);

    // Deal damage to bomber if close enough
    const bomberPosition = this.bomber.getPosition();
    const distanceToBomber = Vector3.Distance(this.position, bomberPosition);
    if (distanceToBomber <= 25) {
      const damage = Math.max(15, 50 - distanceToBomber); // Increased from 30% to 50% of bomber health
      this.bomber.takeDamage(damage);
    }

    // Hide missile model; Game's exploded-missile sweep calls dispose() ~2s later,
    // which removes the group and the stopped flight particle systems.
    this.missileGroup.setEnabled(false);
  }

  public getPosition(): Vector3 {
    return this.position.clone();
  }

  /** Read-only reference to the internal position — callers must not mutate it. */
  public getPositionRef(): Vector3 {
    return this.position;
  }

  public isLaunched(): boolean {
    return this.launched;
  }

  public hasExploded(): boolean {
    return this.exploded;
  }

  public getIsLockedOn(): boolean {
    return this.isLockedOn;
  }

  public getLockProgress(): number {
    return Math.min(this.lockOnTime / this.lockOnDuration, 1.0);
  }

  public dispose(): void {
    // Flight particle textures are shared via EffectTextures — dispose(false).
    // Particle systems must go BEFORE the group: disposing their emitter mesh
    // would auto-dispose them with disposeTexture=true, killing the shared
    // textures for every later missile/bomb.
    if (this.trailParticles) this.trailParticles.dispose(false);
    if (this.exhaustParticles) this.exhaustParticles.dispose(false);
    if (this.flightSmokeParticles) this.flightSmokeParticles.dispose(false);
    if (this.missileGroup) this.missileGroup.dispose(false, true);
    this.lightHandle.release();
  }
}
