import {
  Scene,
  Mesh,
  Vector3,
  Color3,
  Color4,
  StandardMaterial,
  MeshBuilder,
  TransformNode,
  ParticleSystem,
  Texture,
  PointLight,
  DynamicTexture,
} from '@babylonjs/core';
import { InputManager } from '../managers/InputManager';
import { TomahawkMissile } from './TomahawkMissile';
import { TerrainManager } from '../managers/TerrainManager';
import { WorkerManager } from '../managers/WorkerManager';
import { Building } from './Building';
import { LightManager, LightHandle, LightPriority } from '../managers/LightManager';
import { EffectTextures } from '../effects/EffectTextures';

export class Bomber {
  private scene: Scene;
  private workerManager: WorkerManager;
  private isBombingRunActiveCallback: (() => boolean) | null = null; // Callback to check bombing run status
  private bomberGroup!: TransformNode;
  private position: Vector3;
  private rotation: Vector3;
  private velocity: Vector3;
  private speed: number = 25; // Units per second
  private altitude: number = 175; // Spawn mid-band between minimumAltitude and maximumAltitude
  private turnSpeed: number = 0.5; // Radians per second
  private climbRate: number = 20; // Units per second
  private particleSystems: ParticleSystem[] = []; // Engine exhaust particle systems
  private bombBayLeft!: Mesh;
  private bombBayRight!: Mesh;

  // Bomb bay state tracking
  private bombBayState: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
  private bombBayOpenProgress: number = 0; // 0 = closed, 1 = fully open
  private bombBayOpenTime: number = 1.0; // Time in seconds for doors to fully open
  private bombBayOpenStartTime: number = 0;
  // Single pooled bay light replaces the former 3 permanent PointLights; pooled
  // lights are never parented, so its world position is recomputed each frame.
  private bombBayLightHandle: LightHandle = LightHandle.inert();
  private static readonly bayLightLocalOffset = new Vector3(0, -2, -5);
  private readonly bayLightWorldPos = new Vector3();
  private bombBayParticles: ParticleSystem[] = [];
  private bombBayGlowMaterial: StandardMaterial | null = null;
  private bombBayBaseMaterial: StandardMaterial | null = null;
  private missileLaunchPending: boolean = false; // Track if missile launch is waiting for bomb bay to open

  // Banking/roll properties for realistic turning
  private maxBankAngle: number = Math.PI / 6; // 30 degrees max bank (symmetric)
  private maxClimbBankAngle: number = Math.PI / 12; // 15 degrees for altitude changes (symmetric)
  private bankSpeed: number = 2.5; // How quickly the bomber banks into turns (slightly faster for responsiveness)
  private currentBankAngle: number = 0; // Current roll angle
  private targetBankAngle: number = 0; // Target roll angle
  // Floor sits well above any defense-missile launch point: launchers top out at
  // 63 (building height <= 60, pinned to ground y=0, + 3 muzzle offset) and aim
  // points carry up to +-40 error, so 150 keeps every launched missile climbing
  // toward the bomber — no altitude slips under the threat envelope.
  private minimumAltitude: number = 150;
  // Ceiling matches the defense missiles' former airburst altitude; they now fly
  // higher than this before bursting, so there is no safe altitude above the
  // envelope either. Also keeps the camera from revealing far terrain.
  private maximumAltitude: number = 200;

  // Tomahawk missile system
  private missiles: TomahawkMissile[] = [];
  private missileExplodedAt: Map<TomahawkMissile, number> = new Map();
  private lastMissileLaunchTime: number = -Infinity;
  private missileCooldownTime: number = 10; // 10 seconds cooldown
  private terrainManager: TerrainManager | null = null; // Reference to terrain manager for targeting

  // Target detection caching for performance

  // Performance optimizations: cache trigonometric calculations
  private lastRotationY: number = 0;
  private cachedSinY: number = 0;
  private cachedCosY: number = 1;
  private trigCacheValid: boolean = false;

  // Reusable vector to avoid object creation
  private tempVector: Vector3 = new Vector3();
  private tempRotation: Vector3 = new Vector3();

  // Health system
  private health: number = 100;
  private maxHealth: number = 100;
  private isDestroyed: boolean = false;
  private damageEffects: ParticleSystem[] = [];
  private damageLight: PointLight | null = null;
  private lastDamageTime: number = 0;
  private damageEffectDuration: number = 2.0; // Damage effects last 2 seconds
  private onDestroyedCallback: (() => void) | null = null;

  // Countermeasure flare system
  private flareCooldown: number = 8; // 8 seconds cooldown
  private lastFlareTime: number = -Infinity;
  private activeFlares: Array<{
    position: Vector3;
    velocity: Vector3;
    lifetime: number;
    maxLifetime: number;
    mesh: Mesh;
    particles: ParticleSystem;
  }> = [];
  // One pooled light per flare volley, positioned at the centroid of active flares
  private flareVolleyLightHandle: LightHandle = LightHandle.inert();
  // Long enough to still be burning after a fall from cruise altitude (~4.5s);
  // must stay below flareCooldown so the pool fully recycles between volleys
  private flareLifetime: number = 7;
  private flareParticleSystems: ParticleSystem[] = []; // Visual effects for flares
  private flareMeshes: Mesh[] = []; // Visual flare meshes
  // Shared by every flare for the bomber's lifetime (flares are frequent and identical)
  private flareMaterial: StandardMaterial | null = null;
  // Reusable {mesh, particles} pairs — one volley is 8 flares, and the 8s cooldown
  // exceeds the 5s flare lifetime, so the pool fully recycles between volleys.
  // Built lazily on first deployFlare.
  private flarePool: Array<{ mesh: Mesh; particles: ParticleSystem }> = [];
  private flarePoolBuilt: boolean = false;
  private static readonly FLARE_POOL_SIZE = 8;

  // Target destruction callback
  private onTargetDestroyedCallback: ((building: Building) => void) | null = null;

  constructor(scene: Scene, workerManager: WorkerManager) {
    this.scene = scene;
    this.workerManager = workerManager;
    this.position = new Vector3(0, this.altitude, 0);
    this.rotation = new Vector3(0, 0, 0);
    this.velocity = new Vector3(0, 0, this.speed);

    this.createBomberMesh();
    this.setupDamageEffects();
  }

  private createBomberMesh(): void {
    this.bomberGroup = new TransformNode('bomberGroup', this.scene);
    this.bomberGroup.position = this.position.clone();

    // Create bomber-like shape
    this.createFuselage();
    this.createWings();
    this.createCockpit();
    this.createEngines();
    this.createBombBay();

    // The player's plane is always near the camera: never pointer-picked, and
    // never worth frustum-testing mesh by mesh.
    for (const childMesh of this.bomberGroup.getChildMeshes()) {
      childMesh.isPickable = false;
      childMesh.alwaysSelectAsActiveMesh = true;
    }
  }

