import {
  Scene,
  Mesh,
  Vector3,
  MeshBuilder,
  ParticleSystem,
  Color4,
  TransformNode,
  Animation,
  AnimationGroup,
} from '@babylonjs/core';
import { Building } from './Building';
import { MissileAssets } from './MissileAssets';
import { WorkerManager } from '../managers/WorkerManager';
import { LightManager, LightHandle, LightPriority } from '../managers/LightManager';
import { EffectTextures } from '../effects/EffectTextures';
import { ExplosionPool } from '../effects/ExplosionPool';
import { updateTomahawkMissilePhysics, TomahawkMissileData } from '../managers/MissileGuidance';

export class TomahawkMissile {
  private scene: Scene;
  private workerManager: WorkerManager;
  private missileGroup: TransformNode;
  private launchParent: TransformNode; // Parent node that follows bomber during launch
  private fuselage!: Mesh;
  private position: Vector3;
  private velocity: Vector3;
  private rotation: Vector3;
  private targetPosition: Vector3;
  private launchOrigin: Vector3; // immutable copy of the launch point (position mutates after launch); for Rocket View framing
  private targetBuilding: Building | null = null;
  private speed: number = 90; // Cruise missile speed
  private turnRate: number = 1.2; // How fast the missile can turn
  private launched: boolean = false;
  private exploded: boolean = false;

  private exhaustParticles!: ParticleSystem;
  private trailParticles!: ParticleSystem;
  private flightSmokeParticles!: ParticleSystem;
  private lightHandle: LightHandle = LightHandle.inert();
  private launchAnimationGroup!: AnimationGroup;

  // Curved path navigation properties
  private pathStartTime: number = 0;
  private waypoints: Vector3[] = [];

  // Simple curved path following
  private pathTime: number = 0;
  private pathSpeed: number = 0.3; // Speed along the curved path

  // Look-ahead orientation properties
  private lookAheadDistance: number = 0.4; // How far ahead to look on the curve (0-1) - increased for better path following
  private lastSegmentChangeTime: number = 0;
  private orientationUpdateThreshold: number = 0.15; // When to update orientation (segment progress) - increased threshold

  // Flight phase tracking
  private flightPhase: 'FLYBY' | 'TERMINAL' = 'FLYBY';

  // Launch animation phase tracking
  private bomberVelocity: Vector3 = new Vector3(0, 0, 0);
  private inLaunchAnimationPhase: boolean = false;

  // Particle base properties (stored for dynamic updates)
  private baseExhaustEmitRate: number = 80;
  private baseTrailEmitRate: number = 80;
  private baseSmokeEmitRate: number = 30;
  private baseExhaustMinPower: number = 40;
  private baseExhaustMaxPower: number = 70;
  private baseTrailMinPower: number = 2;
  private baseTrailMaxPower: number = 5;
  private baseTrailGravity: Vector3 = new Vector3(0, -1, 0);
  private baseTrailMinSize: number = 0.8;
  private baseTrailMaxSize: number = 2.5;

  // Target destruction callback
  private onTargetDestroyedCallback: ((building: Building) => void) | null = null;

  // Reused per-frame guidance payload — updateTomahawkMissilePhysics reads it
  // synchronously and never mutates it, so one object per missile replaces the
  // fresh literal that was allocated every frame. The vector fields are live
  // references; the ones this class ever REASSIGNS (position, rotation at the
  // end of the launch animation; waypoints from the path worker) are re-pointed
  // in update().
  private readonly physicsData: TomahawkMissileData;

  constructor(
    scene: Scene,
    launchPosition: Vector3,
    targetBuilding: Building,
    launchRotation: Vector3,
    workerManager: WorkerManager,
    bomberVelocity?: Vector3,
  ) {
    this.scene = scene;
    this.workerManager = workerManager;
    this.position = launchPosition.clone();
    this.launchOrigin = launchPosition.clone();
    this.targetBuilding = targetBuilding;
    // Aim for the launcher sitting on top of the building, not the base.
    this.targetPosition = targetBuilding.getPosition().clone();
    this.targetPosition.y += targetBuilding.getMaxHeight();
    this.rotation = launchRotation.clone();
    this.velocity = new Vector3(0, 0, 0); // Start stationary
    this.bomberVelocity = bomberVelocity ? bomberVelocity.clone() : new Vector3(0, 0, 0);

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
      lookAheadDistance: this.lookAheadDistance,
      orientationUpdateThreshold: this.orientationUpdateThreshold,
      lastSegmentChangeTime: 0,
      currentTime: 0,
    };

