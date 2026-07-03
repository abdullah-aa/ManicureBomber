import { Scene, Mesh, Vector3, MeshBuilder, ParticleSystem, Color4, TransformNode } from '@babylonjs/core';
import { MissileAssets } from './MissileAssets';
import { WorkerManager } from '../managers/WorkerManager';
import { LightManager, LightHandle, LightPriority } from '../managers/LightManager';
import { EffectTextures } from '../effects/EffectTextures';
import { ExplosionPool } from '../effects/ExplosionPool';

export class DefenseMissile {
  /** Highest altitude any defense missile can reach before self-detonating. */
  public static readonly MAX_ALTITUDE = 280;
  /**
   * Lowest possible airburst altitude. Sits above the bomber's 200 ceiling plus
   * the 20 u proximity-damage radius, so every missile stays lethal through the
   * bomber's entire flyable band before bursting.
   */
  public static readonly MIN_AIRBURST_ALTITUDE = 220;

  /**
   * Per-Scene free-list of PARKED missiles (in-flight ones live in
   * Game.defenseMissiles). Defense missiles are the highest-frequency runtime
   * mesh creation in the game — every 3-11s per launcher, several launchers in
   * range at once — and each used to build 7 meshes + 6 materials + 1 particle
   * system, all disposed ~1.5s after airburst. Pooled missiles keep their mesh
   * hierarchy and exhaust system for the scene's lifetime: acquire() re-arms
   * one, release() parks it disabled. A salvo deeper than POOL_RETAIN still
   * works (extra missiles are built on demand and disposed on release).
   */
  private static pools: WeakMap<Scene, DefenseMissile[]> = new WeakMap();
  private static readonly POOL_RETAIN = 6;

  static acquire(
    scene: Scene,
    launchPosition: Vector3,
    targetPosition: Vector3,
    bomberVelocity: Vector3,
    workerManager: WorkerManager,
  ): DefenseMissile {
    let pool = DefenseMissile.pools.get(scene);
    if (!pool) {
      pool = [];
      DefenseMissile.pools.set(scene, pool);
    }
    const missile = pool.pop() ?? new DefenseMissile(scene, workerManager);
    missile.arm(launchPosition, targetPosition, bomberVelocity);
    return missile;
  }

  private scene: Scene;
  private workerManager: WorkerManager;
  private missileGroup: TransformNode;
  private fuselage!: Mesh;
  private position: Vector3;
  private velocity: Vector3;
  private targetPosition: Vector3;
  private bomberVelocity: Vector3;
  private speed: number = 0; // Set per launch in arm() (variable 120-150 units/sec)
  private launched: boolean = false;
  private exploded: boolean = false;
  private exhaustParticles!: ParticleSystem;
  private lightHandle: LightHandle = LightHandle.inert();
  private targetSet: boolean = false; // Performance optimization flag
  private maxAltitude: number = 0; // Airburst altitude, randomized per launch in arm()

  // Trajectory calculation properties
  private trajectoryCalculated: boolean = false;
  private pendingTrajectoryCalculation: boolean = false;

  /** Builds the reusable hull only; all per-launch state lives in arm(). Use acquire(). */
  private constructor(scene: Scene, workerManager: WorkerManager) {
    this.scene = scene;
    this.workerManager = workerManager;
    this.position = new Vector3();
    this.velocity = new Vector3();
    this.targetPosition = new Vector3();
    this.bomberVelocity = new Vector3();

    this.missileGroup = new TransformNode('defenseMissileGroup', this.scene);
    this.createMissileModel();
    this.setupParticleEffects();
    this.missileGroup.getChildMeshes().forEach((m) => (m.isPickable = false));
    this.missileGroup.setEnabled(false); // Parked until arm()
  }

  /** Re-arm a pooled missile for a fresh launch — resets every per-launch field. */
  private arm(launchPosition: Vector3, targetPosition: Vector3, bomberVelocity: Vector3): void {
    this.position.copyFrom(launchPosition);
    this.targetPosition.copyFrom(targetPosition);
    this.bomberVelocity.copyFrom(bomberVelocity);
    this.velocity.set(0, 0, 0); // Stationary until the trajectory worker replies
    this.launched = false;
    this.exploded = false;
    this.targetSet = false;
    this.trajectoryCalculated = false;
    this.pendingTrajectoryCalculation = false;
    this.speed = 120 + Math.random() * 30; // Variable speed between 120-150 units/sec
    this.maxAltitude =
      DefenseMissile.MIN_AIRBURST_ALTITUDE +
      Math.random() * (DefenseMissile.MAX_ALTITUDE - DefenseMissile.MIN_AIRBURST_ALTITUDE);

    this.missileGroup.position.copyFrom(this.position);

    // Set initial orientation toward target
    const direction = this.targetPosition.subtract(this.position).normalize();
    const yaw = Math.atan2(direction.x, direction.z) + Math.PI; // Add 180° to flip missile
    const horizontalSpeed = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
    const pitch = Math.atan2(direction.y, horizontalSpeed) + Math.PI;
    this.missileGroup.rotation.set(pitch, yaw, 0);
    this.missileGroup.setEnabled(true);

    // Pooled missile light; follows the missile in world space (never parented)
    this.lightHandle = LightManager.get(this.scene).acquire(LightPriority.MEDIUM);
    this.lightHandle.setColor(1, 0.8, 0.4);
    this.lightHandle.setIntensity(1.5);
    this.lightHandle.setRange(30);
    this.lightHandle.setPosition(this.position);
  }