  private createFuselage(): void {
    // Main body - cylindrical shape instead of box
    const fuselage = MeshBuilder.CreateCylinder(
      'fuselage',
      {
        height: 22,
        diameter: 3,
        tessellation: 16,
      },
      this.scene,
    );

    fuselage.rotation.x = Math.PI / 2; // Orient horizontally
    fuselage.position.y = 0;
    fuselage.parent = this.bomberGroup;

    const fuselageMaterial = new StandardMaterial('fuselageMaterial', this.scene);
    fuselageMaterial.diffuseColor = new Color3(0.15, 0.18, 0.2);
    fuselageMaterial.specularColor = new Color3(0.3, 0.3, 0.4);
    fuselageMaterial.emissiveColor = new Color3(0.05, 0.05, 0.08);
    fuselage.material = fuselageMaterial;

    // Conical nose cone
    const noseCone = MeshBuilder.CreateCylinder(
      'noseCone',
      {
        height: 6,
        diameterTop: 0,
        diameterBottom: 3,
        tessellation: 16,
      },
      this.scene,
    );

    noseCone.rotation.x = Math.PI / 2; // Orient horizontally
    noseCone.position.z = 14; // Front of fuselage
    noseCone.parent = this.bomberGroup;

    const noseMaterial = new StandardMaterial('noseMaterial', this.scene);
    noseMaterial.diffuseColor = new Color3(0.12, 0.15, 0.18); // Slightly darker than fuselage
    noseMaterial.specularColor = new Color3(0.4, 0.4, 0.5);
    noseMaterial.emissiveColor = new Color3(0.03, 0.03, 0.05);
    noseCone.material = noseMaterial;
  }

  private createWings(): void {
    // Main wing - triangular swept wing characteristic of stealth bomber
    const wingLeft = MeshBuilder.CreateBox(
      'wingLeft',
      {
        width: 30,
        height: 0.4,
        depth: 6,
      },
      this.scene,
    );

    wingLeft.position.x = -13;
    wingLeft.position.y = -0.5;
    wingLeft.position.z = -3;
    wingLeft.rotation.y = -Math.PI * 0.15; // More sweep
    wingLeft.parent = this.bomberGroup;

    const wingLeftSmall = MeshBuilder.CreateBox(
      'wingLeftSmall',
      {
        width: 5,
        height: 0.4,
        depth: 3,
      },
      this.scene,
    );

    wingLeftSmall.position.x = -3;
    wingLeftSmall.position.z = -10;
    wingLeftSmall.rotation.y = -Math.PI * 0.15; // More sweep
    wingLeftSmall.parent = this.bomberGroup;

    const wingRight = MeshBuilder.CreateBox(
      'wingRight',
      {
        width: 30,
        height: 0.4,
        depth: 6,
      },
      this.scene,
    );

    wingRight.position.x = 13;
    wingRight.position.y = -0.5;
    wingRight.position.z = -3;
    wingRight.rotation.y = Math.PI * 0.15; // More sweep
    wingRight.parent = this.bomberGroup;

    const wingRightSmall = MeshBuilder.CreateBox(
      'wingRightSmall',
      {
        width: 5,
        height: 0.4,
        depth: 3,
      },
      this.scene,
    );

    wingRightSmall.position.x = 3;
    wingRightSmall.position.z = -10;
    wingRightSmall.rotation.y = Math.PI * 0.15; // More sweep
    wingRightSmall.parent = this.bomberGroup;

    const topWingSmall = MeshBuilder.CreateBox(
      'topWingSmall',
      {
        width: 5,
        height: 0.4,
        depth: 3,
      },
      this.scene,
    );

    topWingSmall.position.x = 0;
    topWingSmall.position.z = -10;
    topWingSmall.position.y = 2;
    topWingSmall.rotation.z = Math.PI / 2;
    topWingSmall.rotation.x = -Math.PI / 4;
    topWingSmall.parent = this.bomberGroup;

    const wingMaterial = new StandardMaterial('wingMaterial', this.scene);
    wingMaterial.diffuseColor = new Color3(0.12, 0.15, 0.18);
    wingMaterial.specularColor = new Color3(0.2, 0.2, 0.3);
    wingMaterial.emissiveColor = new Color3(0.04, 0.04, 0.06);
    wingLeft.material = wingMaterial;
    wingRight.material = wingMaterial;
    wingLeftSmall.material = wingMaterial;
    wingRightSmall.material = wingMaterial;
    topWingSmall.material = wingMaterial;
  }

  private createCockpit(): void {
    // Create a small hemisphere for the cockpit
    const cockpit = MeshBuilder.CreateSphere(
      'cockpit',
      {
        diameter: 2,
        segments: 16,
      },
      this.scene,
    );

    // Scale it to make it more hemisphere-like (flatten the bottom)
    cockpit.scaling.y = 0.5;

    // Position it on top of the cylindrical fuselage, slightly forward
    cockpit.position.x = 0;
    cockpit.position.y = 1.2; // Above the cylindrical fuselage (radius is 1.5)
    cockpit.position.z = 11; // Forward on the fuselage, but not as far as before
    cockpit.parent = this.bomberGroup;

    // Create cockpit material - turquoise blue with some transparency
    const cockpitMaterial = new StandardMaterial('cockpitMaterial', this.scene);
    cockpitMaterial.diffuseColor = new Color3(0.0, 0.5, 0.5);
    cockpitMaterial.specularColor = new Color3(0.2, 0.8, 0.8);
    cockpitMaterial.emissiveColor = new Color3(0.0, 0.3, 0.3);
    cockpitMaterial.alpha = 0.8; // Slightly transparent for glass effect
    cockpit.material = cockpitMaterial;
  }

  private createBombBay(): void {
    // Kept for the bay's whole lifetime so closing the bay swaps back to this
    // exact instance instead of allocating a replacement material per close
    this.bombBayBaseMaterial = new StandardMaterial('bayMaterial', this.scene);
    const bayMaterial = this.bombBayBaseMaterial;
    bayMaterial.diffuseColor = new Color3(0.1, 0.1, 0.12);
    bayMaterial.specularColor = new Color3(0.3, 0.3, 0.4);
    bayMaterial.emissiveColor = new Color3(0.02, 0.02, 0.03);

    // Create bomb bay doors that open outward and downward
    // Left door - positioned on the left side of the cylindrical fuselage
    this.bombBayLeft = MeshBuilder.CreateBox('bombBayLeft', { width: 2.0, height: 0.3, depth: 10 }, this.scene);
    this.bombBayLeft.position = new Vector3(-1.2, -1.2, -3); // Further out and lower for cylindrical fuselage
    this.bombBayLeft.parent = this.bomberGroup;
    this.bombBayLeft.material = bayMaterial;
    // Set pivot point for rotation (left edge of door)
    this.bombBayLeft.rotation.z = 0; // Will rotate around Z axis for outward swing

    // Right door - positioned on the right side of the cylindrical fuselage
    this.bombBayRight = MeshBuilder.CreateBox('bombBayRight', { width: 2.0, height: 0.3, depth: 10 }, this.scene);
    this.bombBayRight.position = new Vector3(1.2, -1.2, -3); // Further out and lower for cylindrical fuselage
    this.bombBayRight.parent = this.bomberGroup;
    this.bombBayRight.material = bayMaterial;
    // Set pivot point for rotation (right edge of door)
    this.bombBayRight.rotation.z = 0; // Will rotate around Z axis for outward swing

    // Create bomb bay particle effects
    this.createBombBayParticles();

    // Create glow material for when bay is open
    this.createBombBayGlowMaterial();
  }

