import {
  Scene,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  Color3,
  FreeCamera,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
} from '@babylonjs/core';
import { Bomber } from '../entities/Bomber';
import { TerrainManager } from './TerrainManager';
import { InputManager } from './InputManager';
import { CameraController, RocketViewCandidate, RocketViewKind } from './CameraController';
import { Bomb } from '../entities/Bomb';
import { IskanderMissile } from '../entities/IskanderMissile';
import { DefenseMissile } from '../entities/DefenseMissile';
import { UIManager } from '../ui/UIManager';
import { RadarManager } from '../ui/RadarManager';
import { WorkerManager } from './WorkerManager';
import { Building } from '../entities/Building';
import { AIController } from './AIController';
import { ExplosionPool } from '../effects/ExplosionPool';

export class Game {
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private bomber!: Bomber;
  private terrainManager!: TerrainManager;
  private inputManager!: InputManager;
  private cameraController!: CameraController;
  private camera!: FreeCamera;
  private uiManager!: UIManager;
  private radarManager!: RadarManager;
  private groundCrosshair!: Mesh;
  private workerManager!: WorkerManager;
  private aiController!: AIController;

  // Bombing properties
  private bombs: Bomb[] = [];
  private isBombingRun: boolean = false;
  private bombingRunCooldown: number = 15; // 15 seconds
  private lastBombingRunTime: number = -Infinity; // Start with cooldown finished
  private bombsToDrop: number = 0;
  private lastBombDropTime: number = 0;

  // Iskander missile system
  private iskanderMissiles: IskanderMissile[] = [];
  private iskanderExplodedAt: Map<IskanderMissile, number> = new Map();
  // Recomputed once per frame; read by AI, countermeasures, and the UI tick
  private iskanderAlertActive: boolean = false;
  // Distance to the nearest locking/locked Iskander (Infinity when none); the AI
  // uses it to hold flares until the missile is actually close
  private closestIskanderThreatDistance: number = Infinity;
  private nextIskanderLaunchTime: number = -Infinity;
  private iskanderLaunchInterval: number = 30;
  private iskanderRandomInterval: number = 45;

  // Defense missile system - centralized management
  private defenseMissiles: DefenseMissile[] = [];
  // Defer disposal ~1.5s after explosion so Rocket View can hold on the blast and
  // the airburst finishes (mirrors iskanderExplodedAt).
  private defenseExplodedAt: Map<DefenseMissile, number> = new Map();
  // Reused descriptor returned by getRocketViewCandidate() — the camera copies its
  // fields out synchronously, so a single instance avoids per-frame allocation.
  private rocketCandidate: RocketViewCandidate = { missile: null as any, kind: RocketViewKind.Iskander };

  // Scoring system
  private destroyedBuildings: number = 0;
  private destroyedTargets: number = 0;

  // Game state
  private gameOver: boolean = false;
  private started: boolean = false; // Gameplay is paused until the player dismisses the splash screen

