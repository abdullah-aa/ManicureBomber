import {
  Scene,
  Mesh,
  Vector3,
  MeshBuilder,
  ParticleSystem,
  Color4,
  TransformNode,
} from '@babylonjs/core';
import { Bomber } from './Bomber';
import { MissileAssets } from './MissileAssets';
import { WorkerManager } from '../managers/WorkerManager';
import { ISKANDER_CLIMB_ALTITUDE, ISKANDER_FLARE_DETECTION_RANGE } from '../config/Balance';
import { GameClock } from '../utils/GameClock';
import type { TerrainManager } from '../managers/TerrainManager';
import { LightManager, LightHandle, LightPriority } from '../managers/LightManager';
import { EffectTextures } from '../effects/EffectTextures';
import { ExplosionPool } from '../effects/ExplosionPool';
import { updateIskanderMissilePhysics, IskanderMissileData } from '../managers/MissileGuidance';

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
  /**
   * Boost-phase ceiling: climb straight up to here before guidance arcs the
   * missile toward the bomber. Clears the tallest structure (skyscraper,
   * world y ≈ 61) with margin while staying below the bomber's flight band.
   */
  public static readonly CLIMB_ALTITUDE = ISKANDER_CLIMB_ALTITUDE;
  private climbing: boolean = true;
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

  // Terrain-surface detonation: armed once the missile is clearly airborne so a
  // launch from raised terrain doesn't detonate on the pad
  private terrainManager: TerrainManager | null = null;
  private groundCheckArmed: boolean = false;

  // Countermeasure flare targeting
  private flareTargets: Vector3[] = [];
  private flareDetectionRange: number = ISKANDER_FLARE_DETECTION_RANGE; // widened in guidance (Balance.ts)
  private originalTargetPosition: Vector3;
  private isTargetingFlare: boolean = false;

  // Lock-on system properties
  private lockOnRange: number = Infinity; // Remove distance limitation - always allow lock
  private isLockedOn: boolean = false;
  private lockOnTime: number = 0; // real 4s lock window (was seeded =duration: instant lock)
  private lockOnDuration: number = 4; // Faster lock-on for more responsive tracking
  private guidanceStrength: number = 3.0; // Increased guidance strength for better tracking
  private maxTurnRate: number = 3.5; // Higher maximum turn rate for sharper turns
  private lastTargetUpdateTime: number = 0;
  private targetUpdateInterval: number = 0.1; // Update target position every 100ms

  // Lock establishment callback
  private onLockEstablishedCallback: (() => void) | null = null;


  // Reused per-frame guidance payload — updateIskanderMissilePhysics reads it
  // synchronously and never mutates it, so one object per missile replaces the
  // ~25-field literal that was allocated every frame. The vector fields are live
  // references; the ones this class ever REASSIGNS (targetPosition, waypoints,
  // flareTargets, originalTargetPosition) are re-pointed in update().
  private readonly physicsData: IskanderMissileData;

  constructor(scene: Scene, launchPosition: Vector3, bomber: Bomber) {
    this.scene = scene;
    this.position = launchPosition.clone();
    this.bomber = bomber;
    this.targetPosition = bomber.getPosition().clone();
    this.originalTargetPosition = this.targetPosition.clone();
    this.rotation = new Vector3(0, 0, 0);
    this.velocity = new Vector3(0, 0, 0); // Start stationary

    this.physicsData = {
      position: this.position,
      velocity: this.velocity,
      rotation: this.rotation,
      targetPosition: this.targetPosition,
      speed: this.speed,
      turnRate: this.turnRate,
      deltaTime: 0,
      pathTime: 0,
      pathSpeed: this.pathSpeed,
      waypoints: this.waypoints,
      launched: false,
      exploded: false,
      currentTime: 0,
      flareTargets: this.flareTargets,
      flareDetectionRange: this.flareDetectionRange,
      originalTargetPosition: this.originalTargetPosition,
      isTargetingFlare: false,
      // ~70% of seekers fall for a given volley; the rest press through it and
      // re-roll against the next volley (see MissileGuidance seduction roll)
      flareSeductionChance: 0.7,
      flareSeductionState: 'unrolled',
      lockOnRange: this.lockOnRange,
      isLockedOn: false,
      lockSuspended: false,
      lockOnTime: this.lockOnTime,
      lockOnDuration: this.lockOnDuration,
      guidanceStrength: this.guidanceStrength,
      maxTurnRate: this.maxTurnRate,
      groundHeight: 0,
    };

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
    // Part materials are shared frozen instances (MissileAssets) — one set for
    // every Iskander ever launched instead of 7 fresh materials per missile.
    const assets = MissileAssets.get(this.scene);

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
    this.fuselage.material = assets.getIskanderFuselageMaterial();

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
    noseCone.material = assets.getIskanderNoseMaterial();

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
    engineNozzle.material = assets.getIskanderEngineMaterial();

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

    const finMaterial = MissileAssets.get(this.scene).getIskanderFinMaterial();
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

    // Boost phase: straight up at half speed; guidance takes over at CLIMB_ALTITUDE.
    this.velocity.set(0, this.speed * 0.5, 0);
    // Pure-vertical velocity defeats the atan2-from-velocity pose (the
    // horizontalSpeed guard would leave the mesh horizontal) — set the nose-up
    // pitch explicitly and pre-aim the yaw at the target so the arc-over is
    // mostly pitch.
    const directionToTarget = this.targetPosition.subtract(this.position).normalize();
    this.rotation.set(-Math.PI / 2, Math.atan2(directionToTarget.x, directionToTarget.z), 0);

    // Update visual representation
    this.missileGroup.position = this.position.clone();
    this.missileGroup.rotation = this.rotation.clone();

    // Start all particle effects
    this.exhaustParticles.start();
    this.trailParticles.start();
    this.flightSmokeParticles.start();
  }

  public updateFlareTargets(activeFlares: Vector3[]): void {
    // Store the (read-only) array reference. It is only ever read here — serialized
    // to plain {x,y,z} objects in updatePhysicsWorker — so no per-frame cloning of
    // every flare for every missile is needed. The bomber rebuilds the array when
    // flares are added/removed, which also prevents stale-position accumulation.
    this.flareTargets = activeFlares;
  }

  public update(deltaTime: number, lockSuspended: boolean = false): void {
    if (!this.launched || this.exploded) return;

    this.lightHandle.setPosition(this.position);

    const currentTime = GameClock.now();

    // Update target position periodically for better performance. Concealment
    // (cloud cover) freezes the refresh for an UNLOCKED seeker so it flies at
    // the last-seen position; a completed lock tracks through clouds.
    if (currentTime - this.lastTargetUpdateTime > this.targetUpdateInterval) {
      if (!this.isTargetingFlare && !(lockSuspended && !this.isLockedOn)) {
        this.targetPosition = this.bomber.getPosition();
        this.originalTargetPosition = this.targetPosition.clone();
        // Update waypoints when target changes
        this.waypoints = [this.position.clone(), this.targetPosition.clone()];
      }
      this.lastTargetUpdateTime = currentTime;
    }

    // Boost phase: integrate the vertical climb directly; guidance (and with it
    // flare seduction and lock-on) starts once the missile clears CLIMB_ALTITUDE.
    // The climb lasts ~0.5-1.3s and flares only fly near the bomber, so skipping
    // flare retargeting during it is inconsequential.
    if (this.climbing) {
      if (this.position.y < IskanderMissile.CLIMB_ALTITUDE) {
        this.position.y += this.velocity.y * deltaTime;
        this.missileGroup.position.copyFrom(this.position);
        return;
      }
      this.climbing = false; // fall through to guidance this same frame
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
    // diversion and lock-on react within the same frame). Only the mutable
    // fields of the reused payload are refreshed here; flareTargets is the
    // bomber's live array (read-only contract) — guidance only reads x/y/z and
    // never mutates its inputs.
    const d = this.physicsData;
    d.targetPosition = this.targetPosition;
    d.originalTargetPosition = this.originalTargetPosition;
    d.waypoints = this.waypoints;
    d.flareTargets = this.flareTargets;
    d.deltaTime = deltaTime;
    d.pathTime = this.pathTime;
    d.launched = this.launched;
    d.exploded = this.exploded;
    d.currentTime = currentTime;
    d.isTargetingFlare = this.isTargetingFlare;
    d.isLockedOn = this.isLockedOn;
    d.lockSuspended = lockSuspended && !this.isLockedOn;
    d.lockOnTime = this.lockOnTime;
    d.groundHeight = groundHeight;

    this.applyPhysicsResult(updateIskanderMissilePhysics(d));
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

    // Check for lock establishment
    if (result.lockEstablished && this.onLockEstablishedCallback) {
      this.onLockEstablishedCallback();
    }

    // Update visual representation
    this.missileGroup.position.copyFrom(this.position);
    this.missileGroup.rotation.copyFrom(this.rotation);

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

  /**
   * True while the missile is still in its initial vertical boost (below
   * CLIMB_ALTITUDE). Flips false the frame it reaches chase altitude and hands
   * off to guidance. Read live by Rocket View to switch from launch framing to
   * the chase.
   */
  public isClimbing(): boolean {
    return this.climbing;
  }

  public getIsLockedOn(): boolean {
    return this.isLockedOn;
  }

  public getLockProgress(): number {
    return Math.min(this.lockOnTime / this.lockOnDuration, 1.0);
  }

  public dispose(): void {
    // Part materials are shared frozen instances (MissileAssets) — plain
    // dispose() (no disposeMaterialAndTextures) leaves them intact.
    // Flight particle textures are shared via EffectTextures — dispose(false).
    // Particle systems must go BEFORE the group: disposing their emitter mesh
    // would auto-dispose them with disposeTexture=true, killing the shared
    // textures for every later missile/bomb.
    if (this.trailParticles) this.trailParticles.dispose(false);
    if (this.exhaustParticles) this.exhaustParticles.dispose(false);
    if (this.flightSmokeParticles) this.flightSmokeParticles.dispose(false);
    if (this.missileGroup) this.missileGroup.dispose();
    this.lightHandle.release();
  }
}