    // Create parent node that will follow bomber during launch animation
    this.launchParent = new TransformNode('tomahawkLaunchParent', this.scene);
    this.launchParent.position = this.position.clone();
    this.launchParent.rotation = this.rotation.clone();

    // Create missile group as child of launch parent
    this.missileGroup = new TransformNode('tomahawkGroup', this.scene);
    this.missileGroup.parent = this.launchParent;
    this.missileGroup.position = Vector3.Zero(); // Start at parent's position (relative)
    this.missileGroup.rotation = Vector3.Zero(); // Rotation relative to parent

    this.createMissileModel();
    this.setupParticleEffects();
    this.createLaunchAnimation();
    this.generateInitialPath();
    this.missileGroup.getChildMeshes().forEach((m) => (m.isPickable = false));
  }

  private generateInitialPath(): void {
    const pathData = {
      launchPosition: { x: this.position.x, y: this.position.y, z: this.position.z },
      targetPosition: { x: this.targetPosition.x, y: this.targetPosition.y, z: this.targetPosition.z },
      animationOffset: { x: 15, y: -20, z: 15 }, // From launch animation final keyframe
    };

    this.workerManager
      .generateTomahawkPath(pathData)
      .then((result) => {
        this.waypoints = result.waypoints.map((wp: any) => new Vector3(wp.x, wp.y, wp.z));
      })
      .catch(() => {
        // Fallback: use predicted end position
        const predictedEndPosition = this.position.add(new Vector3(15, -20, 15));
        this.waypoints = [predictedEndPosition.clone(), this.targetPosition.clone()];
      });
  }

  private createMissileModel(): void {
    // Part materials are shared frozen instances (MissileAssets) — one set for
    // every Tomahawk ever launched instead of 7 fresh materials per missile.
    const assets = MissileAssets.get(this.scene);

    // Main fuselage - sleek cruise missile body
    this.fuselage = MeshBuilder.CreateCylinder(
      'missileFuselage',
      {
        height: 6,
        diameter: 0.4,
        tessellation: 8,
      },
      this.scene,
    );

    this.fuselage.rotation.x = Math.PI / 2; // Orient horizontally pointing forward
    this.fuselage.parent = this.missileGroup;
    this.fuselage.material = assets.getTomahawkFuselageMaterial();

    // Nose cone
    const noseCone = MeshBuilder.CreateCylinder(
      'noseCone',
      {
        height: 1.5,
        diameterTop: 0,
        diameterBottom: 0.4,
        tessellation: 8,
      },
      this.scene,
    );

    noseCone.position.z = 3.75; // Front of missile
    noseCone.rotation.x = Math.PI / 2;
    noseCone.parent = this.missileGroup;
    noseCone.material = assets.getTomahawkNoseMaterial();

    // Wings - small control surfaces
    this.createWings();

    // Engine nozzle
    const engineNozzle = MeshBuilder.CreateCylinder(
      'engineNozzle',
      {
        height: 1,
        diameter: 0.3,
        tessellation: 8,
      },
      this.scene,
    );

    engineNozzle.position.z = -3.5; // Rear of missile
    engineNozzle.rotation.x = Math.PI / 2;
    engineNozzle.parent = this.missileGroup;
    engineNozzle.material = assets.getTomahawkEngineMaterial();

    // Pooled missile light; follows the missile in world space (never parented)
    this.lightHandle = LightManager.get(this.scene).acquire(LightPriority.MEDIUM);
    this.lightHandle.setColor(1, 0.3, 0);
    this.lightHandle.setIntensity(3);
    this.lightHandle.setRange(80);
    this.lightHandle.setPosition(this.missileGroup.getAbsolutePosition());
  }

  private createWings(): void {
    // Small control fins
    const wingPositions = [
      { pos: new Vector3(0, 0.3, 0), rot: new Vector3(0, 0, 0) },
      { pos: new Vector3(0, -0.3, 0), rot: new Vector3(0, 0, Math.PI) },
      { pos: new Vector3(0, 0, 0.3), rot: new Vector3(0, 0, Math.PI / 2) },
      { pos: new Vector3(0, 0, -0.3), rot: new Vector3(0, 0, -Math.PI / 2) },
    ];

    const wingMaterial = MissileAssets.get(this.scene).getTomahawkWingMaterial();
    wingPositions.forEach((wingData, index) => {
      const wing = MeshBuilder.CreateBox(
        `wing${index}`,
        {
          width: 0.05,
          height: 1.5,
          depth: 0.6,
        },
        this.scene,
      );

      wing.position = wingData.pos;
      wing.rotation = wingData.rot;
      wing.parent = this.missileGroup;
      wing.material = wingMaterial;
    });
  }

  private setupParticleEffects(): void {
    // Optimized engine exhaust particles - reduced count and complexity
    this.exhaustParticles = new ParticleSystem('missileExhaust', 80, this.scene); // Reduced from 150
    this.exhaustParticles.particleTexture = EffectTextures.get(this.scene).getPixelTexture();

    // Create emitter at rear of missile
    const emitterMesh = MeshBuilder.CreateSphere('missileEmitter', { diameter: 0.1 }, this.scene);
    emitterMesh.position = new Vector3(0, 0, -4); // Rear of missile
    emitterMesh.parent = this.missileGroup;
    emitterMesh.isVisible = false;

    this.exhaustParticles.emitter = emitterMesh;
    this.exhaustParticles.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
    this.exhaustParticles.maxEmitBox = new Vector3(0.1, 0.1, 0.1);

    // More dramatic exhaust colors
    this.exhaustParticles.color1 = new Color4(1, 0.4, 0.1, 1.0); // Bright orange
    this.exhaustParticles.color2 = new Color4(1, 0.2, 0.05, 0.9); // Deep orange
    this.exhaustParticles.colorDead = new Color4(0.3, 0.1, 0.02, 0.1);

    this.baseExhaustEmitRate = 80; // Store base value
    this.exhaustParticles.emitRate = this.baseExhaustEmitRate;
    this.exhaustParticles.minLifeTime = 0.3;
    this.exhaustParticles.maxLifeTime = 0.6;
    this.exhaustParticles.minSize = 0.3;
    this.exhaustParticles.maxSize = 1.2;
    this.baseExhaustMinPower = 40;
    this.baseExhaustMaxPower = 70;
    this.exhaustParticles.minEmitPower = this.baseExhaustMinPower;
    this.exhaustParticles.maxEmitPower = this.baseExhaustMaxPower;
    this.exhaustParticles.updateSpeed = 0.01;

    this.exhaustParticles.direction1 = new Vector3(-0.2, -0.1, -1);
    this.exhaustParticles.direction2 = new Vector3(0.2, 0.1, -1);
    this.exhaustParticles.gravity = new Vector3(0, 0, 0);
    this.exhaustParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;

    // Optimized vapor trail particles - reduced count
    this.trailParticles = new ParticleSystem('missileTrail', 150, this.scene); // Reduced from 300
    this.trailParticles.particleTexture = EffectTextures.get(this.scene).getTrailTexture();
    this.trailParticles.emitter = emitterMesh;
    this.trailParticles.minEmitBox = new Vector3(0, 0, 0);
    this.trailParticles.maxEmitBox = new Vector3(0, 0, 0);

    // More distinct trail colors with blue-white tint
    this.trailParticles.color1 = new Color4(0.8, 0.9, 1.0, 0.6); // Bright blue-white
    this.trailParticles.color2 = new Color4(0.6, 0.7, 0.9, 0.4); // Medium blue
    this.trailParticles.colorDead = new Color4(0.2, 0.3, 0.5, 0.0);

    this.baseTrailEmitRate = 80; // Store base value
    this.trailParticles.emitRate = this.baseTrailEmitRate;
    this.trailParticles.minLifeTime = 1.5;
    this.trailParticles.maxLifeTime = 3.0;
    this.baseTrailMinSize = 0.8;
    this.baseTrailMaxSize = 2.5;
    this.trailParticles.minSize = this.baseTrailMinSize;
    this.trailParticles.maxSize = this.baseTrailMaxSize;
    this.baseTrailMinPower = 2;
    this.baseTrailMaxPower = 5;
    this.trailParticles.minEmitPower = this.baseTrailMinPower;
    this.trailParticles.maxEmitPower = this.baseTrailMaxPower;
    this.trailParticles.updateSpeed = 0.01;

    this.trailParticles.direction1 = new Vector3(0, 0, -0.2);
    this.trailParticles.direction2 = new Vector3(0, 0, 0.2);
    this.trailParticles.gravity = new Vector3(0, -1, 0);
    this.trailParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    // Optimized smoke trail - reduced count
    this.flightSmokeParticles = new ParticleSystem('missileSmoke', 50, this.scene); // Reduced from 100
    this.flightSmokeParticles.particleTexture = EffectTextures.get(this.scene).getSmokeTexture();
    this.flightSmokeParticles.emitter = emitterMesh;
    this.flightSmokeParticles.minEmitBox = new Vector3(0, 0, 0);
    this.flightSmokeParticles.maxEmitBox = new Vector3(0, 0, 0);

    this.flightSmokeParticles.color1 = new Color4(0.4, 0.4, 0.4, 0.3);
    this.flightSmokeParticles.color2 = new Color4(0.6, 0.6, 0.6, 0.2);
    this.flightSmokeParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);

    this.baseSmokeEmitRate = 30; // Store base value
    this.flightSmokeParticles.emitRate = this.baseSmokeEmitRate;
    this.flightSmokeParticles.minLifeTime = 2.0;
    this.flightSmokeParticles.maxLifeTime = 4.0;
    this.flightSmokeParticles.minSize = 1.0;
    this.flightSmokeParticles.maxSize = 3.0;
    this.flightSmokeParticles.minEmitPower = 1;
    this.flightSmokeParticles.maxEmitPower = 3;
    this.flightSmokeParticles.updateSpeed = 0.01;

    this.flightSmokeParticles.direction1 = new Vector3(0, 0, -0.1);
    this.flightSmokeParticles.direction2 = new Vector3(0, 0, 0.1);
    this.flightSmokeParticles.gravity = new Vector3(0, -0.5, 0);
    this.flightSmokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  }

  private updateParticleEffects(flightPhase: 'FLYBY' | 'TERMINAL'): void {
    if (flightPhase === 'TERMINAL') {
      // Terminal descent: Increase exhaust intensity, intensify trail, reduce smoke
      this.exhaustParticles.emitRate = this.baseExhaustEmitRate * 1.5; // 50% more exhaust
      this.exhaustParticles.minEmitPower = this.baseExhaustMinPower * 1.2;
      this.exhaustParticles.maxEmitPower = this.baseExhaustMaxPower * 1.2;
      
      // Add slight forward component to exhaust during dive
      this.exhaustParticles.direction1 = new Vector3(-0.2, -0.2, -1.1);
      this.exhaustParticles.direction2 = new Vector3(0.2, -0.2, -1.1);
      
      // Trail: Increase intensity and size
      this.trailParticles.emitRate = this.baseTrailEmitRate * 1.2; // 20% more trail
      this.trailParticles.minSize = this.baseTrailMinSize * 1.3;
      this.trailParticles.maxSize = this.baseTrailMaxSize * 1.3;
      this.trailParticles.minEmitPower = this.baseTrailMinPower * 1.2;
      this.trailParticles.maxEmitPower = this.baseTrailMaxPower * 1.2;
      
      // Increase gravity effect during dive (steeper fall)
      this.trailParticles.gravity = new Vector3(0, -2.0, 0); // Doubled gravity
      
      // Smoke: Reduce during terminal descent
      this.flightSmokeParticles.emitRate = this.baseSmokeEmitRate * 0.5; // 50% less smoke
    } else {
      // Flyby phase: Normal emission rates
      this.exhaustParticles.emitRate = this.baseExhaustEmitRate;
      this.exhaustParticles.minEmitPower = this.baseExhaustMinPower;
      this.exhaustParticles.maxEmitPower = this.baseExhaustMaxPower;
      this.exhaustParticles.direction1 = new Vector3(-0.2, -0.1, -1);
      this.exhaustParticles.direction2 = new Vector3(0.2, 0.1, -1);
      
      this.trailParticles.emitRate = this.baseTrailEmitRate;
      this.trailParticles.minSize = this.baseTrailMinSize;
      this.trailParticles.maxSize = this.baseTrailMaxSize;
      this.trailParticles.minEmitPower = this.baseTrailMinPower;
      this.trailParticles.maxEmitPower = this.baseTrailMaxPower;
      this.trailParticles.gravity = this.baseTrailGravity.clone();
      
      this.flightSmokeParticles.emitRate = this.baseSmokeEmitRate;
    }
  }

  private createLaunchAnimation(): void {
    // Create launch animation that moves missile from launcher to flight path
    // Animation is relative to parent (launchParent), so use relative offsets
    const launchAnimation = new Animation(
      'missileLaunch',
      'position',
      30,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );

    // Start at origin (relative to parent), then move forward and establish cruise altitude
    // All positions are relative to the launch parent
    const keys = [
      { frame: 0, value: Vector3.Zero() }, // Start at parent position
      { frame: 15, value: new Vector3(5, -10, 5) }, // Move forward and down
      { frame: 30, value: new Vector3(10, -15, 10) }, // Continue forward and establish cruise altitude
      { frame: 60, value: new Vector3(15, -20, 15) }, // Final launch position
    ];

    launchAnimation.setKeys(keys);

    this.launchAnimationGroup = new AnimationGroup('missileLaunchGroup');
    this.launchAnimationGroup.addTargetedAnimation(launchAnimation, this.missileGroup);
  }

  public launch(): void {
    if (this.launched) return;

    this.launched = true;
    this.inLaunchAnimationPhase = true;

    // Start trail particles immediately
    this.trailParticles.start();

    // Play launch animation first
    this.launchAnimationGroup.play(false);

    // Start guided flight immediately after animation completes without delay
    this.launchAnimationGroup.onAnimationGroupEndObservable.add(() => {
      this.inLaunchAnimationPhase = false;
      this.startGuidedFlight();
    });
  }

  private startGuidedFlight(): void {
    // Update position to current absolute missile group position after animation
    // Get absolute position since missileGroup is now a child
    this.position = this.missileGroup.getAbsolutePosition().clone();
    
    // Rotation is already correct since missileGroup rotation is relative to parent
    // and parent has the initial rotation, so absolute rotation = parent rotation
    // We'll use the parent's rotation since missileGroup rotation is zero relative to parent
    this.rotation = this.launchParent.rotation.clone();
    
    // Remove parent relationship - missileGroup now controls its own position and rotation
    this.missileGroup.parent = null;
    this.missileGroup.position = this.position.clone();
    this.missileGroup.rotation = this.rotation.clone();

    // Start remaining particle effects now that launch animation is complete
    this.pathStartTime = performance.now() / 1000;
    this.exhaustParticles.start();
    this.flightSmokeParticles.start();

    // Initialize path time for curved navigation (path is already generated)
    this.pathTime = 0.01; // Small offset to start on curved path
    this.lastSegmentChangeTime = performance.now() / 1000;

    // Initialize particle effects for flyby phase
    this.flightPhase = 'FLYBY';
    this.updateParticleEffects(this.flightPhase);
  }

  public update(deltaTime: number): void {
    if (!this.launched || this.exploded) return;

    // World-space follow (covers both the parented launch animation and free flight)
    this.lightHandle.setPosition(this.missileGroup.getAbsolutePosition());

    const currentTime = performance.now() / 1000;

    // During launch animation phase, move parent node with bomber's velocity
    // The animation runs on missileGroup (child), so it naturally combines with parent movement
    if (this.inLaunchAnimationPhase) {
      // Ride the launch rail with the bomber.
      this.bomberVelocity.scaleAndAddToRef(deltaTime, this.launchParent.position);
      // Keep the reported position honest: sync to the VISIBLE mesh (parent follow +
      // Babylon drop animation). scene.animate() runs before this before-render
      // callback, so this is the exact position rendered this frame — the belly cam
      // aims at getPositionRef() and now tracks the drop.
      this.position.copyFrom(this.missileGroup.getAbsolutePosition());
      return; // Don't update physics during launch animation
    }

    // Per-frame guidance runs on the main thread (a few dozen flops; no
    // round-trip latency, no snap-on-apply). The episodic path generation
    // stays in the worker (generateInitialPath). Only the mutable fields of
    // the reused payload are refreshed here.
    const d = this.physicsData;
    d.position = this.position;
    d.rotation = this.rotation;
    d.waypoints = this.waypoints;
    d.deltaTime = deltaTime;
    d.pathTime = this.pathTime;
    d.launched = this.launched;
    d.exploded = this.exploded;
    d.lastSegmentChangeTime = this.lastSegmentChangeTime;
    d.currentTime = currentTime;

    this.applyPhysicsResult(updateTomahawkMissilePhysics(d));
  }

  private applyPhysicsResult(result: any): void {
    if (!result || this.exploded) return;

    // Apply new position, velocity, and rotation from worker
    this.position.set(result.position.x, result.position.y, result.position.z);
    this.velocity.set(result.velocity.x, result.velocity.y, result.velocity.z);
    this.rotation.set(result.rotation.x, result.rotation.y, result.rotation.z);

    // Update path state
    if (result.pathTime !== undefined) {
      this.pathTime = result.pathTime;
    }
    if (result.lastSegmentChangeTime !== undefined) {
      this.lastSegmentChangeTime = result.lastSegmentChangeTime;
    }

    // Update flight phase and particle effects if phase changed
    if (result.flightPhase && result.flightPhase !== this.flightPhase) {
      this.flightPhase = result.flightPhase;
      this.updateParticleEffects(this.flightPhase);
    }

    // Apply transforms
    this.missileGroup.position.copyFrom(this.position);
    this.missileGroup.rotation.copyFrom(this.rotation);

    // Check for explosion from worker
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

    ExplosionPool.get(this.scene).explode(this.position, 1);

    // Knock out only the launcher and set the building ablaze; full destruction is reserved for
    // bombing. The missile is dedicated to one target, so ignite whenever it detonates near that
    // building's footprint, measured horizontally (XZ) so a ground-level OR rooftop detonation
    // both count.
    if (this.targetBuilding) {
      const base = this.targetBuilding.getPosition();
      const dx = this.position.x - base.x;
      const dz = this.position.z - base.z;
      const horizontalDist = Math.sqrt(dx * dx + dz * dz);
      const hitRadius = Math.max(this.targetBuilding.getMaxHeight() * 0.5, 30); // generous, footprint-scaled
      if (horizontalDist <= hitRadius) {
        // isDefenseLauncher() flips false once the launcher is destroyed, so
        // sampling it before destroyLauncher() tells us whether THIS missile
        // scored the kill (vs. a bomb or an earlier missile getting there first).
        const launcherWasAlive = this.targetBuilding.isDefenseLauncher();
        this.targetBuilding.destroyLauncher();
        if (launcherWasAlive && this.onTargetDestroyedCallback) {
          this.onTargetDestroyedCallback(this.targetBuilding);
        }
      }
    }

    // Hide the whole missile model (nose, wings and nozzle are siblings of the
    // fuselage, not children); the stopped flight particle systems are disposed
    // by the bomber's exploded-missile sweep via dispose() ~10s later.
    this.missileGroup.setEnabled(false);
  }

  public hasExploded(): boolean {
    return this.exploded;
  }

  /** Read-only reference to the internal position — callers must not mutate it. */
  public getPositionRef(): Vector3 {
    return this.position;
  }

  /** Read-only reference to the internal velocity — callers must not mutate it. */
  public getVelocityRef(): Vector3 {
    return this.velocity;
  }

  /** True only during the ~2s bomb-bay pop-up — the catch-at-launch window for Rocket View. */
  public isInLaunchPhase(): boolean {
    return this.inLaunchAnimationPhase;
  }

  /** Immutable original launch point (position mutates after launch). For Rocket View framing. */
  public getLaunchPosition(): Vector3 {
    return this.launchOrigin;
  }

  /** Target impact point (launcher atop the building). For Rocket View framing. */
  public getTargetPosition(): Vector3 {
    return this.targetPosition;
  }

  public dispose(): void {
    // Part materials are shared frozen instances (MissileAssets) — plain
    // dispose() (no disposeMaterialAndTextures) leaves them intact.
    // Flight particle textures are shared via EffectTextures — dispose(false).
    // Particle systems must go BEFORE the mesh hierarchy: disposing their emitter
    // mesh would auto-dispose them with disposeTexture=true, killing the shared
    // textures for every later missile/bomb.
    if (this.trailParticles) this.trailParticles.dispose(false);
    if (this.exhaustParticles) this.exhaustParticles.dispose(false);
    if (this.flightSmokeParticles) this.flightSmokeParticles.dispose(false);
    if (this.missileGroup) this.missileGroup.dispose();
    if (this.launchParent) this.launchParent.dispose();
    this.lightHandle.release();
    if (this.launchAnimationGroup) this.launchAnimationGroup.dispose();
  }

  public setOnTargetDestroyedCallback(callback: (building: Building) => void): void {
    this.onTargetDestroyedCallback = callback;
  }
}
