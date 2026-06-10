import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
  AbstractMesh,
  TransformNode,
  ParticleSystem,
  Texture,
  Color4,
  Animation,
  AnimationGroup,
  DynamicTexture,
} from '@babylonjs/core';
import { LightManager, LightHandle, LightPriority } from '../managers/LightManager';
import { WorkerManager } from '../managers/WorkerManager';
import { Game } from '../managers/Game';
import { DefenseMissile } from './DefenseMissile';
import { BuildingAssets } from './BuildingAssets';

export enum BuildingType {
  RESIDENTIAL = 'residential',
  COMMERCIAL = 'commercial',
  INDUSTRIAL = 'industrial',
  SKYSCRAPER = 'skyscraper',
}

export interface BuildingConfig {
  position: { x: number; y: number; z: number };
  type: BuildingType;
  width: number;
  height: number;
  depth: number;
  color?: Color3;
  isTarget?: boolean;
  isDefenseLauncher?: boolean;
}

export class Building {
  private scene: Scene;
  private workerManager: WorkerManager;
  private game: Game | null = null;
  private mesh: AbstractMesh;
  private parent: TransformNode;
  private config: BuildingConfig;
  private targetRing: Mesh | null = null;
  private damage: number = 0;
  private maxHealth: number = 100;
  private isDestroyed: boolean = false;
  private fireParticles: ParticleSystem | null = null;
  private smokeParticles: ParticleSystem | null = null;
  private damageLightHandle: LightHandle = LightHandle.inert();
  private damageEffectsInitialized: boolean = false;

  // Defense launcher properties
  private launcherMesh: AbstractMesh | null = null;
  private launcherDestroyed: boolean = false;
  private lastMissileLaunchTime: number = 0;
  private missileLaunchInterval: number = 4 + Math.random() * 6; // Random interval between 4-10 seconds
  private radarScanRange: number = 300; // Detection range

  // Callback for destruction notification
  private onDestroyedCallback: (() => void) | null = null;

  constructor(scene: Scene, config: BuildingConfig, workerManager: WorkerManager) {
    this.scene = scene;
    this.workerManager = workerManager;
    this.config = config;
    this.parent = new TransformNode(`building_${config.type}_${Date.now()}`, scene);
    this.mesh = this.createBuildingMesh();
    this.positionBuilding();

    if (config.isTarget) {
      this.createTargetIndicator();
    }

    if (config.isDefenseLauncher) {
      this.createDefenseLauncher();
    }

    // Buildings never move once placed (destruction is particles + dispose, no
    // collapse animation), so freeze every child transform and skip pointer picking.
    this.parent.computeWorldMatrix(true);
    for (const childMesh of this.parent.getChildMeshes()) {
      childMesh.isPickable = false;
      childMesh.freezeWorldMatrix();
    }

    // Damage effects (fire/smoke particles, damage light) are created lazily on first
    // damage — most buildings are never hit, so allocating them up front is pure waste.
  }

  private createBuildingMesh(): AbstractMesh {
    const { width, height, depth, type } = this.config;

    switch (type) {
      case BuildingType.RESIDENTIAL:
        return this.createResidentialBuilding(width, height, depth);
      case BuildingType.COMMERCIAL:
        return this.createCommercialBuilding(width, height, depth);
      case BuildingType.INDUSTRIAL:
        return this.createIndustrialBuilding(width, height, depth);
      case BuildingType.SKYSCRAPER:
        return this.createSkyscraper(width, height, depth);
      default:
        return this.createBasicBuilding(width, height, depth);
    }
  }

  // Instance of the shared per-type unit box, scaled to the requested dimensions.
  // Instances inherit the source's shared material and batch into a single draw call,
  // so building count no longer multiplies draw calls / materials. (config.color is no
  // longer honored at the mesh level — it is never set by the terrain generator.)
  private boxInstance(name: string, width: number, height: number, depth: number): AbstractMesh {
    const source = BuildingAssets.get(this.scene).getBoxSource(this.config.type);
    const instance = source.createInstance(name);
    instance.scaling.set(width, height, depth);
    instance.parent = this.parent;
    return instance;
  }

  private createBasicBuilding(width: number, height: number, depth: number): AbstractMesh {
    return this.boxInstance(`building_basic`, width, height, depth);
  }

  private createResidentialBuilding(width: number, height: number, depth: number): AbstractMesh {
    const building = this.boxInstance(`building_residential`, width, height, depth);

    // Add a simple roof
    const roof = this.boxInstance(`roof`, width + 2, 2, depth + 2);
    roof.position.y = height / 2 + 1;

    return building;
  }