  /**
   * Park this missile back in the pool instead of disposing (Game's sweep calls
   * this ~1.5s after airburst so the blast finishes first). explode() already
   * stopped the exhaust, hid the group, and released the light — repeating them
   * here is harmless (all idempotent) and covers non-exploded teardown paths.
   */
  public release(): void {
    this.exhaustParticles.stop();
    this.missileGroup.setEnabled(false);
    this.lightHandle.release();

    const pool = DefenseMissile.pools.get(this.scene);
    if (pool && pool.length < DefenseMissile.POOL_RETAIN) {
      pool.push(this);
    } else {
      this.dispose();
    }
  }

  private createMissileModel(): void {
    // Part materials are shared frozen instances (MissileAssets); the meshes
    // themselves are also reused across launches via the pool.
    const assets = MissileAssets.get(this.scene);

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
    this.fuselage.material = assets.getDefenseFuselageMaterial();

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
    noseCone.material = assets.getDefenseNoseMaterial();

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
      fin.material = assets.getDefenseFinMaterial();
    });

    // The pooled scene light is acquired per launch in arm() — a parked missile
    // must not hold a light slot.
  }

  private setupParticleEffects(): void {
    // Engine exhaust particles
    this.exhaustParticles = new ParticleSystem('defenseMissileExhaust', 50, this.scene);
    this.exhaustParticles.particleTexture = EffectTextures.get(this.scene).getPixelTexture();

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

    this.lightHandle.setPosition(this.position);

    // Calculate trajectory only once when launched
    if (!this.trajectoryCalculated && !this.pendingTrajectoryCalculation) {
      this.calculateInitialTrajectory();
      return;
    }

    // Skip update if trajectory calculation is pending
    if (this.pendingTrajectoryCalculation) {
      return;
    }

    // Simple straight-line movement once trajectory is set
    this.updateStraightLineMovement(deltaTime);
  }

  private calculateInitialTrajectory(): void {
    this.pendingTrajectoryCalculation = true;

    // Prepare data for trajectory calculation
    const trajectoryData: any = {
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      rotation: { x: this.missileGroup.rotation.x, y: this.missileGroup.rotation.y, z: this.missileGroup.rotation.z },
      targetPosition: { x: this.targetPosition.x, y: this.targetPosition.y, z: this.targetPosition.z },
      bomberVelocity: { x: this.bomberVelocity.x, y: this.bomberVelocity.y, z: this.bomberVelocity.z },
      speed: this.speed,
      deltaTime: 0.016, // Standard frame time
      launched: this.launched,
      exploded: this.exploded,
      targetSet: this.targetSet,
      maxAltitude: this.maxAltitude,
    };

    // Calculate trajectory using worker
    this.workerManager
      .calculateDefenseTrajectory(trajectoryData)
      .then((result) => {
        this.applyTrajectoryResult(result);
      })
      .catch(() => {
        // If worker fails, reset flag to retry on next loop
        this.pendingTrajectoryCalculation = false;
      });
  }

  private applyTrajectoryResult(result: any): void {
    if (!result || this.exploded) return;

    // Apply calculated velocity and rotation
    this.velocity.set(result.velocity.x, result.velocity.y, result.velocity.z);
    this.missileGroup.rotation.set(result.rotation.x, result.rotation.y, result.rotation.z);

    // Mark trajectory as calculated
    this.trajectoryCalculated = true;
    this.targetSet = true;
    this.pendingTrajectoryCalculation = false;
  }

  private updateStraightLineMovement(deltaTime: number): void {
    // Component-wise integration — no per-frame Vector3 allocations
    this.position.x += this.velocity.x * deltaTime;
    this.position.y += this.velocity.y * deltaTime;
    this.position.z += this.velocity.z * deltaTime;
    this.missileGroup.position.copyFrom(this.position);

    // Airburst at the missile's ceiling — or on ground impact, so a downward-aimed
    // shot can never fly underground forever and leak its mesh/particles/light.
    if (this.position.y >= this.maxAltitude || this.position.y <= 0) {
      this.explode();
    }
  }

  public explode(): void {
    if (this.exploded) return;

    this.exploded = true;
    this.exhaustParticles.stop();

    // Small airburst flash: fire only, no lingering smoke/shockwave. Sized well
    // below the Iskander's 0.85 to match its much lower damage.
    ExplosionPool.get(this.scene).explode(this.position, 0.3, { smoke: false, shockwave: false, sparks: false });

    // Hide the missile mesh
    this.missileGroup.setEnabled(false);
    this.lightHandle.release();
  }

  public getPosition(): Vector3 {
    return this.position.clone();
  }

  /** Read-only reference to the internal position — callers must not mutate it. */
  public getPositionRef(): Vector3 {
    return this.position;
  }

  /** Read-only reference to the internal velocity — callers must not mutate it. */
  public getVelocityRef(): Vector3 {
    return this.velocity;
  }

  public isLaunched(): boolean {
    return this.launched;
  }

  public hasExploded(): boolean {
    return this.exploded;
  }

  /** Full teardown — only for missiles beyond the pool's retention cap (see release()). */
  public dispose(): void {
    if (this.exhaustParticles) {
      // Particle system BEFORE its emitter mesh (the mesh hierarchy below) —
      // disposing the emitter first would auto-dispose the system with
      // disposeTexture=true, killing the shared EffectTextures pixel texture.
      // dispose(false) keeps that shared texture.
      this.exhaustParticles.dispose(false);
    }
    this.lightHandle.release();
    // Part materials are shared frozen instances (MissileAssets) — plain
    // dispose() (no disposeMaterialAndTextures) leaves them intact.
    this.missileGroup.dispose();
  }
}
