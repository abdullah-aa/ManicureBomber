import { Scene, Vector3, AbstractMesh, TransformNode, ParticleSystem, Color4, Observer } from '@babylonjs/core';
import { LightManager, LightHandle, LightPriority } from '../managers/LightManager';
import { WorkerManager } from '../managers/WorkerManager';
import { Game } from '../managers/Game';
import { DefenseMissile } from './DefenseMissile';
import { BuildingAssets } from './BuildingAssets';
import { buildingApexHeight } from '../workers/worker-utils';
import { ExplosionPool } from '../effects/ExplosionPool';
import { LAUNCHER_RADAR_RANGE } from '../config/Balance';

// One source of truth for the building type/config shapes: the Babylon-free
// definitions in worker-utils (the worker generates the configs; this class
// consumes them). Re-exported so existing `from './Building'` imports keep
// working — the two files used to carry duplicate declarations kept
// assignment-compatible only by their string values.
export { BuildingType } from '../workers/worker-utils';
export type { BuildingConfig } from '../workers/worker-utils';
import { BuildingType, BuildingConfig } from '../workers/worker-utils';

export class Building {
  /**
   * Global burning-building budget. AI-mode runs leave dozens of ignited
   * buildings behind, each carrying a 200-particle fire + 150-particle smoke
   * system that would otherwise animate until its chunk unloads. At the cap the
   * OLDEST burning building is extinguished (systems disposed, lazy-init flag
   * reset so a later hit rebuilds them), keeping scene.particleSystems bounded.
   */
  private static readonly MAX_BURNING = 10;
  private static burning: Building[] = [];

  /**
   * The base sits this far below the sampled terrain height. The worker already
   * rests the base on the lowest ground under the footprint corners
   * (terrain.worker.ts, minCornerHeight); this margin covers the residual
   * difference between the worker's heightmap samples and the rendered mesh's
   * triangle interpolation, so no downhill edge ever shows air under the box.
   */
  private static readonly TERRAIN_SINK = 2;

  /**
   * Bomb-kill collapse: sink under the pooled fireball for this long (the old
   * timed-dispose pop was also 1.5s, so the cover window is proven).
   */
  private static readonly COLLAPSE_DURATION = 1.5;
  /** Smoke smolders over the rubble this long after the collapse, then fades. */
  private static readonly SMOLDER_DURATION = 15;
  /**
   * Debris arc: stronger than the bombs' constant 50 u/s fall so short throws
   * feel snappy; pieces launched ~6-18 u/s up land within ~1-1.5s, inside the
   * fireball's cover window.
   */
  private static readonly DEBRIS_GRAVITY = 60;

  private scene: Scene;
  private workerManager: WorkerManager;
  private game: Game | null = null;
  private mesh: AbstractMesh;
  private parent: TransformNode;
  private config: BuildingConfig;
  private targetRing: AbstractMesh | null = null;
  private damage: number = 0;
  private maxHealth: number = 100;
  private isDestroyed: boolean = false;
  // Set by dispose() (chunk unload or post-destruction teardown). Holders of
  // stale refs (AI target, radar cache, mid-flight Tomahawk, panic anchor) see
  // a disposed building as destroyed via getIsDestroyed().
  private disposed: boolean = false;
  private fireParticles: ParticleSystem | null = null;
  private smokeParticles: ParticleSystem | null = null;
  private damageLightHandle: LightHandle = LightHandle.inert();
  private damageEffectsInitialized: boolean = false;

  // Bomb-kill aftermath state. All of it is cleaned in dispose() — chunk unload
  // can land mid-collapse or mid-smolder.
  private collapseObserver: Observer<Scene> | null = null;
  private debrisObserver: Observer<Scene> | null = null;
  private pendingTimeouts: ReturnType<typeof setTimeout>[] = [];
  private rubbleMeshes: AbstractMesh[] = [];

  // Defense launcher properties
  private launcherMesh: AbstractMesh | null = null;
  private launcherDestroyed: boolean = false;
  private lastMissileLaunchTime: number = 0;
  private missileLaunchInterval: number = 4 + Math.random() * 6; // Random interval between 4-10 seconds
  private radarScanRange: number = LAUNCHER_RADAR_RANGE; // outranges the Tomahawk (contract in Balance.ts)

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