  private createBombBayParticles(): void {
    // Create procedural particle texture
    const particleTexture = new DynamicTexture('bombBayParticleTexture', { width: 32, height: 32 }, this.scene);
    const particleContext = particleTexture.getContext();

    // Create bright particle effect
    const particleGradient = particleContext.createRadialGradient(16, 16, 0, 16, 16, 16);
    particleGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    particleGradient.addColorStop(0.5, 'rgba(255, 200, 100, 0.8)');
    particleGradient.addColorStop(1, 'rgba(255, 150, 50, 0)');

    particleContext.fillStyle = particleGradient;
    particleContext.fillRect(0, 0, 32, 32);
    particleTexture.update();

    // Create particle system for bomb bay effects
    const bayParticles = new ParticleSystem('bombBayParticles', 100, this.scene);
    bayParticles.particleTexture = particleTexture;
    bayParticles.emitter = this.bomberGroup.position.add(new Vector3(0, -2, -3));
    bayParticles.minEmitBox = new Vector3(-1, 0, -2);
    bayParticles.maxEmitBox = new Vector3(1, 0, 2);

    bayParticles.color1 = new Color4(1, 0.9, 0.6, 1.0);
    bayParticles.color2 = new Color4(1, 0.7, 0.3, 0.8);
    bayParticles.colorDead = new Color4(1, 0.5, 0.1, 0.0);

    bayParticles.minSize = 0.2;
    bayParticles.maxSize = 0.8;
    bayParticles.minLifeTime = 0.5;
    bayParticles.maxLifeTime = 1.0;
    bayParticles.emitRate = 0; // Start stopped
    bayParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    bayParticles.gravity = new Vector3(0, -1, 0);
    bayParticles.direction1 = new Vector3(-0.5, 0.5, -0.5);
    bayParticles.direction2 = new Vector3(0.5, 1, 0.5);
    bayParticles.minEmitPower = 1;
    bayParticles.maxEmitPower = 3;
    bayParticles.updateSpeed = 0.01;

    this.bombBayParticles.push(bayParticles);
  }

  private createBombBayGlowMaterial(): void {
    this.bombBayGlowMaterial = new StandardMaterial('bombBayGlowMaterial', this.scene);
    this.bombBayGlowMaterial.diffuseColor = new Color3(0.15, 0.15, 0.18);
    this.bombBayGlowMaterial.specularColor = new Color3(0.5, 0.5, 0.6);
    this.bombBayGlowMaterial.emissiveColor = new Color3(0.1, 0.08, 0.12); // Subtle glow
    this.bombBayGlowMaterial.alpha = 0.9;
  }

