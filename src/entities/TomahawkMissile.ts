import {
  Scene,
  Mesh,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  ParticleSystem,
  Texture,
  Sound,
  Color4,
  PointLight,
  TransformNode,
  Animation,
  AnimationGroup,
  DynamicTexture,
} from '@babylonjs/core';
import { Building } from './Building';
import { WorkerManager } from '../managers/WorkerManager';

export class TomahawkMissile {
  private scene: Scene;
  private workerManager: WorkerManager;
  private missileGroup: TransformNode;
  private fuselage!: Mesh;
  private position: Vector3;
  private velocity: Vector3;
  private rotation: Vector3;
  private targetPosition: Vector3;
  private targetBuilding: Building | null = null;
  private speed: number = 150; // Cruise missile speed
  private turnRate: number = 2.0; // How fast the missile can turn
  private launched: boolean = false;
  private exploded: boolean = false;
  
  // Worker-related properties
  private pendingPhysicsUpdate: boolean = false;
  private lastWorkerUpdateTime: number = 0;
  private workerUpdateInterval: number = 1 / 60; // 60 FPS max updates
  private exhaustParticles!: ParticleSystem;
  private trailParticles!: ParticleSystem;
  private flightSmokeParticles!: ParticleSystem;
  private fireParticles!: ParticleSystem;
  private explosionSmokeParticles!: ParticleSystem;
  private shockwaveParticles!: ParticleSystem;
  private sparkParticles!: ParticleSystem;
  private light!: PointLight;
  private launchAnimationGroup!: AnimationGroup;

  // Curved path navigation properties
  private pathStartTime: number = 0;
  private waypoints: Vector3[] = [];

  // Simple curved path following
  private pathTime: number = 0;
  private pathSpeed: number = 0.5; // Speed along the curved path

  // Look-ahead orientation properties
  private lookAheadDistance: number = 0.4; // How far ahead to look on the curve (0-1) - increased for better path following
  private lastSegmentChangeTime: number = 0;
  private orientationUpdateThreshold: number = 0.15; // When to update orientation (segment progress) - increased threshold

  // Target destruction callback
  private onTargetDestroyedCallback: ((building: Building) => void) | null = null;

  constructor(scene: Scene, launchPosition: Vector3, targetBuilding: Building, launchRotation: Vector3, workerManager: WorkerManager) {
    this.scene = scene;
    this.workerManager = workerManager;
    this.position = launchPosition.clone();
    this.targetBuilding = targetBuilding;
    this.targetPosition = targetBuilding.getPosition().clone();
    this.rotation = launchRotation.clone();
    this.velocity = new Vector3(0, 0, 0); // Start stationary

    this.missileGroup = new TransformNode('tomahawkGroup', this.scene);
    this.missileGroup.position = this.position.clone();
    this.missileGroup.rotation = this.rotation.clone();

    this.createMissileModel();
    this.setupParticleEffects();
    this.setupExplosionEffects();
    this.createLaunchAnimation();
    this.generateCurvedPath();
  }

  private generateCurvedPath(): void {
    // Simple curved path - just store start and end points
    this.waypoints = [this.position.clone(), this.targetPosition.clone()];
  }



  private createMissileModel(): void {
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

    const fuselageMaterial = new StandardMaterial('missileFuselage', this.scene);
    fuselageMaterial.diffuseColor = new Color3(0.8, 0.8, 0.9); // Light gray
    fuselageMaterial.specularColor = new Color3(0.5, 0.5, 0.6);
    fuselageMaterial.emissiveColor = new Color3(0.1, 0.1, 0.12);
    this.fuselage.material = fuselageMaterial;

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

    const noseMaterial = new StandardMaterial('noseMaterial', this.scene);
    noseMaterial.diffuseColor = new Color3(0.2, 0.2, 0.25);
    noseMaterial.specularColor = new Color3(0.8, 0.8, 0.9);
    noseCone.material = noseMaterial;

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

    const engineMaterial = new StandardMaterial('engineMaterial', this.scene);
    engineMaterial.diffuseColor = new Color3(0.1, 0.1, 0.1);
    engineMaterial.emissiveColor = new Color3(0.3, 0.1, 0.05);
    engineNozzle.material = engineMaterial;

    // Add missile light with enhanced glow
    this.light = new PointLight('missileLight', new Vector3(0, 0, 0), this.scene);
    this.light.diffuse = new Color3(1, 0.3, 0);
    this.light.specular = new Color3(1, 0.3, 0);
    this.light.intensity = 3; // Increased intensity
    this.light.range = 80; // Increased range for more dramatic effect
    this.light.parent = this.missileGroup;
  }