    // Buildings never move once placed, so freeze every child transform and skip
    // pointer picking. (Bomb kills DO move the parent — beginCollapse unfreezes
    // the children for the sink before disposing them.)
    this.parent.computeWorldMatrix(true);
    for (const childMesh of this.parent.getChildMeshes()) {
      childMesh.isPickable = false;
      childMesh.freezeWorldMatrix();
      // Each instance owns its BoundingInfo (built at createInstance), so sync it
      // to world space once and opt out of the per-frame bounds sync — the frozen
      // transform can never move the bounds again (terrain chunk's pattern).
      childMesh.getBoundingInfo().update(childMesh.getWorldMatrix());
      childMesh.doNotSyncBoundingInfo = true;
    }

    // Damage effects (fire/smoke particles, damage light) are created lazily on first
    // damage — most buildings are never hit, so allocating them up front is pure waste.
  }

  private createBuildingMesh(): AbstractMesh {
    const { width, height, depth, type } = this.config;

    // Launcher buildings get a flat roof (no slab/antenna/stacks/tiers): the
    // launcher owns the rooftop, so it is never enclosed by rooftop features and
    // the Tomahawk aim point (base + getMaxHeight()) is exactly where it sits.
    if (this.config.isDefenseLauncher) {
      return this.boxInstance(`building_${type}`, width, height, depth);
    }

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
  // The source box is origin-centered, so lift each instance by height/2: every box's
  // BASE rests on local y = 0 (it spans 0..height above the parent). Rooftop callers
  // (roof slab, skyscraper tiers) overwrite position.y after the call.
  private boxInstance(name: string, width: number, height: number, depth: number): AbstractMesh {
    const source = BuildingAssets.get(this.scene).getBoxSource(this.config.type);
    const instance = source.createInstance(name);
    instance.scaling.set(width, height, depth);
    instance.position.y = height / 2;
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
    roof.position.y = height + 1;

    return building;
  }

  private createCommercialBuilding(width: number, height: number, depth: number): AbstractMesh {
    const building = this.boxInstance(`building_commercial`, width, height, depth);

    // Add antenna or signage on top (fixed-size instance of the shared antenna source)
    const antenna = BuildingAssets.get(this.scene).getAntennaSource().createInstance(`antenna`);
    antenna.position.y = height + 2;
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
      stack.position.y = height + (height * 0.8) / 2;
      stack.parent = this.parent;
    }

    return building;
  }

  private createSkyscraper(width: number, height: number, depth: number): AbstractMesh {
    const building = this.boxInstance(`building_skyscraper`, width, height, depth);

    // Add multiple tiers for skyscraper effect
    const tier1 = this.boxInstance(`tier1`, width * 0.8, height * 0.3, depth * 0.8);
    const tier2 = this.boxInstance(`tier2`, width * 0.6, height * 0.2, depth * 0.6);

    tier1.position.y = height + (height * 0.3) / 2;
    tier2.position.y = height + height * 0.3 + (height * 0.2) / 2;

    return building;
  }

  private positionBuilding(): void {
    this.parent.position.x = this.config.position.x;
    this.parent.position.z = this.config.position.z;
    // config.position.y is the terrain height sampled by the worker at placement.
    // The box spans 0..height above the parent (see boxInstance), so buildings stand
    // full height on the terrain; the parent is sunk TERRAIN_SINK below the sampled
    // height so downhill corners on sloped ground never show air under the box.
    this.parent.position.y = this.config.position.y - Building.TERRAIN_SINK;
  }

  public getPosition(): Vector3 {
    return this.parent.position;
  }

  public getBounds(): { min: Vector3; max: Vector3 } {
    const pos = this.parent.position;
    const halfWidth = this.config.width / 2;
    const halfDepth = this.config.depth / 2;

    return {
      min: new Vector3(pos.x - halfWidth, pos.y, pos.z - halfDepth),
      max: new Vector3(pos.x + halfWidth, pos.y + this.config.height, pos.z + halfDepth),
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
    // Instance of the shared unit torus, scaled uniformly to the target diameter —
    // all rings batch into one draw call instead of a unique CreateTorus each.
    // Tube thickness now scales with the diameter (unit-source tradeoff; accepted).
    const ring = BuildingAssets.get(this.scene).getRingSource().createInstance('targetRing');
    ring.scaling.setAll(Math.max(this.config.width, this.config.depth) + 10);
    ring.position.y = this.getApexHeight() + 5;
    ring.parent = this.parent;
    this.targetRing = ring;
  }

  private createDefenseLauncher(): void {
    // Instance of the shared launcher source (fixed 3x2x3); the shared material carries the
    // flashing animation, so all launchers share one animated material and batch together.
    this.launcherMesh = BuildingAssets.get(this.scene).getLauncherSource().createInstance(`launcher_${Date.now()}`);
    // The source box is origin-centered and 2 tall, so +1 rests its base on the
    // building's flat roof (launcher buildings skip rooftop features — see
    // createBuildingMesh); it spans height..height+2.
    this.launcherMesh.position.y = this.config.height + 1;
    this.launcherMesh.parent = this.parent;
  }

  private ensureDamageEffects(): void {
    if (this.damageEffectsInitialized) return;
    this.damageEffectsInitialized = true;
    // Claim a burning slot, stealing from the oldest at the cap.
    if (Building.burning.length >= Building.MAX_BURNING) {
      Building.burning.shift()!.extinguish();
    }
    Building.burning.push(this);
    this.setupDamageEffects();
  }

  /**
   * Budget steal: stop and dispose the fire/smoke systems. Their emitters are
   * this building's own position Vector3, so nothing is left pointing at freed
   * state; dispose(false) keeps the shared BuildingAssets textures. Resetting
   * damageEffectsInitialized lets a later hit rebuild the effects lazily.
   */
  private extinguish(): void {
    if (this.fireParticles) {
      this.fireParticles.dispose(false);
      this.fireParticles = null;
    }
    if (this.smokeParticles) {
      this.smokeParticles.dispose(false);
      this.smokeParticles = null;
    }
    this.damageEffectsInitialized = false;
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

  /** Building's volumetric center (parent sits at the base) — pooled-explosion anchor. */
  private explosionCenter(): Vector3 {
    const p = this.parent.position;
    return new Vector3(p.x, p.y + this.config.height / 2, p.z);
  }

  /** Emit through the building's whole box so the burst keeps its old volume look. */
  private explosionHalfExtents(): Vector3 {
    return new Vector3(this.config.width / 2, this.config.height / 2, this.config.depth / 2);
  }

  private destroyBuilding(): void {
    this.isDestroyed = true;

    // Trigger destruction callback if set
    if (this.onDestroyedCallback) {
      this.onDestroyedCallback();
    }

    // Pooled explosion instead of a fresh 400-particle system + timed dispose.
    // Fire only, matching the original single-system missile-kill look; taller
    // buildings get a bigger burst.
    ExplosionPool.get(this.scene).explode(
      this.explosionCenter(),
      Math.min(2, Math.max(1, 0.9 + this.config.height / 50)),
      { smoke: false, shockwave: false, sparks: false, emitHalfExtents: this.explosionHalfExtents() },
    );

    // Fade out and dispose building (tracked: chunk unload inside this window
    // would otherwise dispose first and let the timer double-dispose)
    this.pendingTimeouts.push(
      setTimeout(() => {
        this.dispose();
      }, 1000),
    );
  }

  private destroyBuildingByBomb(): void {
    this.isDestroyed = true;

    // Trigger destruction callback if set
    if (this.onDestroyedCallback) {
      this.onDestroyedCallback();
    }

    // Bomb kills get the full pooled treatment at a larger scale — the pool's
    // smoke/sparks/shockwave stand in for the old separate 300-particle debris
    // system (was 800+300 fresh particles per kill).
    ExplosionPool.get(this.scene).explode(
      this.explosionCenter(),
      Math.min(2.5, Math.max(1.25, 1.1 + this.config.height / 40)),
      { emitHalfExtents: this.explosionHalfExtents() },
    );

    // Aftermath instead of the old 1.5s dispose pop: rubble first (hidden inside
    // the fireball and the still-standing box), smolder retarget while the parent
    // is still at its start height, then the sink. The building now lives until
    // its chunk unloads (destroyed buildings already stay in chunk.buildings).
    this.spawnRubble();
    this.launchDebris();
    this.beginSmolder();
    this.beginCollapse();
  }

  /**
   * Chunks blasted out of the building: small boxes ejected outward/upward from
   * the upper structure that arc under gravity, tumble, and settle around the
   * pad as extra scattered rubble. Same shared source as the pile, so they add
   * zero draw calls; they join rubbleMeshes at spawn, so chunk-unload dispose
   * covers them in every state (mid-flight included). Ground height is the
   * worker's footprint sample — pieces land within ~25u of the pad, so slope
   * error stays small and the 40%-buried rest pose hides it.
   */
  private launchDebris(): void {
    const source = BuildingAssets.get(this.scene).getBoxSource(BuildingType.SKYSCRAPER);
    const { width, height, depth } = this.config;
    const px = this.parent.position.x;
    const pz = this.parent.position.z;
    const groundY = this.config.position.y;

    interface DebrisPiece {
      mesh: AbstractMesh;
      vx: number; vy: number; vz: number;
      rx: number; rz: number; // tumble rates, rad/s
      landed: boolean;
    }
    const count = 8 + Math.floor(Math.random() * 4);
    const pieces: DebrisPiece[] = [];
    for (let i = 0; i < count; i++) {
      const mesh = source.createInstance(`debris_${i}`);
      const s = 0.8 + Math.random() * Math.min(width, depth) * 0.06;
      mesh.scaling.set(s, s * (0.6 + Math.random() * 0.8), s);
      mesh.position.set(
        px + (Math.random() - 0.5) * width * 0.5,
        groundY + height * (0.3 + Math.random() * 0.6), // upper structure
        pz + (Math.random() - 0.5) * depth * 0.5,
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      mesh.isPickable = false;
      // Outward from the building axis (jittered) + up: reads as blast ejecta.
      const ang = Math.atan2(mesh.position.z - pz, mesh.position.x - px) + (Math.random() - 0.5) * 0.8;
      const hSpeed = 8 + Math.random() * 14;
      pieces.push({
        mesh,
        vx: Math.cos(ang) * hSpeed,
        vy: 6 + Math.random() * 12,
        vz: Math.sin(ang) * hSpeed,
        rx: (Math.random() - 0.5) * 6,
        rz: (Math.random() - 0.5) * 6,
        landed: false,
      });
      this.rubbleMeshes.push(mesh);
    }

    let elapsed = 0;
    this.debrisObserver = this.scene.onBeforeRenderObservable.add(() => {
      // dt clamp keeps a frame hitch from tunneling pieces far underground.
      const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.05);
      elapsed += dt;
      let flying = 0;
      for (const p of pieces) {
        if (p.landed) continue;
        p.vy -= Building.DEBRIS_GRAVITY * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.mesh.rotation.x += p.rx * dt;
        p.mesh.rotation.z += p.rz * dt;
        // Land once falling into the ground (or at the 4s safety cap): rest
        // ~40% buried, then the constructor freeze pattern — debris never
        // moves again and rejoins the static-rubble cost profile.
        if ((p.vy < 0 && p.mesh.position.y <= groundY + 0.3) || elapsed > 4) {
          p.mesh.position.y = groundY + 0.3;
          p.mesh.freezeWorldMatrix();
          p.mesh.getBoundingInfo().update(p.mesh.getWorldMatrix());
          p.mesh.doNotSyncBoundingInfo = true;
          p.landed = true;
        } else {
          flying++;
        }
      }
      if (flying === 0 && this.debrisObserver) {
        this.scene.onBeforeRenderObservable.remove(this.debrisObserver);
        this.debrisObserver = null;
      }
    });
  }

  /**
   * Tumbled rubble pile revealed as the building sinks. Instances of the shared
   * SKYSCRAPER box source: the darkest existing building material reads as
   * charred debris, and every pile from every victim type batches into that one
   * instance group — no new materials or sources. World-space and unparented:
   * the parent is about to sink, so rubble must not ride it down.
   */
  private spawnRubble(): void {
    const source = BuildingAssets.get(this.scene).getBoxSource(BuildingType.SKYSCRAPER);
    const { width, depth } = this.config;
    const px = this.parent.position.x;
    const pz = this.parent.position.z;
    // Worker-sampled terrain height at the footprint (positionBuilding sank the
    // parent TERRAIN_SINK below it) — the building has no TerrainManager access,
    // and this sample is what it already stands on.
    const groundY = this.config.position.y;

    const count = 5 + Math.min(4, Math.floor((width * depth) / 200));
    for (let i = 0; i < count; i++) {
      const piece = source.createInstance(`rubble_${i}`);
      piece.scaling.set(
        width * (0.15 + Math.random() * 0.2),
        1.5 + Math.random() * 2, // tall enough to clear the rendered surface on slopes
        depth * (0.15 + Math.random() * 0.2),
      );
      piece.position.set(
        px + (Math.random() - 0.5) * width * 0.6, // center-biased: stays on the pad
        groundY + 0.2 + Math.random(), // base interpenetrates the ground
        pz + (Math.random() - 0.5) * depth * 0.6,
      );
      piece.rotation.set(
        (Math.random() - 0.5) * 0.5, // ±~14° pitch/roll tumble
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.5,
      );
      // Constructor pattern: rubble never moves after placement.
      // (freezeWorldMatrix computes the world matrix itself before freezing.)
      piece.isPickable = false;
      piece.freezeWorldMatrix();
      piece.getBoundingInfo().update(piece.getWorldMatrix());
      piece.doNotSyncBoundingInfo = true;
      this.rubbleMeshes.push(piece);
    }
  }

  /**
   * Re-task the burning effects for the aftermath: fire dies with the building
   * (stop() lets live particles fade) and smoke drops to a low, wide smolder
   * over the rubble. The smoke emitter is this.parent.position — a live ref
   * about to sink underground — so it is re-pointed at a NEW static
   * ground-level Vector3. min/maxEmitBox/emitRate are plain fields sampled per
   * emit, so retargeting a started system is safe. Called before beginCollapse
   * so the parent is still at its start height.
   */
  private beginSmolder(): void {
    if (this.fireParticles) this.fireParticles.stop();

    if (this.smokeParticles) {
      const p = this.parent.position;
      this.smokeParticles.emitter = new Vector3(p.x, this.config.position.y, p.z);
      this.smokeParticles.minEmitBox = new Vector3(-this.config.width * 0.3, 0, -this.config.depth * 0.3);
      this.smokeParticles.maxEmitBox = new Vector3(this.config.width * 0.3, 3, this.config.depth * 0.3);
      this.smokeParticles.emitRate = 12; // smolder, not blaze (burning look is 30)
      if (!this.smokeParticles.isStarted()) this.smokeParticles.start();
    }

    // Smolder tail, then free the burning-budget slot: a dead building must not
    // pin one of the MAX_BURNING slots until chunk unload (a full stick would
    // hog half the budget). Null-checked throughout — a budget steal can
    // extinguish() this building mid-smolder. Handles are cleared in dispose().
    this.pendingTimeouts.push(setTimeout(() => {
      if (this.smokeParticles) this.smokeParticles.stop();
      this.pendingTimeouts.push(setTimeout(() => {
        const idx = Building.burning.indexOf(this);
        if (idx !== -1) Building.burning.splice(idx, 1);
        this.extinguish(); // safe on a corpse: takeDamage guards isDestroyed, never re-inits
      }, 4500)); // > smoke maxLifeTime (4s): let the last puffs die first
    }, Building.SMOLDER_DURATION * 1000));
  }

  /**
   * Sink-and-tilt collapse driver, self-contained per building (no Game.ts
   * hook). Children were frozen at construction and frozen world matrices
   * ignore parent movement, so unfreeze them for the ride. Bounds stay stale
   * (doNotSyncBoundingInfo): the building only ever sinks BELOW its old AABB,
   * so the worst case is drawing a fully buried box the terrain occludes.
   */
  private beginCollapse(): void {
    for (const childMesh of this.parent.getChildMeshes()) {
      childMesh.unfreezeWorldMatrix();
    }

    const startY = this.parent.position.y;
    // Apex (tiers/stacks/antenna, or launcher box) + margin > TERRAIN_SINK, so
    // nothing pokes out at full sink even with the tilt.
    const sinkDepth = this.getApexHeight() + 4;
    // Random horizontal tilt axis, 6-8 degrees — enough lean to sell the
    // collapse without swinging the top out from under the fireball.
    const tilt = (6 + Math.random() * 2) * (Math.PI / 180);
    const tiltDir = Math.random() * Math.PI * 2;
    const tiltX = Math.cos(tiltDir) * tilt;
    const tiltZ = Math.sin(tiltDir) * tilt;

    let elapsed = 0;
    this.collapseObserver = this.scene.onBeforeRenderObservable.add(() => {
      elapsed += this.scene.getEngine().getDeltaTime() / 1000;
      const t = Math.min(elapsed / Building.COLLAPSE_DURATION, 1);
      const ease = t * t; // accelerating plunge: shear slowly, then drop
      this.parent.position.y = startY - sinkDepth * ease;
      this.parent.rotation.x = tiltX * ease;
      this.parent.rotation.z = tiltZ * ease;
      if (t >= 1) this.finishCollapse(startY);
    });
  }

  /**
   * End of the sink: dispose the buried geometry and put the parent back.
   * Restoring position/rotation keeps getPosition() — a live ref read by
   * radar/AI/panic-view/bomb falloff on destroyed buildings — byte-identical
   * to its pre-collapse value.
   */
  private finishCollapse(startY: number): void {
    if (this.collapseObserver) {
      this.scene.onBeforeRenderObservable.remove(this.collapseObserver);
      this.collapseObserver = null;
    }
    for (const childMesh of this.parent.getChildMeshes()) {
      childMesh.dispose();
    }
    // Both were children of the parent — disposed just above; null the fields so
    // dispose() doesn't re-dispose them.
    this.targetRing = null;
    this.launcherMesh = null;
    this.parent.position.y = startY;
    this.parent.rotation.set(0, 0, 0);
  }

  public isTarget(): boolean {
    return this.config.isTarget || false;
  }

  public getIsDestroyed(): boolean {
    return this.isDestroyed || this.disposed;
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

  /**
   * Local-space height of the visible summit: rooftop features (tiers, stacks,
   * antenna, roof slab) for normal buildings, the launcher box top for launcher
   * buildings (flat roof, see createBuildingMesh). Keyed on config.isDefenseLauncher
   * (permanent geometry), NOT the live isDefenseLauncher() method, which flips
   * false when the launcher is destroyed. getMaxHeight() stays the main box top —
   * the Tomahawk aim point and the launcher's roof.
   */
  public getApexHeight(): number {
    if (this.config.isDefenseLauncher) return this.config.height + 2;
    return buildingApexHeight(this.config.type, this.config.height);
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
    launchPosition.y += this.config.height + 3; // 1 above the launcher box top (roof..roof+2)

    // Pooled: re-arms a parked missile instead of building a fresh mesh/material/
    // particle set every 3-11s (Game's sweep releases it back after airburst)
    const missile = DefenseMissile.acquire(this.scene, launchPosition, bomberPosition, bomberVelocity, this.workerManager);
    missile.launch();
    this.game.addDefenseMissile(missile);
  }

  public isDefenseLauncher(): boolean {
    return (this.config.isDefenseLauncher || false) && !this.launcherDestroyed;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Chunk unload can land mid-collapse or mid-smolder: kill the driver and the
    // pending timers first so nothing fires against disposed meshes.
    if (this.collapseObserver) {
      this.scene.onBeforeRenderObservable.remove(this.collapseObserver);
      this.collapseObserver = null;
    }
    if (this.debrisObserver) {
      this.scene.onBeforeRenderObservable.remove(this.debrisObserver);
      this.debrisObserver = null;
    }
    for (const handle of this.pendingTimeouts) clearTimeout(handle);
    this.pendingTimeouts.length = 0;
    for (const piece of this.rubbleMeshes) piece.dispose();
    this.rubbleMeshes.length = 0;

    // Free this building's burning-budget slot
    const burnIdx = Building.burning.indexOf(this);
    if (burnIdx !== -1) Building.burning.splice(burnIdx, 1);

    if (this.targetRing) this.targetRing.dispose();
    // dispose(false): their textures are the shared BuildingAssets fire/smoke textures
    if (this.fireParticles) this.fireParticles.dispose(false);
    if (this.smokeParticles) this.smokeParticles.dispose(false);
    this.damageLightHandle.release();
    if (this.launcherMesh) this.launcherMesh.dispose();

    this.parent.dispose();
  }
}