  private createCommercialBuilding(width: number, height: number, depth: number): AbstractMesh {
    const building = this.boxInstance(`building_commercial`, width, height, depth);

    // Add antenna or signage on top (fixed-size instance of the shared antenna source)
    const antenna = BuildingAssets.get(this.scene).getAntennaSource().createInstance(`antenna`);
    antenna.position.y = height / 2 + 2;
    antenna.parent = this.parent;

    return building;
  }

  private createIndustrialBuilding(width: number, height: number, depth: number): AbstractMesh {
    const building = this.boxInstance(`building_industrial`, width, height, depth);

    // Add smokestacks (scaled instances of the shared unit-cylinder source)
    const stackSource = BuildingAssets.get(this.scene).getSmokestackSource();
    const numStacks = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numStacks; i++) {
      const stack = stackSource.createInstance(`smokestack_${i}`);
      stack.scaling.set(2, height * 0.8, 2);
      stack.position.x = (Math.random() - 0.5) * width * 0.6;
      stack.position.z = (Math.random() - 0.5) * depth * 0.6;
      stack.position.y = height / 2 + (height * 0.8) / 2;
      stack.parent = this.parent;
    }

    return building;
  }

  private createSkyscraper(width: number, height: number, depth: number): AbstractMesh {
    const building = this.boxInstance(`building_skyscraper`, width, height, depth);

    // Add multiple tiers for skyscraper effect
    const tier1 = this.boxInstance(`tier1`, width * 0.8, height * 0.3, depth * 0.8);
    const tier2 = this.boxInstance(`tier2`, width * 0.6, height * 0.2, depth * 0.6);

    tier1.position.y = height / 2 + (height * 0.3) / 2;
    tier2.position.y = height / 2 + height * 0.3 + (height * 0.2) / 2;

    return building;
  }

  private positionBuilding(): void {
    this.parent.position.x = this.config.position.x;
    this.parent.position.z = this.config.position.z;
    this.parent.position.y = 0;
  }

  public getPosition(): Vector3 {
    return this.parent.position;
  }

  public getBounds(): { min: Vector3; max: Vector3 } {
    const pos = this.parent.position;
    const halfWidth = this.config.width / 2;
    const halfDepth = this.config.depth / 2;

    return {
      min: new Vector3(pos.x - halfWidth, pos.y - this.config.height / 2, pos.z - halfDepth),
      max: new Vector3(pos.x + halfWidth, pos.y + this.config.height / 2, pos.z + halfDepth),
    };
  }

  // Optimized distance check using squared distance (avoids sqrt)
  public isWithinRadius(position: Vector3, radius: number): boolean {
    const pos = this.parent.position;
    const dx = position.x - pos.x;
    const dy = position.y - pos.y;
    const dz = position.z - pos.z;
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    return distanceSquared <= radius * radius;
  }

  // Get mesh for Babylon's built-in intersection methods
  public getMesh(): AbstractMesh {
    return this.mesh;
  }

  private createTargetIndicator(): void {
    this.targetRing = MeshBuilder.CreateTorus(
      'targetRing',
      {
        diameter: Math.max(this.config.width, this.config.depth) + 10,
        thickness: 1,
      },
      this.scene,
    );

    this.targetRing.position.y = this.config.height + 5;
    this.targetRing.parent = this.parent;

    this.targetRing.material = BuildingAssets.get(this.scene).getRingMaterial();
  }

  private createDefenseLauncher(): void {
    // Instance of the shared launcher source (fixed 3x2x3); the shared material carries the
    // flashing animation, so all launchers share one animated material and batch together.
    this.launcherMesh = BuildingAssets.get(this.scene).getLauncherSource().createInstance(`launcher_${Date.now()}`);
    this.launcherMesh.position.y = this.config.height;
    this.launcherMesh.parent = this.parent;
  }

  private ensureDamageEffects(): void {
    if (this.damageEffectsInitialized) return;
    this.damageEffectsInitialized = true;
    this.setupDamageEffects();
  }

  private setupDamageEffects(): void {
    const assets = BuildingAssets.get(this.scene);

    // Fire particles for when building is damaged (texture shared across all buildings)
    this.fireParticles = new ParticleSystem('buildingFire', 200, this.scene);
    this.fireParticles.particleTexture = assets.getFireTexture();
    this.fireParticles.emitter = this.parent.position;
    this.fireParticles.minEmitBox = new Vector3(-this.config.width / 2, 0, -this.config.depth / 2);
    this.fireParticles.maxEmitBox = new Vector3(this.config.width / 2, this.config.height, this.config.depth / 2);
    this.fireParticles.color1 = new Color4(1, 0.8, 0, 0.8);
    this.fireParticles.color2 = new Color4(1, 0.3, 0, 0.6);
    this.fireParticles.colorDead = new Color4(0.2, 0, 0, 0.0);
    this.fireParticles.minSize = 1.0;
    this.fireParticles.maxSize = 3.0;
    this.fireParticles.minLifeTime = 0.5;
    this.fireParticles.maxLifeTime = 1.5;
    this.fireParticles.emitRate = 50;
    this.fireParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    this.fireParticles.gravity = new Vector3(0, -2, 0);
    this.fireParticles.direction1 = new Vector3(-1, 2, -1);
    this.fireParticles.direction2 = new Vector3(1, 4, 1);
    this.fireParticles.minEmitPower = 1;
    this.fireParticles.maxEmitPower = 3;
    this.fireParticles.stop();

    // Smoke particles (texture shared across all buildings)
    this.smokeParticles = new ParticleSystem('buildingSmoke', 150, this.scene);
    this.smokeParticles.particleTexture = assets.getSmokeTexture();
    this.smokeParticles.emitter = this.parent.position;
    this.smokeParticles.minEmitBox = new Vector3(
      -this.config.width / 2,
      this.config.height / 2,
      -this.config.depth / 2,
    );
    this.smokeParticles.maxEmitBox = new Vector3(this.config.width / 2, this.config.height, this.config.depth / 2);
    this.smokeParticles.color1 = new Color4(0.3, 0.3, 0.3, 0.6);
    this.smokeParticles.color2 = new Color4(0.5, 0.5, 0.5, 0.4);
    this.smokeParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);
    this.smokeParticles.minSize = 2.0;
    this.smokeParticles.maxSize = 6.0;
    this.smokeParticles.minLifeTime = 2.0;
    this.smokeParticles.maxLifeTime = 4.0;
    this.smokeParticles.emitRate = 30;
    this.smokeParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.smokeParticles.gravity = new Vector3(0, -1, 0);
    this.smokeParticles.direction1 = new Vector3(-0.5, 2, -0.5);
    this.smokeParticles.direction2 = new Vector3(0.5, 3, 0.5);
    this.smokeParticles.minEmitPower = 0.5;
    this.smokeParticles.maxEmitPower = 1.5;
    this.smokeParticles.stop();

  }

  /**
   * Pooled transient damage flash. Burning buildings accumulate over a run, so
   * instead of a permanently held light each hit re-acquires (or refreshes) a
   * low-priority handle that auto-expires after a few seconds — the fire/smoke
   * particles carry the long-term burning look.
   */
  private flashDamageLight(intensity: number): void {
    if (!this.damageLightHandle.isActive()) {
      this.damageLightHandle = LightManager.get(this.scene).acquire(LightPriority.LOW, 4);
      this.damageLightHandle.setColor(1, 0.3, 0);
      this.damageLightHandle.setRange(30);
      const p = this.parent.position;
      this.damageLightHandle.setPositionXYZ(p.x, p.y + this.config.height / 2, p.z);
    } else {
      this.damageLightHandle.setTtl(4);
    }
    this.damageLightHandle.setIntensity(intensity);
  }

  public takeDamage(damage: number, isBombDamage: boolean = false): boolean {
    if (this.isDestroyed) return false;

    this.ensureDamageEffects();

    this.damage += damage;
    const damagePercent = this.damage / this.maxHealth;

    // Start fire and smoke effects when damaged
    if (damagePercent > 0.3 && this.fireParticles && !this.fireParticles.isStarted()) {
      this.fireParticles.start();
    }

    if (damagePercent > 0.5 && this.smokeParticles && !this.smokeParticles.isStarted()) {
      this.smokeParticles.start();
    }

    // Flash the damage light on each hit
    this.flashDamageLight(damagePercent * 2);

    // Check if building is destroyed
    if (this.damage >= this.maxHealth) {
      if (isBombDamage) {
        this.destroyBuildingByBomb();
      } else {
        this.destroyBuilding();
      }
      return true; // Building was destroyed
    }

    return false; // Building still standing
  }

  public destroyLauncher(): void {
    if (this.launcherDestroyed || this.isDestroyed) return;
    this.launcherDestroyed = true;

    this.ensureDamageEffects();

    // Remove the launcher mesh (the threat is gone)
    if (this.launcherMesh) {
      this.launcherMesh.dispose();
      this.launcherMesh = null;
    }

    // Set the building ablaze without destroying it. Carry damage to ~60% so the
    // building visibly burns (fire >30%, smoke >50%) AND a follow-up bomb finishes it.
    // Never reach maxHealth from a Tomahawk — bombing is required for a kill.
    const igniteDamage = this.maxHealth * 0.6;
    this.damage = Math.min(Math.max(this.damage, igniteDamage), this.maxHealth * 0.9);

    if (this.fireParticles && !this.fireParticles.isStarted()) this.fireParticles.start();
    if (this.smokeParticles && !this.smokeParticles.isStarted()) this.smokeParticles.start();
    this.flashDamageLight((this.damage / this.maxHealth) * 2);
  }

  private destroyBuilding(): void {
    this.isDestroyed = true;

    // Trigger destruction callback if set
    if (this.onDestroyedCallback) {
      this.onDestroyedCallback();
    }

    // Create destruction explosion (texture shared across all buildings)
    const explosionParticles = new ParticleSystem('buildingExplosion', 400, this.scene);
    explosionParticles.particleTexture = BuildingAssets.get(this.scene).getExplosionTexture();
    explosionParticles.emitter = this.parent.position;
    explosionParticles.minEmitBox = new Vector3(-this.config.width / 2, 0, -this.config.depth / 2);
    explosionParticles.maxEmitBox = new Vector3(this.config.width / 2, this.config.height, this.config.depth / 2);
    explosionParticles.color1 = new Color4(1, 0.8, 0, 1.0);
    explosionParticles.color2 = new Color4(1, 0.3, 0, 1.0);
    explosionParticles.colorDead = new Color4(0.3, 0.1, 0, 0.0);
    explosionParticles.minSize = 1.0;
    explosionParticles.maxSize = 4.0;
    explosionParticles.minLifeTime = 0.8;
    explosionParticles.maxLifeTime = 2.0;
    explosionParticles.emitRate = 400;
    explosionParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    explosionParticles.gravity = new Vector3(0, -5, 0);
    explosionParticles.direction1 = new Vector3(-3, 3, -3);
    explosionParticles.direction2 = new Vector3(3, 6, 3);
    explosionParticles.minEmitPower = 2;
    explosionParticles.maxEmitPower = 5;
    explosionParticles.manualEmitCount = 400;
    explosionParticles.start();

    // Dispose of explosion particles after time (keep the shared texture)
    setTimeout(() => {
      explosionParticles.dispose(false);
    }, 5000);

    // Fade out and dispose building
    setTimeout(() => {
      this.dispose();
    }, 1000);
  }

  private destroyBuildingByBomb(): void {
    this.isDestroyed = true;

    // Trigger destruction callback if set
    if (this.onDestroyedCallback) {
      this.onDestroyedCallback();
    }

    // Create dramatic bomb destruction explosion (texture shared across all buildings)
    const bombExplosionParticles = new ParticleSystem('buildingBombExplosion', 800, this.scene); // More particles
    bombExplosionParticles.particleTexture = BuildingAssets.get(this.scene).getBombExplosionTexture();
    bombExplosionParticles.emitter = this.parent.position;
    bombExplosionParticles.minEmitBox = new Vector3(-this.config.width / 2, 0, -this.config.depth / 2);
    bombExplosionParticles.maxEmitBox = new Vector3(this.config.width / 2, this.config.height, this.config.depth / 2);
    bombExplosionParticles.color1 = new Color4(1, 0.9, 0, 1.0); // Brighter yellow
    bombExplosionParticles.color2 = new Color4(1, 0.4, 0, 1.0); // Brighter orange
    bombExplosionParticles.colorDead = new Color4(0.3, 0.1, 0, 0.0);
    bombExplosionParticles.minSize = 2.0; // Larger particles
    bombExplosionParticles.maxSize = 6.0; // Larger particles
    bombExplosionParticles.minLifeTime = 1.2; // Longer duration
    bombExplosionParticles.maxLifeTime = 2.5; // Longer duration
    bombExplosionParticles.emitRate = 800; // Higher emission rate
    bombExplosionParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    bombExplosionParticles.gravity = new Vector3(0, -5, 0);
    bombExplosionParticles.direction1 = new Vector3(-5, 5, -5); // More spread
    bombExplosionParticles.direction2 = new Vector3(5, 10, 5); // More spread
    bombExplosionParticles.minEmitPower = 4; // More power
    bombExplosionParticles.maxEmitPower = 8; // More power
    bombExplosionParticles.manualEmitCount = 800;
    bombExplosionParticles.start();

    // Create additional debris particles for bomb destruction (shared texture)
    const debrisParticles = new ParticleSystem('buildingDebris', 300, this.scene);
    debrisParticles.particleTexture = BuildingAssets.get(this.scene).getDebrisTexture();
    debrisParticles.emitter = this.parent.position;
    debrisParticles.minEmitBox = new Vector3(-this.config.width / 2, 0, -this.config.depth / 2);
    debrisParticles.maxEmitBox = new Vector3(this.config.width / 2, this.config.height, this.config.depth / 2);
    debrisParticles.color1 = new Color4(0.6, 0.6, 0.6, 1.0);
    debrisParticles.color2 = new Color4(0.4, 0.4, 0.4, 0.8);
    debrisParticles.colorDead = new Color4(0.2, 0.2, 0.2, 0.0);
    debrisParticles.minSize = 0.5;
    debrisParticles.maxSize = 2.0;
    debrisParticles.minLifeTime = 2.0;
    debrisParticles.maxLifeTime = 4.0;
    debrisParticles.emitRate = 300;
    debrisParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    debrisParticles.gravity = new Vector3(0, -15, 0); // Stronger gravity for debris
    debrisParticles.direction1 = new Vector3(-8, 3, -8);
    debrisParticles.direction2 = new Vector3(8, 8, 8);
    debrisParticles.minEmitPower = 3;
    debrisParticles.maxEmitPower = 6;
    debrisParticles.manualEmitCount = 300;
    debrisParticles.start();

    // Dispose of explosion particles after time (keep the shared textures)
    setTimeout(() => {
      bombExplosionParticles.dispose(false);
      debrisParticles.dispose(false);
    }, 6000); // Longer duration for bomb effects

    // Fade out and dispose building
    setTimeout(() => {
      this.dispose();
    }, 1500); // Slightly longer delay
  }

  public isTarget(): boolean {
    return this.config.isTarget || false;
  }

  public getIsDestroyed(): boolean {
    return this.isDestroyed;
  }

  public setOnDestroyedCallback(callback: () => void): void {
    this.onDestroyedCallback = callback;
  }

  public setGame(game: Game): void {
    this.game = game;
  }

  public getMaxHeight(): number {
    return this.config.height;
  }

  public updateDefenseLauncher(
    bomberPosition: Vector3,
    bomberVelocity: Vector3,
    currentTime: number,
    deltaTime: number,
  ): void {
    if (!this.isDefenseLauncher() || this.isDestroyed || !this.game) return;

    // Check if we should launch a new missile
    const distanceToBomber = Vector3.Distance(this.getPosition(), bomberPosition);
    if (
      distanceToBomber <= this.radarScanRange &&
      currentTime - this.lastMissileLaunchTime >= this.missileLaunchInterval
    ) {
      this.launchDefenseMissile(bomberPosition, bomberVelocity);
      this.lastMissileLaunchTime = currentTime;

      // Randomize the next launch interval for more dynamic behavior
      this.missileLaunchInterval = 3 + Math.random() * 8; // 3-11 seconds
    }
  }

  private launchDefenseMissile(bomberPosition: Vector3, bomberVelocity: Vector3): void {
    if (!this.isDefenseLauncher() || this.isDestroyed || !this.game) return;

    const launchPosition = this.getPosition().clone();
    launchPosition.y += this.config.height + 3; // Launch from top of launcher

    // Pass bomber data to missile for worker-based target calculation
    const missile = new DefenseMissile(this.scene, launchPosition, bomberPosition, bomberVelocity, this.workerManager);
    missile.launch();
    this.game.addDefenseMissile(missile);
  }

  public isDefenseLauncher(): boolean {
    return (this.config.isDefenseLauncher || false) && !this.launcherDestroyed;
  }

  public dispose(): void {
    if (this.targetRing) this.targetRing.dispose();
    // dispose(false): their textures are the shared BuildingAssets fire/smoke textures
    if (this.fireParticles) this.fireParticles.dispose(false);
    if (this.smokeParticles) this.smokeParticles.dispose(false);
    this.damageLightHandle.release();
    if (this.launcherMesh) this.launcherMesh.dispose();

    this.parent.dispose();
  }
}