  private createWings(): void {
    // Small control fins
    const wingPositions = [
      { pos: new Vector3(0, 0.3, 0), rot: new Vector3(0, 0, 0) },
      { pos: new Vector3(0, -0.3, 0), rot: new Vector3(0, 0, Math.PI) },
      { pos: new Vector3(0, 0, 0.3), rot: new Vector3(0, 0, Math.PI / 2) },
      { pos: new Vector3(0, 0, -0.3), rot: new Vector3(0, 0, -Math.PI / 2) },
    ];

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

      const wingMaterial = new StandardMaterial(`wingMaterial${index}`, this.scene);
      wingMaterial.diffuseColor = new Color3(0.7, 0.7, 0.8);
      wingMaterial.specularColor = new Color3(0.4, 0.4, 0.5);
      wing.material = wingMaterial;
    });
  }

  private setupParticleEffects(): void {
    // Optimized engine exhaust particles - reduced count and complexity
    this.exhaustParticles = new ParticleSystem('missileExhaust', 80, this.scene); // Reduced from 150
    this.exhaustParticles.particleTexture = new Texture(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      this.scene,
    );

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

    this.exhaustParticles.emitRate = 80; // Reduced from 150
    this.exhaustParticles.minLifeTime = 0.3;
    this.exhaustParticles.maxLifeTime = 0.6;
    this.exhaustParticles.minSize = 0.3;
    this.exhaustParticles.maxSize = 1.2;
    this.exhaustParticles.minEmitPower = 40;
    this.exhaustParticles.maxEmitPower = 70;
    this.exhaustParticles.updateSpeed = 0.01;

    this.exhaustParticles.direction1 = new Vector3(-0.2, -0.1, -1);
    this.exhaustParticles.direction2 = new Vector3(0.2, 0.1, -1);
    this.exhaustParticles.gravity = new Vector3(0, 0, 0);
    this.exhaustParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;

    // Create procedural trail texture
    const trailTexture = new DynamicTexture('missileTrailTexture', { width: 64, height: 64 }, this.scene);
    const trailContext = trailTexture.getContext();

    // Create a simple white/gray dot pattern for trail
    const trailGradient = trailContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    trailGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    trailGradient.addColorStop(0.5, 'rgba(200, 200, 200, 0.5)');
    trailGradient.addColorStop(1, 'rgba(100, 100, 100, 0)');

    trailContext.fillStyle = trailGradient;
    trailContext.fillRect(0, 0, 64, 64);
    trailTexture.update();

    // Optimized vapor trail particles - reduced count
    this.trailParticles = new ParticleSystem('missileTrail', 150, this.scene); // Reduced from 300
    this.trailParticles.particleTexture = trailTexture;
    this.trailParticles.emitter = emitterMesh;
    this.trailParticles.minEmitBox = new Vector3(0, 0, 0);
    this.trailParticles.maxEmitBox = new Vector3(0, 0, 0);

    // More distinct trail colors with blue-white tint
    this.trailParticles.color1 = new Color4(0.8, 0.9, 1.0, 0.6); // Bright blue-white
    this.trailParticles.color2 = new Color4(0.6, 0.7, 0.9, 0.4); // Medium blue
    this.trailParticles.colorDead = new Color4(0.2, 0.3, 0.5, 0.0);

    this.trailParticles.emitRate = 80; // Reduced from 120
    this.trailParticles.minLifeTime = 1.5;
    this.trailParticles.maxLifeTime = 3.0;
    this.trailParticles.minSize = 0.8;
    this.trailParticles.maxSize = 2.5;
    this.trailParticles.minEmitPower = 2;
    this.trailParticles.maxEmitPower = 5;
    this.trailParticles.updateSpeed = 0.01;

    this.trailParticles.direction1 = new Vector3(0, 0, -0.2);
    this.trailParticles.direction2 = new Vector3(0, 0, 0.2);
    this.trailParticles.gravity = new Vector3(0, -1, 0);
    this.trailParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;

    // Create procedural smoke texture
    const smokeTexture = new DynamicTexture('missileSmokeTexture', { width: 64, height: 64 }, this.scene);
    const smokeContext = smokeTexture.getContext();

    // Create smoke effect with noise
    smokeContext.fillStyle = 'rgba(0, 0, 0, 0)';
    smokeContext.fillRect(0, 0, 64, 64);

    // Add several overlapping circles for smoke effect
    for (let i = 0; i < 8; i++) {
      const x = 32 + (Math.random() - 0.5) * 40;
      const y = 32 + (Math.random() - 0.5) * 40;
      const radius = 15 + Math.random() * 15;
      const alpha = 0.1 + Math.random() * 0.3;

      const gradient = smokeContext.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(100, 100, 100, ${alpha})`);
      gradient.addColorStop(1, 'rgba(50, 50, 50, 0)');

      smokeContext.fillStyle = gradient;
      smokeContext.beginPath();
      smokeContext.arc(x, y, radius, 0, 2 * Math.PI);
      smokeContext.fill();
    }
    smokeTexture.update();

    // Optimized smoke trail - reduced count
    this.flightSmokeParticles = new ParticleSystem('missileSmoke', 50, this.scene); // Reduced from 100
    this.flightSmokeParticles.particleTexture = smokeTexture;
    this.flightSmokeParticles.emitter = emitterMesh;
    this.flightSmokeParticles.minEmitBox = new Vector3(0, 0, 0);
    this.flightSmokeParticles.maxEmitBox = new Vector3(0, 0, 0);

    this.flightSmokeParticles.color1 = new Color4(0.4, 0.4, 0.4, 0.3);
    this.flightSmokeParticles.color2 = new Color4(0.6, 0.6, 0.6, 0.2);
    this.flightSmokeParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);

    this.flightSmokeParticles.emitRate = 30; // Reduced from 50
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

  private setupExplosionEffects(): void {
    // Create procedural fire explosion texture
    const fireExplosionTexture = new DynamicTexture(
      'missileFireExplosionTexture',
      { width: 64, height: 64 },
      this.scene,
    );
    const fireExplosionContext = fireExplosionTexture.getContext();

    // Create fire explosion effect with bright center and fading edges
    const fireExplosionGradient = fireExplosionContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    fireExplosionGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    fireExplosionGradient.addColorStop(0.2, 'rgba(255, 255, 0, 0.9)');
    fireExplosionGradient.addColorStop(0.5, 'rgba(255, 100, 0, 0.6)');
    fireExplosionGradient.addColorStop(0.8, 'rgba(255, 50, 0, 0.3)');
    fireExplosionGradient.addColorStop(1, 'rgba(200, 0, 0, 0)');

    fireExplosionContext.fillStyle = fireExplosionGradient;
    fireExplosionContext.fillRect(0, 0, 64, 64);
    fireExplosionTexture.update();

    // Optimized fire explosion particles - increased size and effects
    this.fireParticles = new ParticleSystem('missileExplosionFire', 800, this.scene); // Increased from 600
    this.fireParticles.particleTexture = fireExplosionTexture;
    this.fireParticles.emitter = this.position;
    this.fireParticles.minEmitBox = new Vector3(-1.5, 0, -1.5); // Increased from -1, 0, -1
    this.fireParticles.maxEmitBox = new Vector3(1.5, 0, 1.5); // Increased from 1, 0, 1

    this.fireParticles.color1 = new Color4(1, 0.9, 0.1, 1.0);
    this.fireParticles.color2 = new Color4(1, 0.4, 0, 1.0);
    this.fireParticles.colorDead = new Color4(0.3, 0.1, 0, 0.0);

    this.fireParticles.minSize = 2.5; // Increased from 2.0
    this.fireParticles.maxSize = 6.5; // Increased from 5.0
    this.fireParticles.minLifeTime = 0.4; // Increased from 0.3
    this.fireParticles.maxLifeTime = 0.8; // Increased from 0.6
    this.fireParticles.emitRate = 800; // Increased from 600
    this.fireParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    this.fireParticles.gravity = new Vector3(0, -5, 0);
    this.fireParticles.direction1 = new Vector3(-10, 8, -10); // Increased from -8, 6, -8
    this.fireParticles.direction2 = new Vector3(10, 12, 10); // Increased from 8, 10, 8
    this.fireParticles.minEmitPower = 6; // Increased from 5
    this.fireParticles.maxEmitPower = 15; // Increased from 12
    this.fireParticles.updateSpeed = 0.005;
    this.fireParticles.manualEmitCount = 800; // Increased from 600
    this.fireParticles.stop();

    // Create procedural explosion smoke texture
    const explosionSmokeTexture = new DynamicTexture(
      'missileExplosionSmokeTexture',
      { width: 64, height: 64 },
      this.scene,
    );
    const explosionSmokeContext = explosionSmokeTexture.getContext();

    // Create explosion smoke effect with noise
    explosionSmokeContext.fillStyle = 'rgba(0, 0, 0, 0)';
    explosionSmokeContext.fillRect(0, 0, 64, 64);

    // Add several overlapping circles for smoke effect
    for (let i = 0; i < 8; i++) {
      const x = 32 + (Math.random() - 0.5) * 40;
      const y = 32 + (Math.random() - 0.5) * 40;
      const radius = 15 + Math.random() * 15;
      const alpha = 0.1 + Math.random() * 0.3;

      const gradient = explosionSmokeContext.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(100, 100, 100, ${alpha})`);
      gradient.addColorStop(1, 'rgba(50, 50, 50, 0)');

      explosionSmokeContext.fillStyle = gradient;
      explosionSmokeContext.beginPath();
      explosionSmokeContext.arc(x, y, radius, 0, 2 * Math.PI);
      explosionSmokeContext.fill();
    }
    explosionSmokeTexture.update();

    // Optimized explosion smoke - increased size
    this.explosionSmokeParticles = new ParticleSystem('missileExplosionSmoke', 400, this.scene); // Increased from 300
    this.explosionSmokeParticles.particleTexture = explosionSmokeTexture;
    this.explosionSmokeParticles.emitter = this.position;
    this.explosionSmokeParticles.minEmitBox = new Vector3(-2, 0, -2); // Increased from -1.5, 0, -1.5
    this.explosionSmokeParticles.maxEmitBox = new Vector3(2, 0, 2); // Increased from 1.5, 0, 1.5

    this.explosionSmokeParticles.color1 = new Color4(0.3, 0.3, 0.3, 0.9);
    this.explosionSmokeParticles.color2 = new Color4(0.5, 0.5, 0.5, 0.7);
    this.explosionSmokeParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);

    this.explosionSmokeParticles.minSize = 4.0; // Increased from 3.0
    this.explosionSmokeParticles.maxSize = 10.0; // Increased from 8.0
    this.explosionSmokeParticles.minLifeTime = 2.5; // Increased from 2.0
    this.explosionSmokeParticles.maxLifeTime = 5.0; // Increased from 4.0
    this.explosionSmokeParticles.emitRate = 400; // Increased from 300
    this.explosionSmokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.explosionSmokeParticles.gravity = new Vector3(0, -1, 0);
    this.explosionSmokeParticles.direction1 = new Vector3(-1.5, 4, -1.5); // Increased from -1, 3, -1
    this.explosionSmokeParticles.direction2 = new Vector3(1.5, 6, 1.5); // Increased from 1, 5, 1
    this.explosionSmokeParticles.minEmitPower = 1.5; // Increased from 1
    this.explosionSmokeParticles.maxEmitPower = 4; // Increased from 3
    this.explosionSmokeParticles.updateSpeed = 0.01;
    this.explosionSmokeParticles.manualEmitCount = 400; // Increased from 300
    this.explosionSmokeParticles.stop();

    // Create shockwave effect
    const shockwaveTexture = new DynamicTexture('missileShockwaveTexture', { width: 64, height: 64 }, this.scene);
    const shockwaveContext = shockwaveTexture.getContext();

    // Create expanding ring effect
    const shockwaveGradient = shockwaveContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    shockwaveGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    shockwaveGradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
    shockwaveGradient.addColorStop(0.7, 'rgba(255, 200, 100, 0.4)');
    shockwaveGradient.addColorStop(1, 'rgba(255, 150, 50, 0)');

    shockwaveContext.fillStyle = shockwaveGradient;
    shockwaveContext.fillRect(0, 0, 64, 64);
    shockwaveTexture.update();

    this.shockwaveParticles = new ParticleSystem('missileShockwave', 200, this.scene);
    this.shockwaveParticles.particleTexture = shockwaveTexture;
    this.shockwaveParticles.emitter = this.position;
    this.shockwaveParticles.minEmitBox = new Vector3(0, 0, 0);
    this.shockwaveParticles.maxEmitBox = new Vector3(0, 0, 0);

    this.shockwaveParticles.color1 = new Color4(1, 1, 1, 0.8);
    this.shockwaveParticles.color2 = new Color4(1, 0.8, 0.4, 0.6);
    this.shockwaveParticles.colorDead = new Color4(1, 0.6, 0.2, 0.0);

    this.shockwaveParticles.minSize = 8.0;
    this.shockwaveParticles.maxSize = 15.0;
    this.shockwaveParticles.minLifeTime = 0.8;
    this.shockwaveParticles.maxLifeTime = 1.2;
    this.shockwaveParticles.emitRate = 200;
    this.shockwaveParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    this.shockwaveParticles.gravity = new Vector3(0, 0, 0);
    this.shockwaveParticles.direction1 = new Vector3(-0.5, 0, -0.5);
    this.shockwaveParticles.direction2 = new Vector3(0.5, 0, 0.5);
    this.shockwaveParticles.minEmitPower = 20;
    this.shockwaveParticles.maxEmitPower = 30;
    this.shockwaveParticles.manualEmitCount = 200;
    this.shockwaveParticles.stop();

    // Create spark effect
    const sparkTexture = new DynamicTexture('missileSparkTexture', { width: 32, height: 32 }, this.scene);
    const sparkContext = sparkTexture.getContext();

    // Create bright spark effect
    const sparkGradient = sparkContext.createRadialGradient(16, 16, 0, 16, 16, 16);
    sparkGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    sparkGradient.addColorStop(0.3, 'rgba(255, 255, 200, 0.8)');
    sparkGradient.addColorStop(0.7, 'rgba(255, 200, 100, 0.4)');
    sparkGradient.addColorStop(1, 'rgba(255, 150, 50, 0)');

    sparkContext.fillStyle = sparkGradient;
    sparkContext.fillRect(0, 0, 32, 32);
    sparkTexture.update();

    this.sparkParticles = new ParticleSystem('missileSparks', 150, this.scene);
    this.sparkParticles.particleTexture = sparkTexture;
    this.sparkParticles.emitter = this.position;
    this.sparkParticles.minEmitBox = new Vector3(-0.5, 0, -0.5);
    this.sparkParticles.maxEmitBox = new Vector3(0.5, 0, 0.5);

    this.sparkParticles.color1 = new Color4(1, 1, 0.8, 1.0);
    this.sparkParticles.color2 = new Color4(1, 0.8, 0.4, 0.8);
    this.sparkParticles.colorDead = new Color4(1, 0.6, 0.2, 0.0);

    this.sparkParticles.minSize = 0.5;
    this.sparkParticles.maxSize = 1.5;
    this.sparkParticles.minLifeTime = 0.5;
    this.sparkParticles.maxLifeTime = 1.0;
    this.sparkParticles.emitRate = 150;
    this.sparkParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    this.sparkParticles.gravity = new Vector3(0, -10, 0);
    this.sparkParticles.direction1 = new Vector3(-8, 5, -8);
    this.sparkParticles.direction2 = new Vector3(8, 8, 8);
    this.sparkParticles.minEmitPower = 10;
    this.sparkParticles.maxEmitPower = 20;
    this.sparkParticles.manualEmitCount = 150;
    this.sparkParticles.stop();
  }

  private createLaunchAnimation(): void {
    // Create launch animation that moves missile from launcher to flight path
    const launchAnimation = new Animation(
      'missileLaunch',
      'position',
      30,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );

    // Start from launch position, then move forward and establish cruise altitude
    const startPos = this.position.clone();
    const keys = [
      { frame: 0, value: startPos.clone() },
      { frame: 15, value: startPos.add(new Vector3(5, -10, 5)) }, // Move forward and down
      { frame: 30, value: startPos.add(new Vector3(10, -15, 10)) }, // Continue forward and establish cruise altitude
      { frame: 60, value: startPos.add(new Vector3(15, -20, 15)) }, // Final launch position
    ];

    launchAnimation.setKeys(keys);

    this.launchAnimationGroup = new AnimationGroup('missileLaunchGroup');
    this.launchAnimationGroup.addTargetedAnimation(launchAnimation, this.missileGroup);
  }

  public launch(): void {
    if (this.launched) return;

    this.launched = true;

    // Start trail particles immediately
    this.trailParticles.start();

    // Play launch animation first
    this.launchAnimationGroup.play(false);

    // After launch animation completes (60 frames at 30 FPS = 2 seconds), start guided flight
    setTimeout(() => {
      this.startGuidedFlight();
    }, 2000);
  }

  private startGuidedFlight(): void {
    // Update position to current missile group position after animation
    this.position = this.missileGroup.position.clone();
    
    // Start remaining particle effects now that launch animation is complete
    this.pathStartTime = performance.now() / 1000;
    this.exhaustParticles.start();
    this.flightSmokeParticles.start();
    
    // Regenerate curved path from the new launch position to target
    this.generateCurvedPath();
    
    // Initialize path time for curved navigation
    this.pathTime = 0;
    this.lastSegmentChangeTime = performance.now() / 1000;

    // Calculate initial velocity toward target
    const directionToTarget = this.targetPosition.subtract(this.position).normalize();
    this.velocity = directionToTarget.scale(this.speed);

    // Set initial orientation toward target
    if (this.velocity.lengthSquared() > 0.01) {
      this.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
      const horizontalSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      if (horizontalSpeed > 0.001) {
        this.rotation.x = Math.atan2(-this.velocity.y, horizontalSpeed);
      }
    }
  }

  public update(deltaTime: number): void {
    if (!this.launched || this.exploded) return;

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
      missileType: 'tomahawk',
      id: Math.random().toString(36),
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      rotation: { x: this.rotation.x, y: this.rotation.y, z: this.rotation.z },
      targetPosition: { x: this.targetPosition.x, y: this.targetPosition.y, z: this.targetPosition.z },
      speed: this.speed,
      turnRate: this.turnRate,
      deltaTime: deltaTime,
      currentTime: currentTime,
      pathTime: this.pathTime,
      pathSpeed: this.pathSpeed,
      pathStartTime: this.pathStartTime,
      launched: this.launched,
      exploded: this.exploded,
      lookAheadDistance: this.lookAheadDistance,
      orientationUpdateThreshold: this.orientationUpdateThreshold,
      lastSegmentChangeTime: this.lastSegmentChangeTime,
      waypoints: this.waypoints.map(wp => ({ x: wp.x, y: wp.y, z: wp.z }))
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
        this.position.x += this.velocity.x * deltaTime;
        this.position.y += this.velocity.y * deltaTime;
        this.position.z += this.velocity.z * deltaTime;
        this.missileGroup.position = this.position.clone();
      });
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
    
    // Apply transforms
    this.missileGroup.position = this.position.clone();
    this.missileGroup.rotation = this.rotation.clone();
    
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
    this.light.setEnabled(false);

    // Start explosion effects
    this.fireParticles.emitter = this.position;
    this.explosionSmokeParticles.emitter = this.position;
    this.shockwaveParticles.emitter = this.position;
    this.sparkParticles.emitter = this.position;

    this.fireParticles.start();
    this.explosionSmokeParticles.start();
    this.shockwaveParticles.start();
    this.sparkParticles.start();

    // Destroy the target building if it exists and is close enough
    if (this.targetBuilding && Vector3.Distance(this.position, this.targetBuilding.getPosition()) <= 20) {
      const wasDestroyed = this.targetBuilding.takeDamage(100); // Destroy building instantly
      if (wasDestroyed && this.targetBuilding.isTarget() && this.onTargetDestroyedCallback) {
        this.onTargetDestroyedCallback(this.targetBuilding);
      }
    }

    // Hide missile model
    this.fuselage.setEnabled(false);

    // Clean up after explosion - reduced cleanup time
    setTimeout(() => {
      this.fireParticles.dispose();
      this.trailParticles.dispose();
      this.exhaustParticles.dispose();
      this.shockwaveParticles.dispose();
      this.sparkParticles.dispose();
    }, 1000); // Reduced from 1500

    setTimeout(() => {
      this.explosionSmokeParticles.dispose();
    }, 6000); // Reduced from 8000
  }


  public hasExploded(): boolean {
    return this.exploded;
  }

  public dispose(): void {
    if (this.missileGroup) this.missileGroup.dispose();
    if (this.fireParticles) this.fireParticles.dispose();
    if (this.explosionSmokeParticles) this.explosionSmokeParticles.dispose();
    if (this.trailParticles) this.trailParticles.dispose();
    if (this.exhaustParticles) this.exhaustParticles.dispose();
    if (this.shockwaveParticles) this.shockwaveParticles.dispose();
    if (this.sparkParticles) this.sparkParticles.dispose();
    if (this.light) this.light.dispose();
    if (this.launchAnimationGroup) this.launchAnimationGroup.dispose();
  }

  public setOnTargetDestroyedCallback(callback: (building: Building) => void): void {
    this.onTargetDestroyedCallback = callback;
  }
}