  private createEngines(): void {
    // Engine nacelles embedded in wings
    const positions = [
      new Vector3(-11, -0.8, -5),
      new Vector3(-20, -0.8, -9),
      new Vector3(11, -0.8, -5),
      new Vector3(20, -0.8, -9),
    ];

    positions.forEach((pos, index) => {
      const engine = MeshBuilder.CreateCylinder(
        `engine${index}`,
        {
          height: 4,
          diameter: 2,
        },
        this.scene,
      );

      engine.position = pos;
      engine.rotation.x = Math.PI / 2;
      engine.parent = this.bomberGroup;

      const engineMaterial = new StandardMaterial(`engineMaterial${index}`, this.scene);
      engineMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1); // Very dark
      engine.material = engineMaterial;

      // Add exhaust effect
      const exhaust = MeshBuilder.CreateCylinder(
        `exhaust${index}`,
        {
          height: 2,
          diameterTop: 1.5,
          diameterBottom: 0,
        },
        this.scene,
      );

      exhaust.position = pos.add(new Vector3(0, 0, -3));
      exhaust.rotation.x = Math.PI / 2;
      exhaust.parent = this.bomberGroup;

      const exhaustMaterial = new StandardMaterial(`exhaustMaterial${index}`, this.scene);
      exhaustMaterial.diffuseColor = new Color3(0.3, 0.1, 0.05); // Dark reddish
      exhaustMaterial.emissiveColor = new Color3(0.2, 0.05, 0.01); // Glowing effect
      exhaust.material = exhaustMaterial;

      // Create particle system for engine exhaust
      this.createEngineParticleSystem(pos, index);
    });
  }

  private createEngineParticleSystem(enginePos: Vector3, index: number): void {
    const particleSystem = new ParticleSystem(`engineExhaust${index}`, 50, this.scene);

    // Create a simple particle texture - using a basic white texture
    particleSystem.particleTexture = new Texture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      this.scene,
    );

    // Create a dummy mesh as emitter at the exact engine exhaust position
    const emitterMesh = MeshBuilder.CreateSphere(`emitter${index}`, { diameter: 0.1 }, this.scene);
    emitterMesh.position = enginePos.add(new Vector3(0, 0, -3)); // Closer to engine, less offset
    emitterMesh.parent = this.bomberGroup;
    emitterMesh.isVisible = false; // Hide the emitter mesh

    // Configure particle emitter - horizontal emit box only
    particleSystem.emitter = emitterMesh;
    particleSystem.minEmitBox = new Vector3(-0.2, 0, -0.2); // No downward component (Y=0)
    particleSystem.maxEmitBox = new Vector3(0.2, 0, 0.2); // No upward component (Y=0)

    // Particle properties for visible exhaust trail
    particleSystem.color1 = new Color4(0.8, 0.4, 0.2, 1.0); // Bright orange
    particleSystem.color2 = new Color4(0.6, 0.3, 0.1, 0.8); // Orange-brown
    particleSystem.colorDead = new Color4(0.2, 0.1, 0.05, 0.1); // Dark with low alpha

    // Emission rate and lifetime - quick disappearing trails
    particleSystem.emitRate = 50; // Higher emission rate for better visibility
    particleSystem.minLifeTime = 0.1; // Very short lived particles
    particleSystem.maxLifeTime = 0.3; // Quick disappearance

    // Size - slightly larger particles for visibility
    particleSystem.minSize = 0.4;
    particleSystem.maxSize = 1.0;

    // Speed and direction - emit fast and straight
    particleSystem.minEmitPower = 20;
    particleSystem.maxEmitPower = 30;
    particleSystem.updateSpeed = 0.02;

    // Set fixed backward direction in local space - this will rotate with the emitter
    particleSystem.direction1 = new Vector3(-0.02, 0.1, -1);
    particleSystem.direction2 = new Vector3(0.02, 0.1, -1);

    // No gravity - particles shoot straight out
    particleSystem.gravity = new Vector3(0, 0, 0);

    // Blend mode for visible appearance
    particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;

    // Start the particle system
    particleSystem.start();

    // Store reference for updates
    this.particleSystems.push(particleSystem);
  }

  public setMinimumAltitude(minAltitude: number): void {
    this.altitude = Math.max(this.altitude, minAltitude + 10); // 10 unit safety margin
  }

  public update(deltaTime: number, inputManager: InputManager): void {
    // Handle turning (left/right arrows) and banking
    // Only turn if Right Shift is NOT pressed (Right Shift + arrows is for camera panning)
    // AND if Ctrl is NOT pressed (Ctrl + arrows is for camera distance)
    let isTurning = false;
    let isClimbing = false;
    let isDiving = false;

    // Handle touch controls for bomber movement (single finger swipe)
    if (inputManager.getIsTouchActive() && !inputManager.getIsTouchCamera()) {
      const touchDeltaX = inputManager.getBomberTouchDeltaX();
      const touchDeltaY = inputManager.getBomberTouchDeltaY();
      const touchSensitivity = 0.001; // Adjust sensitivity for bomber

      // Touch X controls turning (not inverted)
      if (Math.abs(touchDeltaX) > 0) {
        this.rotation.y += touchDeltaX * touchSensitivity; // Right swipe turns right
        this.targetBankAngle = touchDeltaX > 0 ? this.maxBankAngle : -this.maxBankAngle;
        isTurning = true;
        this.trigCacheValid = false;
      }

      // Touch Y controls altitude (not inverted)
      if (Math.abs(touchDeltaY) > 0) {
        this.altitude += touchDeltaY * touchSensitivity * 100; // Down swipe climbs
        if (touchDeltaY > 0) {
          isClimbing = true;
          if (!isTurning) {
            this.targetBankAngle = this.maxClimbBankAngle;
          }
        } else {
          isDiving = true;
          if (!isTurning) {
            this.targetBankAngle = -this.maxClimbBankAngle;
          }
        }
      }
    }

    if (inputManager.getTurnLeftPressed()) {
      this.rotation.y -= this.turnSpeed * deltaTime; // A key turns left
      this.targetBankAngle = -this.maxBankAngle; // Bank left
      isTurning = true;
      this.trigCacheValid = false; // Invalidate cache when turning
    }
    if (inputManager.getTurnRightPressed()) {
      this.rotation.y += this.turnSpeed * deltaTime; // D key turns right
      this.targetBankAngle = this.maxBankAngle; // Bank right
      isTurning = true;
      this.trigCacheValid = false; // Invalidate cache when turning
    }

    // Handle altitude changes with W/S keys with banking
    if (inputManager.isAltitudeUpPressed()) {
      this.altitude += this.climbRate * deltaTime; // W key increases altitude
      isClimbing = true;
      // If not already turning, add slight banking for climb
      if (!isTurning) {
        this.targetBankAngle = this.maxClimbBankAngle; // Slight right bank during climb
      }
    }
    if (inputManager.isAltitudeDownPressed()) {
      this.altitude -= this.climbRate * deltaTime; // S key decreases altitude
      isDiving = true;
      // If not already turning, add slight banking for dive
      if (!isTurning) {
        this.targetBankAngle = -this.maxClimbBankAngle; // Slight left bank during dive
      }
    }

    // If not turning, climbing, or diving, return to level flight
    if (!isTurning && !isClimbing && !isDiving) {
      this.targetBankAngle = 0;
    }

    // Smoothly interpolate current bank angle toward target
    const bankDifference = this.targetBankAngle - this.currentBankAngle;
    this.currentBankAngle += bankDifference * this.bankSpeed * deltaTime;

    // Keep altitude within bounds - above terrain (min) and below the climb cap (max)
    this.altitude = Math.min(this.maximumAltitude, Math.max(this.minimumAltitude, this.altitude));

    // Cache trigonometric calculations to avoid repeated sin/cos calls
    if (!this.trigCacheValid || Math.abs(this.rotation.y - this.lastRotationY) > 0.01) {
      this.cachedSinY = Math.sin(this.rotation.y);
      this.cachedCosY = Math.cos(this.rotation.y);
      this.lastRotationY = this.rotation.y;
      this.trigCacheValid = true;
    }

    // Update velocity based on cached rotation values
    this.velocity.x = this.cachedSinY * this.speed;
    this.velocity.z = this.cachedCosY * this.speed;

    // Update position
    this.position.x += this.velocity.x * deltaTime;
    this.position.z += this.velocity.z * deltaTime;
    this.position.y = this.altitude;

    // Update mesh position and rotation (including banking) using reusable vectors
    this.bomberGroup.position.copyFrom(this.position);

    // Reuse rotation vector instead of creating new one
    this.tempRotation.copyFrom(this.rotation);
    this.tempRotation.z = this.currentBankAngle; // Apply banking to Z rotation (roll)
    this.bomberGroup.rotation.copyFrom(this.tempRotation);

    // Update bomb bay state and effects
    this.updateBombBay(deltaTime);

    // Update missiles
    this.updateMissiles(deltaTime);

    // Update flares
    this.updateFlares(deltaTime);
  }

  // Read-only references to the internal vectors for per-frame callers — no
  // allocation. Callers must NOT mutate the returned vector; use the cloning
  // accessors below when a mutable copy is needed.
  public getPositionRef(): Vector3 {
    return this.position;
  }

  public getRotationRef(): Vector3 {
    return this.rotation;
  }

  public getVelocityRef(): Vector3 {
    return this.velocity;
  }

  public getPosition(): Vector3 {
    return this.position.clone();
  }

  public getRotation(): Vector3 {
    return this.rotation.clone();
  }

  public getVelocity(): Vector3 {
    return this.velocity.clone();
  }

  public getBombBayPosition(): Vector3 {
    return this.bomberGroup.position.add(new Vector3(0, -5, 0));
  }

  public openBombBay(): void {
    if (this.bombBayState === 'closed') {
      this.bombBayState = 'opening';
      this.bombBayOpenStartTime = performance.now() / 1000;
      this.bombBayOpenProgress = 0;

      // Start visual effects
      this.startBombBayEffects();
    }
  }

  public closeBombBay(): void {
    if (this.bombBayState === 'open') {
      this.bombBayState = 'closing';
      this.bombBayOpenStartTime = performance.now() / 1000; // Set the start time for closing animation
      this.bombBayOpenProgress = 1; // Start from fully open position

      // Don't stop effects immediately - let them fade out during closing animation
    }
  }

  public forceCloseBombBay(): void {
    // Immediately close bomb bay and stop all effects
    this.bombBayState = 'closed';
    this.bombBayOpenProgress = 0;
    this.missileLaunchPending = false;
    this.stopBombBayEffects();
  }

  public updateBombBay(deltaTime: number): void {
    const currentTime = performance.now() / 1000;

    // Keep the pooled bay light tracking the (unparented) bay position
    if (this.bombBayLightHandle.isActive()) {
      Vector3.TransformCoordinatesToRef(
        Bomber.bayLightLocalOffset,
        this.bomberGroup.getWorldMatrix(),
        this.bayLightWorldPos,
      );
      this.bombBayLightHandle.setPosition(this.bayLightWorldPos);
    }

    if (this.bombBayState === 'opening') {
      const elapsed = currentTime - this.bombBayOpenStartTime;
      this.bombBayOpenProgress = Math.min(elapsed / this.bombBayOpenTime, 1);

      // Update door rotations based on progress
      const maxRotation = Math.PI / 3; // 60 degrees
      this.bombBayLeft.rotation.z = this.bombBayOpenProgress * maxRotation;
      this.bombBayRight.rotation.z = -this.bombBayOpenProgress * maxRotation;

      // Update visual effects intensity
      this.updateBombBayEffects(this.bombBayOpenProgress);

      if (this.bombBayOpenProgress >= 1) {
        this.bombBayState = 'open';

        // If missile launch was pending, execute it now
        if (this.missileLaunchPending) {
          this.missileLaunchPending = false;
          this.executeMissileLaunch();
        }
      }
    } else if (this.bombBayState === 'closing') {
      const elapsed = currentTime - this.bombBayOpenStartTime;
      this.bombBayOpenProgress = Math.max(1 - elapsed / this.bombBayOpenTime, 0);

      // Update door rotations based on progress
      const maxRotation = Math.PI / 3; // 60 degrees
      this.bombBayLeft.rotation.z = this.bombBayOpenProgress * maxRotation;
      this.bombBayRight.rotation.z = -this.bombBayOpenProgress * maxRotation;

      // Update visual effects intensity - fade out during closing
      this.updateBombBayEffects(this.bombBayOpenProgress);

      if (this.bombBayOpenProgress <= 0) {
        this.bombBayState = 'closed';
        // Now stop all effects since doors are fully closed
        this.stopBombBayEffects();
      }
    }
  }

  private startBombBayEffects(): void {
    // Start particle effects
    this.bombBayParticles.forEach((particles) => {
      particles.start();
    });

    // Acquire the pooled bay light for the open/close cycle
    if (!this.bombBayLightHandle.isActive()) {
      this.bombBayLightHandle = LightManager.get(this.scene).acquire(LightPriority.MEDIUM);
      this.bombBayLightHandle.setColor(1, 0.8, 0.6); // Warm orange light
      this.bombBayLightHandle.setRange(18);
    }
    this.bombBayLightHandle.setIntensity(2);

    // Apply glow material to doors
    if (this.bombBayGlowMaterial) {
      this.bombBayLeft.material = this.bombBayGlowMaterial;
      this.bombBayRight.material = this.bombBayGlowMaterial;
    }
  }

  private stopBombBayEffects(): void {
    // Stop particle effects
    this.bombBayParticles.forEach((particles) => {
      particles.stop();
    });

    // Return the pooled bay light
    this.bombBayLightHandle.release();

    // Restore the original door material (kept since construction)
    if (this.bombBayLeft && this.bombBayBaseMaterial) {
      this.bombBayLeft.material = this.bombBayBaseMaterial;
    }
    if (this.bombBayRight && this.bombBayBaseMaterial) {
      this.bombBayRight.material = this.bombBayBaseMaterial;
    }

    // Reset glow material emissive to prevent lingering effects
    if (this.bombBayGlowMaterial) {
      this.bombBayGlowMaterial.emissiveColor = new Color3(0.1, 0.08, 0.12);
    }
  }

  private updateBombBayEffects(intensity: number): void {
    // Update light intensity
    this.bombBayLightHandle.setIntensity(intensity * 2);

    // Update particle emission rate
    this.bombBayParticles.forEach((particles) => {
      particles.emitRate = intensity * 100;
    });

    // Update glow material intensity
    if (this.bombBayGlowMaterial) {
      this.bombBayGlowMaterial.emissiveColor = new Color3(0.1 * intensity, 0.08 * intensity, 0.12 * intensity);
    }
  }

  public isBombBayOpen(): boolean {
    return this.bombBayState === 'open';
  }

  public isBombBayOpening(): boolean {
    return this.bombBayState === 'opening';
  }

  public isBombBayClosing(): boolean {
    return this.bombBayState === 'closing';
  }

  public isBombBayActive(): boolean {
    return this.bombBayState === 'opening' || this.bombBayState === 'closing';
  }

  public isWeaponSystemActive(): boolean {
    return this.isBombBayActive() || this.missileLaunchPending;
  }

  public getBombBayOpenProgress(): number {
    return this.bombBayOpenProgress;
  }

  // Missile system methods
  public canLaunchMissile(): boolean {
    const currentTime = performance.now() / 1000;
    const cooldownReady = currentTime - this.lastMissileLaunchTime >= this.missileCooldownTime;
    // Can launch if bomb bay is closed (not being used for bombing) or if missile launch is already pending
    const bombBayAvailable = this.bombBayState === 'closed' || this.missileLaunchPending;
    // Also check if bombing run is not active
    const noBombingRun = !this.isBombingRunActiveCallback || !this.isBombingRunActiveCallback();
    return cooldownReady && bombBayAvailable && noBombingRun;
  }

  public setBombingRunActiveCallback(callback: () => boolean): void {
    this.isBombingRunActiveCallback = callback;
  }

  public getMissileCooldownStatus(): number {
    const currentTime = performance.now() / 1000;
    const timeSinceLastLaunch = currentTime - this.lastMissileLaunchTime;
    return Math.min(timeSinceLastLaunch / this.missileCooldownTime, 1);
  }

  // Tomahawk acquisition range — deliberately SHORTER than the defense launchers'
  // radarScanRange (450, Building.ts): launchers get to fire first, and the bomber
  // must penetrate their engagement zone before it can return fire.
  private readonly defenseAcquisitionRange = 300;

  public findClosestDefenseBuildingSync(): Building | null {
    if (!this.terrainManager) return null;

    // Synchronous chunk-indexed query — cheap enough that no caching is needed,
    // and results are always fresh (no stale-target window after a launcher dies)
    const nearbyBuildings = this.terrainManager.getBuildingsInRadiusSync(this.position, this.defenseAcquisitionRange);

    let closestBuilding: Building | null = null;
    let closestDistanceSq = Infinity;
    for (const building of nearbyBuildings) {
      if (building.isDefenseLauncher() && !building.getIsDestroyed()) {
        const distanceSq = Vector3.DistanceSquared(this.position, building.getPosition());
        if (distanceSq < closestDistanceSq) {
          closestDistanceSq = distanceSq;
          closestBuilding = building;
        }
      }
    }
    return closestBuilding;
  }

  /** Promise wrapper kept for callers written against the old async API. */
  public findClosestDefenseBuilding(): Promise<Building | null> {
    return Promise.resolve(this.findClosestDefenseBuildingSync());
  }

  public hasValidTarget(): Promise<boolean> {
    return Promise.resolve(this.findClosestDefenseBuildingSync() !== null);
  }

  public launchMissile(): Promise<boolean> {
    if (!this.canLaunchMissile()) return Promise.resolve(false);

    const targetBuilding = this.findClosestDefenseBuildingSync();
    if (!targetBuilding) return Promise.resolve(false); // No valid target in range

    // Check if bomb bay is ready for launch
    if (this.bombBayState === 'closed') {
      // Open bomb bay first, then launch missile when fully open
      this.missileLaunchPending = true;
      this.openBombBay();
      return Promise.resolve(true); // Launch sequence started
    } else if (this.bombBayState === 'opening') {
      // Still opening, wait for it to complete
      this.missileLaunchPending = true;
      return Promise.resolve(true); // Launch sequence in progress
    } else if (this.bombBayState === 'closing') {
      // Doors are closing, can't launch
      return Promise.resolve(false);
    }

    // Bomb bay is open, proceed with launch
    this.executeMissileLaunch();
    return Promise.resolve(true);
  }

  private executeMissileLaunch(): void {
    // Re-resolve the target at the moment of launch — it may have been destroyed
    // while the bomb bay was opening. The query is synchronous and cheap.
    const targetBuilding = this.findClosestDefenseBuildingSync();
    if (!targetBuilding) {
      this.missileLaunchPending = false;
      return;
    }

    const currentTime = performance.now() / 1000;
    this.lastMissileLaunchTime = currentTime;

    // Launch position from bomb bay
    const launcherPosition = this.bomberGroup.position.add(new Vector3(0, -2, -1));

    // Create and launch missile targeting the defense building
    const missile = new TomahawkMissile(
      this.scene,
      launcherPosition,
      targetBuilding,
      this.rotation.clone(),
      this.workerManager,
      this.velocity.clone(), // Pass bomber velocity so missile moves with bomber during launch animation
    );

    // Set up target destruction callback
    missile.setOnTargetDestroyedCallback((building: Building) => {
      if (this.onTargetDestroyedCallback) {
        this.onTargetDestroyedCallback(building);
      }
    });

    this.missiles.push(missile);
    missile.launch();

    // Immediately start closing bomb bay after launch
    this.closeBombBay();

    // Ensure missile launch pending is reset
    this.missileLaunchPending = false;
  }

  /** Active Tomahawk missiles (for Rocket View's candidate provider). */
  public getMissiles(): TomahawkMissile[] {
    return this.missiles;
  }

  private updateMissiles(deltaTime: number): void {
    const currentTime = performance.now() / 1000;

    // Update all missiles; sweep exploded ones 10s after explosion so their
    // lingering smoke finishes (no per-frame timers)
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i];
      missile.update(deltaTime);

      if (missile.hasExploded()) {
        const explodedAt = this.missileExplodedAt.get(missile);
        if (explodedAt === undefined) {
          this.missileExplodedAt.set(missile, currentTime);
        } else if (currentTime - explodedAt > 10) {
          missile.dispose();
          this.missileExplodedAt.delete(missile);
          this.missiles.splice(i, 1);
        }
      }
    }
  }

  public setTerrainManager(terrainManager: TerrainManager): void {
    this.terrainManager = terrainManager;
  }

  // Health system methods
  public getHealth(): number {
    return this.health;
  }

  public getMaxHealth(): number {
    return this.maxHealth;
  }

  public isBomberDestroyed(): boolean {
    return this.isDestroyed;
  }

  public takeDamage(damageAmount: number): void {
    if (this.isDestroyed) return;

    const currentTime = performance.now() / 1000;
    const timeSinceLastDamage = currentTime - this.lastDamageTime;
    if (timeSinceLastDamage < 0.1) return; // Ignore damage if taken too frequently

    this.health -= damageAmount;
    this.lastDamageTime = currentTime;

    // Trigger visual damage effects
    this.triggerDamageEffects();

    if (this.health <= 0) {
      this.health = 0;
      this.isDestroyed = true;
      this.triggerDestructionEffects();
      this.onDestroyedCallback?.();
    }
  }

  private triggerDestructionEffects(): void {
    // Create massive explosion effect
    const explosionParticles = new ParticleSystem('bomberDestruction', 500, this.scene);
    explosionParticles.particleTexture = new Texture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      this.scene,
    );

    explosionParticles.emitter = this.bomberGroup.position;
    explosionParticles.minEmitBox = new Vector3(-10, -5, -15);
    explosionParticles.maxEmitBox = new Vector3(10, 5, 15);

    explosionParticles.color1 = new Color4(1, 1, 0, 1);
    explosionParticles.color2 = new Color4(1, 0.5, 0, 1);
    explosionParticles.colorDead = new Color4(0.5, 0, 0, 0);

    explosionParticles.emitRate = 500;
    explosionParticles.minLifeTime = 1;
    explosionParticles.maxLifeTime = 3;
    explosionParticles.minSize = 2.3;
    explosionParticles.maxSize = 6;
    explosionParticles.minEmitPower = 37;
    explosionParticles.maxEmitPower = 75;
    explosionParticles.updateSpeed = 0.01;

    explosionParticles.direction1 = new Vector3(-2, -1, -2);
    explosionParticles.direction2 = new Vector3(2, 2, 2);
    explosionParticles.gravity = new Vector3(0, -10, 0);
    explosionParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;

    explosionParticles.start();
    setTimeout(() => explosionParticles.stop(), 3000);

    // Stop all engine particles
    this.particleSystems.forEach((ps) => ps.stop());

    // Make bomber fall
    this.speed = 0;
    this.velocity = new Vector3(0, -20, 0);
  }

  private setupDamageEffects(): void {
    // Clear existing damage effects
    this.damageEffects.forEach((ps) => ps.dispose());
    this.damageEffects = [];

    if (this.damageLight) {
      this.damageLight.dispose();
      this.damageLight = null;
    }

    // Create damage light
    this.damageLight = new PointLight('bomberDamageLight', new Vector3(0, 0, 0), this.scene);
    this.damageLight.diffuse = new Color3(1, 0.2, 0.1);
    this.damageLight.specular = new Color3(1, 0.2, 0.1);
    this.damageLight.intensity = 0;
    this.damageLight.range = 50;
    this.damageLight.parent = this.bomberGroup;

    // Create smoke particles for damage
    const smokeParticles = new ParticleSystem('bomberSmoke', 100, this.scene);
    smokeParticles.particleTexture = new Texture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      this.scene,
    );

    smokeParticles.emitter = this.bomberGroup.position;
    smokeParticles.minEmitBox = new Vector3(-5, -2, -10);
    smokeParticles.maxEmitBox = new Vector3(5, 2, 10);

    smokeParticles.color1 = new Color4(0.3, 0.3, 0.3, 0.8);
    smokeParticles.color2 = new Color4(0.1, 0.1, 0.1, 0.6);
    smokeParticles.colorDead = new Color4(0.1, 0.1, 0.1, 0);

    smokeParticles.emitRate = 0; // Start stopped
    smokeParticles.minLifeTime = 2;
    smokeParticles.maxLifeTime = 4;
    smokeParticles.minSize = 2;
    smokeParticles.maxSize = 5;
    smokeParticles.minEmitPower = 5;
    smokeParticles.maxEmitPower = 10;
    smokeParticles.updateSpeed = 0.01;

    smokeParticles.direction1 = new Vector3(-0.5, 1, -0.5);
    smokeParticles.direction2 = new Vector3(0.5, 1.5, 0.5);
    smokeParticles.gravity = new Vector3(0, 2, 0);
    smokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    // Create fire particles for critical damage
    const fireParticles = new ParticleSystem('bomberFire', 150, this.scene);
    fireParticles.particleTexture = new Texture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      this.scene,
    );

    fireParticles.emitter = this.bomberGroup.position;
    fireParticles.minEmitBox = new Vector3(-3, -1, -8);
    fireParticles.maxEmitBox = new Vector3(3, 1, 8);

    fireParticles.color1 = new Color4(1, 0.5, 0, 1);
    fireParticles.color2 = new Color4(1, 0.2, 0, 0.8);
    fireParticles.colorDead = new Color4(0.5, 0.1, 0, 0);

    fireParticles.emitRate = 0; // Start stopped
    fireParticles.minLifeTime = 0.5;
    fireParticles.maxLifeTime = 1.5;
    fireParticles.minSize = 1;
    fireParticles.maxSize = 3;
    fireParticles.minEmitPower = 10;
    fireParticles.maxEmitPower = 20;
    fireParticles.updateSpeed = 0.01;

    fireParticles.direction1 = new Vector3(-0.3, 0.5, -0.3);
    fireParticles.direction2 = new Vector3(0.3, 1, 0.3);
    fireParticles.gravity = new Vector3(0, 5, 0);
    fireParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;

    this.damageEffects.push(smokeParticles, fireParticles);
  }

  public triggerDamageEffects(): void {
    if (this.isDestroyed || !this.damageEffects.length) return;

    const currentTime = performance.now() / 1000;
    const timeSinceLastDamage = currentTime - this.lastDamageTime;

    if (timeSinceLastDamage < 0.1) return; // Prevent spam

    // Start smoke effects
    const smokeParticles = this.damageEffects[0];
    if (smokeParticles && !smokeParticles.isStarted()) {
      smokeParticles.start();
      setTimeout(() => smokeParticles.stop(), this.damageEffectDuration * 1000);
    }

    // Start fire effects if health is low
    if (this.health < this.maxHealth * 0.3) {
      const fireParticles = this.damageEffects[1];
      if (fireParticles && !fireParticles.isStarted()) {
        fireParticles.start();
        setTimeout(() => fireParticles.stop(), this.damageEffectDuration * 1000);
      }
    }

    // Flash damage light
    if (this.damageLight) {
      this.damageLight.intensity = 2;
      setTimeout(() => {
        if (this.damageLight) {
          this.damageLight.intensity = 0;
        }
      }, 200);
    }
  }

  public getHealthPercentage(): number {
    return (this.health / this.maxHealth) * 100;
  }

  public isCriticalHealth(): boolean {
    return this.health < this.maxHealth * 0.3;
  }

  public setOnDestroyedCallback(callback: () => void): void {
    this.onDestroyedCallback = callback;
  }

  public setOnTargetDestroyedCallback(callback: (building: Building) => void): void {
    this.onTargetDestroyedCallback = callback;
  }

  // Countermeasure flare system
  public canLaunchFlares(): boolean {
    const currentTime = performance.now() / 1000;
    return currentTime - this.lastFlareTime >= this.flareCooldown;
  }

  public getFlareCooldownStatus(): number {
    const currentTime = performance.now() / 1000;
    const timeSinceLastFlare = currentTime - this.lastFlareTime;
    return Math.min(timeSinceLastFlare / this.flareCooldown, 1);
  }

  public launchFlares(): boolean {
    if (!this.canLaunchFlares()) return false;

    const currentTime = performance.now() / 1000;
    this.lastFlareTime = currentTime;

    // Release flares in sets over time - simulating sequential deployment
    // Define sets of flares with different release times
    const flareSets = [
      { delay: 0, offsets: [new Vector3(-5, -5, -10), new Vector3(5, -5, -10)] },
      { delay: 0.15, offsets: [new Vector3(-8, -5, -5), new Vector3(8, -5, -5)] },
      { delay: 0.3, offsets: [new Vector3(-5, -5, 0), new Vector3(5, -5, 0)] },
      { delay: 0.45, offsets: [new Vector3(-8, -5, 5), new Vector3(8, -5, 5)] },
    ];

    flareSets.forEach((set) => {
      setTimeout(() => {
        set.offsets.forEach((offset) => {
          this.deployFlare(offset);
        });
      }, set.delay * 1000);
    });

    return true;
  }

  private deployFlare(offset: Vector3): void {
    // Use current bomber position at deployment time
    const flarePos = this.position.clone().add(offset);

    // Give the flare an initial velocity that includes:
    // 1. Bomber's current velocity (so it's not left behind)
    // 2. A small outward component
    // 3. A small downward component
    const flareVelocity = this.velocity.clone();
    flareVelocity.x += offset.x * 0.5; // Outward spread
    flareVelocity.y = -5; // Initial downward velocity
    flareVelocity.z += offset.z * 0.3; // Slight backward spread

    // Rent a {mesh, particles} pair; with the pool exhausted (shouldn't happen —
    // cooldown outlasts flare lifetime), force-expire the oldest active flare
    if (!this.flarePoolBuilt) this.buildFlarePool();
    if (this.flarePool.length === 0 && this.activeFlares.length > 0) {
      this.releaseFlare(this.activeFlares.shift()!);
      this.activeFlarePositionsDirty = true;
    }
    const pair = this.flarePool.pop();
    if (!pair) return;

    pair.mesh.position.copyFrom(flarePos);
    pair.mesh.setEnabled(true);
    (pair.particles.emitter as Vector3).copyFrom(flarePos);
    pair.particles.emitRate = 100;
    pair.particles.start();

    // One pooled light covers the whole volley (positioned at the flare centroid
    // in updateFlares); per-flare brightness comes from the particle systems
    if (!this.flareVolleyLightHandle.isActive()) {
      this.flareVolleyLightHandle = LightManager.get(this.scene).acquire(LightPriority.HIGH);
      this.flareVolleyLightHandle.setColor(1, 0.8, 0.2);
      this.flareVolleyLightHandle.setRange(40);
      this.flareVolleyLightHandle.setIntensity(4);
      this.flareVolleyLightHandle.setPosition(flarePos);
    }

    // Add to active flares with physics data
    this.activeFlares.push({
      position: flarePos,
      velocity: flareVelocity,
      lifetime: this.flareLifetime,
      maxLifetime: this.flareLifetime,
      mesh: pair.mesh,
      particles: pair.particles,
    });
    this.activeFlarePositionsDirty = true;
  }

  private buildFlarePool(): void {
    this.flarePoolBuilt = true;
    for (let i = 0; i < Bomber.FLARE_POOL_SIZE; i++) {
      const mesh = MeshBuilder.CreateSphere(`flare${i}`, { diameter: 0.8 }, this.scene);
      mesh.material = this.getFlareMaterial();
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.flarePool.push({ mesh, particles: this.createFlareParticleSystem(i) });
    }
  }

  /** Return a flare's mesh/particles pair to the pool. Emission stops; particles already in the air fade out. */
  private releaseFlare(flare: { mesh: Mesh; particles: ParticleSystem }): void {
    flare.mesh.setEnabled(false);
    flare.particles.stop();
    this.flarePool.push({ mesh: flare.mesh, particles: flare.particles });
  }

  private updateFlares(deltaTime: number): void {
    // Centroid + average lifetime ratio drive the single pooled volley light
    let centroidX = 0;
    let centroidY = 0;
    let centroidZ = 0;
    let ratioSum = 0;

    // Update each active flare's physics and visual effects
    for (let i = this.activeFlares.length - 1; i >= 0; i--) {
      const flare = this.activeFlares[i];

      // Update lifetime
      flare.lifetime -= deltaTime;

      // Expired flares go back to the pool for the next volley
      if (flare.lifetime <= 0) {
        this.releaseFlare(flare);
        this.activeFlares.splice(i, 1);
        this.activeFlarePositionsDirty = true;
        continue;
      }

      // Apply gravity to velocity (downward acceleration)
      flare.velocity.y -= 9.8 * deltaTime; // Gravity

      // Apply air resistance (slow down horizontal movement)
      flare.velocity.x *= 0.98;
      flare.velocity.z *= 0.98;

      // Update position based on velocity
      flare.position.x += flare.velocity.x * deltaTime;
      flare.position.y += flare.velocity.y * deltaTime;
      flare.position.z += flare.velocity.z * deltaTime;

      // Don't let flares go below ground — rest on the actual terrain surface,
      // not the flat-world y=0 floor (terrain has hills)
      const flareGroundY = this.terrainManager
        ? this.terrainManager.getTerrainHeightAt(flare.position.x, flare.position.z) + 0.5
        : 0.5;
      if (flare.position.y < flareGroundY) {
        flare.position.y = flareGroundY;
        flare.velocity.y = 0; // Stop falling
        flare.velocity.x *= 0.5; // Reduce horizontal velocity on ground contact
        flare.velocity.z *= 0.5;
      }

      // Update mesh position
      flare.mesh.position.copyFrom(flare.position);

      // Update particle emitter position
      if (flare.particles.emitter instanceof Vector3) {
        flare.particles.emitter.copyFrom(flare.position);
      }

      // Burn at full brightness for most of the descent; only fade over the
      // final 30% of lifetime so flares still glow when they reach the ground
      const lifetimeRatio = flare.lifetime / flare.maxLifetime;
      flare.particles.emitRate = 100 * Math.min(1, lifetimeRatio / 0.3);

      centroidX += flare.position.x;
      centroidY += flare.position.y;
      centroidZ += flare.position.z;
      ratioSum += lifetimeRatio;
    }

    const flareCount = this.activeFlares.length;
    if (flareCount > 0) {
      this.flareVolleyLightHandle.setPositionXYZ(centroidX / flareCount, centroidY / flareCount, centroidZ / flareCount);
      this.flareVolleyLightHandle.setIntensity(4 * (ratioSum / flareCount));
    } else {
      this.flareVolleyLightHandle.release();
    }
  }

  private getFlareMaterial(): StandardMaterial {
    if (!this.flareMaterial) {
      this.flareMaterial = new StandardMaterial('flareMaterial', this.scene);
      this.flareMaterial.diffuseColor = new Color3(1, 0.8, 0.2); // Bright orange-yellow
      this.flareMaterial.emissiveColor = new Color3(1, 0.6, 0.1); // Glowing effect
      this.flareMaterial.specularColor = new Color3(1, 1, 1);
    }
    return this.flareMaterial;
  }

  private createFlareParticleSystem(index: number): ParticleSystem {
    // Pooled flare particle system: built once, started/stopped per rent. The
    // texture is shared scene-wide via EffectTextures; the emitter is its own
    // Vector3, copyFrom'd to the flare position on rent and each frame after.
    const flareParticles = new ParticleSystem(`flareParticles${index}`, 100, this.scene);
    flareParticles.particleTexture = EffectTextures.get(this.scene).getFlareTexture();
    flareParticles.emitter = new Vector3(0, -10000, 0);
    flareParticles.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
    flareParticles.maxEmitBox = new Vector3(0.2, 0.2, 0.2);

    // Bright orange-yellow flare colors
    flareParticles.color1 = new Color4(1, 0.9, 0.3, 1.0);
    flareParticles.color2 = new Color4(1, 0.7, 0.2, 0.8);
    flareParticles.colorDead = new Color4(1, 0.5, 0.1, 0.0);

    flareParticles.minSize = 0.5;
    flareParticles.maxSize = 1.5;
    flareParticles.minLifeTime = 0.5;
    flareParticles.maxLifeTime = 1.0;
    flareParticles.emitRate = 100;
    flareParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    flareParticles.gravity = new Vector3(0, -2, 0);
    flareParticles.direction1 = new Vector3(-1, 1, -1);
    flareParticles.direction2 = new Vector3(1, 2, 1);
    flareParticles.minEmitPower = 2;
    flareParticles.maxEmitPower = 5;
    flareParticles.updateSpeed = 0.01;

    return flareParticles;
  }

  // Persistent array of references to flare position vectors (updated in place by
  // updateFlares); rebuilt only when a flare is added or removed. Callers treat it
  // as read-only and must not retain it across frames for snapshot purposes.
  private activeFlarePositions: Vector3[] = [];
  private activeFlarePositionsDirty: boolean = true;

  public getActiveFlares(): Vector3[] {
    if (this.activeFlarePositionsDirty) {
      this.activeFlarePositions.length = 0;
      for (const flare of this.activeFlares) {
        this.activeFlarePositions.push(flare.position);
      }
      this.activeFlarePositionsDirty = false;
    }
    return this.activeFlarePositions;
  }

  public hasActiveFlares(): boolean {
    return this.activeFlares.length > 0;
  }

  public dispose(): void {
    // Force close bomb bay and clean up all effects
    this.forceCloseBombBay();

    // Return pooled lights
    this.bombBayLightHandle.release();
    this.flareVolleyLightHandle.release();

    this.bombBayParticles.forEach((particles) => {
      if (particles) {
        particles.dispose();
      }
    });
    this.bombBayParticles = [];

    if (this.bombBayGlowMaterial) {
      this.bombBayGlowMaterial.dispose();
      this.bombBayGlowMaterial = null;
    }

    if (this.bombBayBaseMaterial) {
      this.bombBayBaseMaterial.dispose();
      this.bombBayBaseMaterial = null;
    }

    // Clean up the flare pool (active flares' mesh/particles pairs are pool
    // members too). dispose(false) keeps the scene-shared flare texture.
    this.activeFlares.forEach((flare) => this.releaseFlare(flare));
    this.activeFlares = [];
    this.activeFlarePositionsDirty = true;
    this.flarePool.forEach((pair) => {
      pair.mesh.dispose();
      pair.particles.dispose(false);
    });
    this.flarePool = [];
    this.flarePoolBuilt = false;

    if (this.flareMaterial) {
      this.flareMaterial.dispose();
      this.flareMaterial = null;
    }

    // Clean up legacy flare arrays (kept for compatibility)
    this.flareMeshes.forEach((mesh) => {
      if (mesh) {
        mesh.dispose();
      }
    });
    this.flareMeshes = [];

    this.flareParticleSystems.forEach((particles) => {
      if (particles) {
        particles.dispose();
      }
    });
    this.flareParticleSystems = [];

    // Clean up damage effects
    this.damageEffects.forEach((ps) => ps.dispose());
    this.damageEffects = [];

    if (this.damageLight) {
      this.damageLight.dispose();
      this.damageLight = null;
    }

    // Clean up engine particles
    this.particleSystems.forEach((ps) => ps.dispose());
    this.particleSystems = [];

    // Clean up bomber mesh
    if (this.bomberGroup) {
      this.bomberGroup.dispose();
    }
  }
}