  private lastTerrainUpdateTime: number = 0;
  private terrainUpdateInterval: number = 100; // Re-evaluate streaming often so terrain leads turns
  private lastDefenseUpdateTime: number = 0;
  private defenseUpdateInterval: number = 50; // Update defense every 50ms
  private lastUIUpdateTime: number = 0;
  private uiUpdateInterval: number = 50; // Update UI every 50ms
  private lastRadarUpdateTime: number = 0;
  private radarUpdateInterval: number = 100; // Update radar every 100ms
  private lastCollisionCheckTime: number = 0;
  private collisionCheckInterval: number = 16; // Check collisions every 16ms (60fps)

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;
    // Touch-first game: pointer moves never need a pick ray (input reads raw
    // client coordinates), so skip Babylon's per-move scene picking entirely.
    this.scene.skipPointerMovePicking = true;
    this.canvas = canvas;
  }

  public initialize(): Promise<void> {
    this.setupLighting();
    this.setupCamera();

    // Initialize worker manager first
    this.workerManager = new WorkerManager();

    this.terrainManager = new TerrainManager(this.scene, this.workerManager);
    this.terrainManager.setGame(this);

    this.bomber = new Bomber(this.scene, this.workerManager);
    this.bomber.setBombingRunActiveCallback(() => this.isBombingRunInProgress());
    this.bomber.setOnDestroyedCallback(() => this.handleGameOver());
    this.bomber.setOnTargetDestroyedCallback((building: Building) => {
      if (building.isTarget()) {
        this.destroyedTargets++;
      }
    });

    this.cameraController = new CameraController(this.camera, this.bomber, this.terrainManager);
    // Provider injection keeps CameraController free of a Game import (Game already
    // imports CameraController)
    this.cameraController.setMissileProvider(() => this.getRocketViewCandidate());

    this.inputManager = new InputManager(this.scene, this.canvas);
    this.aiController = new AIController(this, this.bomber, this.terrainManager, this.inputManager);
    this.uiManager = new UIManager(this, this.inputManager);

    // Expose UIManager to global scope for HTML event handlers
    (window as any).uiManager = this.uiManager;

    this.radarManager = new RadarManager();
    this.createGroundCrosshair();

    this.bomber.setTerrainManager(this.terrainManager);
    this.terrainManager.setBomber(this.bomber);

    return this.terrainManager.generateInitialTerrain(this.bomber.getPosition()).then(() => {
      // Initialize first Iskander launch time
      const initialInterval = this.iskanderLaunchInterval + Math.random() * this.iskanderRandomInterval;
      this.nextIskanderLaunchTime = performance.now() / 1000 + initialInterval;

      this.startGameLoop();
    });
  }

  /**
   * Begin gameplay. Called when the player dismisses the splash screen.
   */
  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    // Reset the Iskander attack timer so time spent reading the splash screen
    // doesn't immediately count against the player.
    const initialInterval = this.iskanderLaunchInterval + Math.random() * this.iskanderRandomInterval;
    this.nextIskanderLaunchTime = performance.now() / 1000 + initialInterval;
  }

  private setupLighting(): void {
    const hemisphericLight = new HemisphericLight('hemisphericLight', new Vector3(0, 1, 0), this.scene);
    hemisphericLight.intensity = 0.3;

    const directionalLight = new DirectionalLight('directionalLight', new Vector3(-1, -1, -1), this.scene);
    directionalLight.intensity = 0.8;
    directionalLight.diffuse = new Color3(1, 0.9, 0.7);

    // Pre-warm the shared explosion pool (and its effect textures) before combat
    // so no particle systems or textures are ever built mid-fight.
    ExplosionPool.get(this.scene);
  }

  private setupCamera(): void {
    // Initial framing matches the bomber's spawn altitude (175) + default follow height
    this.camera = new FreeCamera('camera', new Vector3(0, 255, -200), this.scene);
    this.camera.setTarget(new Vector3(0, 175, 0));
    // Limit the far clip plane to cull distant terrain. Must sit beyond the fog end
    // (fogEnd = 1500, set in TerrainManager.createClearSky) so terrain fully fades to sky.
    this.camera.maxZ = 1700;
    // Don't attach built-in controls - we handle camera movement manually via CameraController
    // this.camera.attachControl(this.canvas, true);
  }

  private createGroundCrosshair(): void {
    this.groundCrosshair = MeshBuilder.CreatePlane('groundCrosshair', { size: 10 }, this.scene);
    this.groundCrosshair.rotation.x = Math.PI / 2;
    this.groundCrosshair.isPickable = false;

    // Terrain has elevation (0-60 units) but the crosshair sits at Y=1, so over hills it
    // would be buried by the terrain. Render it in a dedicated group whose depth buffer is
    // cleared first, so the crosshair always draws on top of terrain/buildings.
    this.groundCrosshair.renderingGroupId = 1;
    this.scene.setRenderingAutoClearDepthStencil(1, true, false, false);

    const crosshairMaterial = new StandardMaterial('crosshairMaterial', this.scene);

    // Use DynamicTexture to draw a crosshair
    const textureSize = 64;
    const dynamicTexture = new DynamicTexture('dynamic crosshair', textureSize, this.scene, false);
    const ctx = dynamicTexture.getContext();

    // Clear with transparent background
    ctx.clearRect(0, 0, textureSize, textureSize);

    // Draw a simple crosshair (+)
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)'; // Bright yellow
    ctx.lineWidth = 4; // Thicker for better visibility

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(textureSize * 0.5, textureSize * 0.2);
    ctx.lineTo(textureSize * 0.5, textureSize * 0.8);
    ctx.stroke();

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(textureSize * 0.2, textureSize * 0.5);
    ctx.lineTo(textureSize * 0.8, textureSize * 0.5);
    ctx.stroke();

    dynamicTexture.update();

    crosshairMaterial.diffuseTexture = dynamicTexture;
    crosshairMaterial.diffuseTexture.hasAlpha = true;
    crosshairMaterial.useAlphaFromDiffuseTexture = true;
    crosshairMaterial.emissiveColor = Color3.White();
    crosshairMaterial.disableLighting = true;
    crosshairMaterial.backFaceCulling = false; // Render from both sides

    this.groundCrosshair.material = crosshairMaterial;
    this.groundCrosshair.setEnabled(false);
  }

  public startGameLoop(): void {
    // Frame pacing is owned by the render loop in index.ts (engine.runRenderLoop is
    // capped at 60fps and beforeRender only fires inside scene.render()).
    this.scene.registerBeforeRender(() => {
      try {
        const currentTime = performance.now();

        // Wait on the splash screen until the player starts the mission
        if (!this.started) {
          return;
        }

        // Check for game over condition - stop processing but don't auto-restart
        if (this.gameOver) {
          return; // Exit early to prevent further processing
        }

        const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;

        const safeDeltaTime = Math.min(deltaTime, 0.1);
        const safeCurrentTime = currentTime / 1000;

        // Threat state is computed once per frame; AI, countermeasures, and UI read the cache
        this.iskanderAlertActive = this.computeIskanderAlert();

        // AI runs first so its virtual controls are consumed by the weapon
        // handlers and bomber update in this same frame
        this.aiController.update(safeDeltaTime, safeCurrentTime);

        // Always update critical systems
        this.handleBombing(safeCurrentTime);
        this.handleMissileLaunch(); // Now uses promise-based callbacks internally
        this.handleIskanderLaunch(safeCurrentTime);
        this.handleCountermeasures();

        this.bomber.update(safeDeltaTime, this.inputManager);
        this.updateBombs(safeDeltaTime); // Now uses promise-based callbacks internally
        this.updateIskanderMissiles(safeDeltaTime);
        this.updateDefenseMissiles(safeDeltaTime);
        // Rocket View only exists in AI mode; force it off no matter who disabled the AI
        if (!this.aiController.isEnabled() && this.cameraController.isRocketViewEnabled()) {
          this.cameraController.setRocketViewEnabled(false);
        }
        // Camera runs after the missile updates so Rocket View never chases a
        // one-frame-stale Iskander/defense-missile position, and sees a defense
        // missile's hasExploded() the same frame it airbursts (they dispose
        // same-frame, with no grace period)
        this.cameraController.update(safeDeltaTime, this.inputManager);
        this.updateGroundCrosshair();

        // Check for defense missile collisions (high frequency for responsive damage)
        if (currentTime - this.lastCollisionCheckTime > this.collisionCheckInterval) {
          this.checkDefenseMissileCollisions(); // Now uses promise-based callbacks internally
          this.checkIskanderMissileCollisions();
          this.lastCollisionCheckTime = currentTime;
        }

        // Update terrain less frequently
        if (currentTime - this.lastTerrainUpdateTime > this.terrainUpdateInterval) {
          // Streaming is heading-independent (symmetric keep-set), so only position is needed.
          this.terrainManager.update(this.bomber.getPositionRef());
          this.lastTerrainUpdateTime = currentTime;
        }

        // Update defense launchers less frequently
        if (currentTime - this.lastDefenseUpdateTime > this.defenseUpdateInterval) {
          this.terrainManager.updateDefenseLaunchers(
            this.bomber.getPositionRef(),
            this.bomber.getVelocityRef(),
            safeCurrentTime,
            safeDeltaTime,
          );
          this.lastDefenseUpdateTime = currentTime;
        }

        // Update UI less frequently
        if (currentTime - this.lastUIUpdateTime > this.uiUpdateInterval) {
          this.uiManager.update();
          this.lastUIUpdateTime = currentTime;
        }

        // Update radar less frequently
        if (currentTime - this.lastRadarUpdateTime > this.radarUpdateInterval) {
          this.radarManager.update(
            this.bomber,
            this.terrainManager,
            this.destroyedTargets,
            this.iskanderMissiles,
            this.defenseMissiles,
          );
          this.lastRadarUpdateTime = currentTime;
        }

        this.inputManager.endFrame();
      } catch (e) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Game loop error:', e);
        }
      }
    });
  }

  private handleBombing(currentTime: number): void {
    // Prevent bombing run if any weapon system is active
    if (this.bomber.isWeaponSystemActive() && !this.isBombingRun) {
      return; // Can't start bombing run if weapon system is active
    }

    if (this.inputManager.isBombKeyPressed() && this.isBombingAvailable()) {
      this.startBombingRun();
    }

    // Only drop bombs if we're in a bombing run AND the bomb bay is fully open
    if (
      this.isBombingRun &&
      this.bombsToDrop > 0 &&
      this.bomber.isBombBayOpen() &&
      currentTime - this.lastBombDropTime >= 1
    ) {
      this.dropBomb();
      this.bombsToDrop--;
      this.lastBombDropTime = currentTime;
    }

    // End bombing run when all bombs are dropped
    if (this.isBombingRun && this.bombsToDrop === 0) {
      this.isBombingRun = false;
      this.bomber.closeBombBay();
      this.lastBombingRunTime = currentTime;
    }
  }

  private handleMissileLaunch(): void {
    // Prevent missile launch if bombing run is in progress
    if (this.isBombingRun) {
      return; // Can't launch missiles during bombing run
    }

    if (this.inputManager.isMissileKeyPressed() && this.bomber.canLaunchMissile()) {
      // Use promise-based callbacks instead of async/await
      this.bomber
        .hasValidTarget()
        .then((hasValidTarget) => {
          if (hasValidTarget) {
            this.bomber.launchMissile().catch(() => {
              // Silent error handling for missile launch
            });
          }
        })
        .catch(() => {
          // Silent error handling for target validation
        });
    }
  }

  private handleIskanderLaunch(currentTime: number): void {
    // Check if it's time to launch an Iskander missile
    if (currentTime >= this.nextIskanderLaunchTime) {
      this.launchIskanderMissile();

      // Calculate next launch time
      const totalInterval = this.iskanderLaunchInterval + Math.random() * this.iskanderRandomInterval;
      this.nextIskanderLaunchTime = currentTime + totalInterval;
    }
  }

  private launchIskanderMissile(): void {
    // Find the defense launcher farthest from the bomber
    const bomberPosition = this.bomber.getPosition();

    // Use promise-based callbacks instead of async/await
    this.terrainManager
      .getBuildingsInRadius(bomberPosition, 1000)
      .then((buildings) => {
        let farthestLauncher = null;
        let maxDistance = 0;

        for (const building of buildings) {
          if (building.isDefenseLauncher() && !building.getIsDestroyed()) {
            const distance = Vector3.Distance(bomberPosition, building.getPosition());
            if (distance > maxDistance) {
              maxDistance = distance;
              farthestLauncher = building;
            }
          }
        }

        if (farthestLauncher) {
          const launchPosition = farthestLauncher.getPosition().clone();
          // Buildings are pinned to world y=0 while terrain rises to ~60, so the roof
          // alone can sit below the local ground and the missile would climb buried.
          // Spawn above BOTH the roof and the terrain so it's visible from liftoff.
          const terrainY = this.terrainManager.getTerrainHeightAt(launchPosition.x, launchPosition.z);
          const roofY = launchPosition.y + farthestLauncher.getMaxHeight(); // parent.y == 0
          launchPosition.y = Math.max(roofY, terrainY) + 5;

          const missile = new IskanderMissile(this.scene, launchPosition, this.bomber, this.workerManager);
          missile.setTerrainManager(this.terrainManager);

          missile.launch();
          this.iskanderMissiles.push(missile);
        }
      })
      .catch(() => {
        // Silent error handling - fallback to synchronous method if needed
      });
  }

  private handleCountermeasures(): void {
    if (
      this.inputManager.isCountermeasureKeyPressed() &&
      this.bomber.canLaunchFlares() &&
      this.hasIskanderMissilesForAlert()
    ) {
      this.bomber.launchFlares();
    }
  }

  private updateIskanderMissiles(deltaTime: number): void {
    // Get active flares once for all missiles
    const activeFlares = this.bomber.getActiveFlares();
    const currentTime = performance.now() / 1000;

    // Update all Iskander missiles; sweep exploded ones 2s after explosion so
    // their lingering explosion effects finish (no per-frame timers)
    for (let i = this.iskanderMissiles.length - 1; i >= 0; i--) {
      const missile = this.iskanderMissiles[i];

      // Update flare targets efficiently (replaces old list with current active flares)
      // This ensures missiles always track current flares without duplication
      missile.updateFlareTargets(activeFlares);

      // Update missile physics (now handled by worker)
      missile.update(deltaTime);

      if (missile.hasExploded()) {
        const explodedAt = this.iskanderExplodedAt.get(missile);
        if (explodedAt === undefined) {
          this.iskanderExplodedAt.set(missile, currentTime);
        } else if (currentTime - explodedAt > 2) {
          missile.dispose();
          this.iskanderExplodedAt.delete(missile);
          this.iskanderMissiles.splice(i, 1);
        }
      }
    }
  }

  private checkIskanderMissileCollisions(): void {
    if (this.gameOver || this.bomber.isBomberDestroyed()) return;

    if (this.iskanderMissiles.length === 0) return;

    // Use worker for collision detection (position is serialized synchronously)
    const bomberData = {
      position: this.bomber.getPositionRef(),
      isDestroyed: this.bomber.isBomberDestroyed(),
    };

    this.workerManager
      .checkIskanderCollisions(this.iskanderMissiles, bomberData)
      .then((result) => {
        this.handleIskanderCollisionResults(result.collisions);
      })
      .catch(() => {
        // Worker failed - rely on next update cycle
      });
  }

  private parseMissileIndex(missileId: string): number {
    return parseInt(missileId.split('_')[1], 10);
  }

  private handleIskanderCollisionResults(collisions: any[]): void {
    if (this.gameOver || this.bomber.isBomberDestroyed()) return;

    for (const collision of collisions) {
      const missileIndex = this.parseMissileIndex(collision.missileId);
      const missile = this.iskanderMissiles[missileIndex];

      if (missile && missile.isLaunched() && !missile.hasExploded()) {
        // explode() applies its own distance-based proximity damage (≤25u) — that is
        // the single damage path. A direct hit means distance ≈ 0, i.e. max damage,
        // so applying collision.damage here as well double-damaged the bomber.
        missile.explode();
      }
    }
  }

  private dropBomb(): void {
    const bombPosition = this.bomber.getBombBayPosition();
    const bomb = new Bomb(this.scene, bombPosition);
    this.bombs.push(bomb);
  }

  public startBombingRun(): void {
    if (this.isBombingAvailable()) {
      this.isBombingRun = true;
      this.bombsToDrop = 9;
      this.lastBombDropTime = performance.now() / 1000;
      this.bomber.openBombBay();
      // Don't drop bomb immediately - wait for doors to open
    }
  }

  public isBombingAvailable(): boolean {
    const currentTime = performance.now() / 1000;
    const cooldownReady = currentTime - this.lastBombingRunTime > this.bombingRunCooldown;
    const noWeaponActive = !this.bomber.isWeaponSystemActive();
    return !this.isBombingRun && cooldownReady && noWeaponActive;
  }

  public isBombingRunActive(): boolean {
    return this.isBombingRun;
  }

  public isBombingRunInProgress(): boolean {
    return this.isBombingRun || this.bomber.isBombBayActive();
  }

  public getBombCooldownStatus(): number {
    const currentTime = performance.now() / 1000;
    const timeSinceLastRun = currentTime - this.lastBombingRunTime;
    const cooldownProgress = Math.min(timeSinceLastRun / this.bombingRunCooldown, 1);
    return this.isBombingRun ? 0 : cooldownProgress;
  }

  public getBomber(): Bomber {
    return this.bomber;
  }

  public getCameraController(): CameraController {
    return this.cameraController;
  }

  public getAIController(): AIController {
    return this.aiController;
  }

  public getBomberHealth(): number {
    return this.bomber.getHealthPercentage();
  }

  // Defense missile management methods
  public addDefenseMissile(missile: DefenseMissile): void {
    this.defenseMissiles.push(missile);
  }

  public getDefenseMissiles(): DefenseMissile[] {
    return this.defenseMissiles;
  }

  public getIskanderMissiles(): IskanderMissile[] {
    return this.iskanderMissiles;
  }

  /**
   * Candidate for Rocket View to NEWLY acquire. Priority: Iskanders, then
   * defense missiles — Tomahawks are excluded by design (their terrain-hugging
   * weave makes for a chaotic view). Oldest live missile first: arrays are
   * append-ordered, so index 0 is closest to impact and the camera chains
   * through the rest as each one explodes.
   *
   * Defense missiles are acquirable ONLY in their on-pad window (velocity still
   * (0,0,0) before the async trajectory worker replies) so the camera catches
   * the launch and shows the full lifecycle rather than snapping onto one
   * already mid-flight. Once followed, the camera keeps the missile regardless.
   * Returns a single reused descriptor (the camera copies its fields out).
   */
  private getRocketViewCandidate(): RocketViewCandidate | null {
    for (const missile of this.iskanderMissiles) {
      if (missile.isLaunched() && !missile.hasExploded()) {
        this.rocketCandidate.missile = missile;
        this.rocketCandidate.kind = RocketViewKind.Iskander;
        return this.rocketCandidate;
      }
    }
    for (const missile of this.defenseMissiles) {
      if (missile.isLaunched() && !missile.hasExploded() && missile.getVelocityRef().lengthSquared() === 0) {
        this.rocketCandidate.missile = missile;
        this.rocketCandidate.kind = RocketViewKind.Defense;
        return this.rocketCandidate;
      }
    }
    return null;
  }

  private updateDefenseMissiles(deltaTime: number): void {
    const currentTime = performance.now() / 1000;
    // Update all defense missiles; sweep exploded ones ~1.5s after explosion so
    // the airburst finishes and Rocket View can hold on the blast (no per-frame timers).
    for (let i = this.defenseMissiles.length - 1; i >= 0; i--) {
      const missile = this.defenseMissiles[i];
      missile.update(deltaTime);

      if (missile.hasExploded()) {
        const explodedAt = this.defenseExplodedAt.get(missile);
        if (explodedAt === undefined) {
          this.defenseExplodedAt.set(missile, currentTime);
        } else if (currentTime - explodedAt > 1.5) {
          missile.dispose();
          this.defenseExplodedAt.delete(missile);
          this.defenseMissiles.splice(i, 1);
        }
      }
    }
  }

  public hasIskanderMissilesForAlert(): boolean {
    return this.iskanderAlertActive;
  }

  public getClosestIskanderThreatDistance(): number {
    return this.closestIskanderThreatDistance;
  }

  private computeIskanderAlert(): boolean {
    let closestThreatDistanceSq = Infinity;
    this.closestIskanderThreatDistance = Infinity;
    if (this.iskanderMissiles.length === 0) return false;

    const bomberPosition = this.bomber.getPositionRef();
    const alertDetectionRange = 500; // Much larger range for alerts - 500 units
    const alertRangeSq = alertDetectionRange * alertDetectionRange;

    for (const missile of this.iskanderMissiles) {
      if (missile.isLaunched() && !missile.hasExploded()) {
        // Check if missile is locked on OR in the process of locking on
        const isLockedOn = missile.getIsLockedOn();
        const lockProgress = missile.getLockProgress();

        // Track alert if missile is locked on OR has started the lock process (progress > 0)
        if (isLockedOn || lockProgress > 0) {
          const missilePosition = missile.getPositionRef();
          const distanceSq = Vector3.DistanceSquared(bomberPosition, missilePosition);
          if (distanceSq < closestThreatDistanceSq) {
            closestThreatDistanceSq = distanceSq;
          }
        }
      }
    }
    this.closestIskanderThreatDistance = Math.sqrt(closestThreatDistanceSq);
    return closestThreatDistanceSq <= alertRangeSq;
  }

  private updateBombs(deltaTime: number): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i];
      bomb.update(deltaTime);

      const bombPosition = bomb.getPosition();

      if (bombPosition.y <= 0) {
        const explosionPoint = new Vector3(bombPosition.x, 0, bombPosition.z);

        const blastRadius = 75;

        // Use promise-based callbacks instead of async/await
        this.terrainManager
          .getBuildingsInRadius(explosionPoint, blastRadius)
          .then((nearbyBuildings) => {
            nearbyBuildings.forEach((building) => {
              const distance = Vector3.Distance(explosionPoint, building.getPosition());
              const damage = Math.max(10, 50 - distance);

              const wasDestroyed = building.takeDamage(damage, true);
              if (wasDestroyed) {
                this.destroyedBuildings++;
                if (building.isTarget()) {
                  this.destroyedTargets++;
                }
              }
            });
          })
          .catch(() => {
            // Silent error handling - fallback to synchronous method if needed
          });

        bomb.explode(explosionPoint);
        this.bombs.splice(i, 1);
      }
    }
  }

  private updateGroundCrosshair(): void {
    const showCrosshairs = this.cameraController.getShowGroundCrosshairs();
    if (showCrosshairs) {
      this.groundCrosshair.setEnabled(true);
      const bomberPosition = this.bomber.getPositionRef();
      const bomberRotation = this.bomber.getRotationRef();

      // Calculate position in front of bomber based on its heading
      const forwardDistance = 10; // Units in front of bomber
      const forwardX = bomberPosition.x + Math.sin(bomberRotation.y) * forwardDistance;
      const forwardZ = bomberPosition.z + Math.cos(bomberRotation.y) * forwardDistance;

      this.groundCrosshair.position.set(forwardX, 1, forwardZ);
    } else {
      this.groundCrosshair.setEnabled(false);
    }
  }

  private handleGameOver(): void {
    this.gameOver = true;

    if (this.bomber) {
      this.bomber.dispose();
    }

    // The settings modal (z-index 3000) would cover the game-over screen (1000)
    this.uiManager.closeSettingsModal();

    // Show game over message
    this.showGameOverMessage();
  }

  private showGameOverMessage(): void {
    const gameOverDiv = document.createElement('div');
    gameOverDiv.id = 'game-over-message';
    gameOverDiv.innerHTML = `
            <div class="game-over-content">
                <h1>MISSION FAILED</h1>
                <p>Your Bomber has been destroyed!</p>
                <p>Buildings Destroyed: ${this.destroyedBuildings}</p>
                <p>Targets Eliminated: ${this.destroyedTargets}</p>
                <button id="restart-button" onclick="location.reload()">Restart Mission</button>
            </div>
        `;
    document.body.appendChild(gameOverDiv);
  }

  private checkDefenseMissileCollisions(): void {
    if (this.gameOver || this.bomber.isBomberDestroyed()) return;

    if (this.defenseMissiles.length === 0) return;

    // Use worker for collision detection (position is serialized synchronously)
    const bomberData = {
      position: this.bomber.getPositionRef(),
      isDestroyed: this.bomber.isBomberDestroyed(),
    };

    this.workerManager
      .checkDefenseCollisions(this.defenseMissiles, bomberData)
      .then((result) => {
        this.handleDefenseCollisionResults(result.collisions, this.defenseMissiles);
      })
      .catch(() => {
        // Worker failed - rely on next update cycle
      });
  }

  private handleDefenseCollisionResults(collisions: any[], defenseMissiles: any[]): void {
    if (this.gameOver || this.bomber.isBomberDestroyed()) return;

    for (const collision of collisions) {
      const missileIndex = this.parseMissileIndex(collision.missileId);
      const missile = defenseMissiles[missileIndex];

      if (missile && missile.isLaunched() && !missile.hasExploded()) {
        this.bomber.takeDamage(collision.damage);
        missile.explode();
      }
    }
  }
}
