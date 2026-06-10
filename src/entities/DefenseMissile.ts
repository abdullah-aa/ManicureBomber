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
import { WorkerManager } from '../managers/WorkerManager';
import { LightManager, LightHandle, LightPriority } from '../managers/LightManager';
import { EffectTextures } from '../effects/EffectTextures';
import { ExplosionPool } from '../effects/ExplosionPool';

export class DefenseMissile {
  private scene: Scene;
  private workerManager: WorkerManager;
  private missileGroup: TransformNode;
  private fuselage!: Mesh;
  private position: Vector3;
  private velocity: Vector3;
  private targetPosition: Vector3;
  private bomberVelocity: Vector3;
  private speed: number = 120 + Math.random() * 30; // Variable speed between 120-180 units/sec
  private launched: boolean = false;
  private exploded: boolean = false;
  private exhaustParticles!: ParticleSystem;
  private lightHandle: LightHandle = LightHandle.inert();
  private targetSet: boolean = false; // Performance optimization flag
  private maxAltitude: number = 120 + Math.random() * 80; // Maximum altitude before detonation

  // Trajectory calculation properties
  private trajectoryCalculated: boolean = false;
  private pendingTrajectoryCalculation: boolean = false;

  constructor(
    scene: Scene,
    launchPosition: Vector3,
    targetPosition: Vector3,
    bomberVelocity: Vector3,
    workerManager: WorkerManager,
  ) {
    this.scene = scene;
    this.workerManager = workerManager;
    this.position = launchPosition.clone();
    this.bomberVelocity = bomberVelocity.clone();

    // Initialize with basic values - worker will calculate proper target and velocity
    this.velocity = new Vector3(0, 0, 0);
    this.targetPosition = targetPosition.clone();

    this.missileGroup = new TransformNode('defenseMissileGroup', this.scene);
    this.missileGroup.position = this.position.clone();

    // Set initial orientation toward target
    const direction = this.targetPosition.subtract(this.position).normalize();
    const yaw = Math.atan2(direction.x, direction.z) + Math.PI; // Add 180° to flip missile
    const horizontalSpeed = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
    const pitch = Math.atan2(direction.y, horizontalSpeed) + Math.PI;

    this.missileGroup.rotation.y = yaw;
    this.missileGroup.rotation.x = pitch;

    this.createMissileModel();
    this.setupParticleEffects();
    this.missileGroup.getChildMeshes().forEach((m) => (m.isPickable = false));
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
    // Pooled missile light; follows the missile in world space (never parented)
    this.lightHandle = LightManager.get(this.scene).acquire(LightPriority.MEDIUM);
    this.lightHandle.setColor(1, 0.8, 0.4);
    this.lightHandle.setIntensity(1.5);
    this.lightHandle.setRange(30);
    this.lightHandle.setPosition(this.position);
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
    // Simple position update - no complex calculations needed
    this.position.addInPlace(this.velocity.scale(deltaTime));
    this.missileGroup.position = this.position.clone();

    // Check for altitude-based explosion
    if (this.position.y >= this.maxAltitude) {
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

  public isLaunched(): boolean {
    return this.launched;
  }

  public hasExploded(): boolean {
    return this.exploded;
  }

  public dispose(): void {
    if (this.exhaustParticles) {
      // The pixel exhaust texture is shared via EffectTextures — keep it
      this.exhaustParticles.dispose(false);
    }
    this.lightHandle.release();
    // Dispose part materials with the hierarchy (they are per-missile instances)
    this.missileGroup.dispose(false, true);
  }
}
