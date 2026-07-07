import {
  Scene,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
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
import { CameraController } from './CameraController';
import { CinematicCandidateProvider, PanicStory } from './CinematicDirector';
import { EventBus } from '../utils/EventBus';
import { GameEvents } from './GameEvents';
import { Bomb } from '../entities/Bomb';
import { IskanderMissile } from '../entities/IskanderMissile';
import { DefenseMissile } from '../entities/DefenseMissile';
import { UIManager } from '../ui/UIManager';
import { RadarManager } from '../ui/RadarManager';
import { WorkerManager } from './WorkerManager';
import { Building } from '../entities/Building';
import { AIController } from './AIController';
import { ProjectileRegistry } from './ProjectileRegistry';
import { ExplosionPool } from '../effects/ExplosionPool';
import { AudioManager } from '../effects/AudioManager';
import { LightManager } from './LightManager';
import { RADAR_RANGE, CAMERA_MAX_Z } from '../config/Balance';
import { GameClock } from '../utils/GameClock';
import { Cooldown } from '../utils/Cooldown';
import { createSun, SUN_DIRECTION } from '../entities/Sun';

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
  private sunLight!: DirectionalLight;
  private bomberShadow: ShadowGenerator | null = null;
  // Cheap-off switch: ?shadow=0 disables the bomber's sun shadow entirely.
  // (Not in Balance.ts — Balance is worker-imported and must stay window-free.)
  private readonly shadowEnabled: boolean =
    new URLSearchParams(window.location.search).get('shadow') !== '0';
  // Discrete cross-system transitions (viewMode, AI enabled); continuous
  // values stay polled and per-frame feeds stay provider closures.
  private readonly events = new EventBus<GameEvents>();
  private cinematics!: CinematicCandidateProvider;
  private panicStory!: PanicStory;

  // Bombing properties
  private bombs: Bomb[] = [];
  private isBombingRun: boolean = false;
  private readonly bombingCooldown = new Cooldown(15); // seconds between runs
  private bombsToDrop: number = 0;
  private lastBombDropTime: number = 0;

  // Iskander missile system
  // Recomputed once per frame; read by AI, countermeasures, and the UI tick
  private iskanderAlertActive: boolean = false;
  // Subset of the above: a threat in range whose 4s lock timer actually completed
  private iskanderLockedActive: boolean = false;
  // Distance to the nearest locking/locked Iskander (Infinity when none); the AI
  // uses it to hold flares until the missile is actually close
  private closestIskanderThreatDistance: number = Infinity;
  // World position of that nearest threat (reused scratch; see the getter's
  // validity contract)
  private readonly closestIskanderThreatPosition = new Vector3();
  // True while the bomber sits inside/under a live cloud with Iskanders in
  // flight — pre-lock seekers pause (recomputed in updateIskanderMissiles)
  private bomberConcealed = false;
  private nextIskanderLaunchTime: number = -Infinity;
  // Base pacing, overridable for debugging/tuning via ?iskInterval= and
  // ?iskRandom= (seconds; see readPacingParam below).
  private iskanderLaunchInterval: number = Game.readPacingParam('iskInterval', 30);
  private iskanderRandomInterval: number = Game.readPacingParam('iskRandom', 45);
  // Launcher pre-selected this many seconds before the scheduled launch so Rocket
  // View can dwell on it; re-validated per-frame in handleIskanderLaunch.
  private pendingIskanderLauncher: Building | null = null;
  private readonly iskanderPreselectLead = 1;

  // All swept projectiles (iskanders, defense missiles, tomahawks) — lifecycle
  // lingers and retirement live in the registry; update loops stay here/Bomber.
  private readonly projectiles = new ProjectileRegistry();
  // Scoring system
  private destroyedBuildings: number = 0;
  private destroyedTargets: number = 0;
  // Tomahawk kills knock out launchers without levelling the building (their
  // damage is capped below full destruction), so they get their own counter.
  private destroyedLaunchers: number = 0;
  // Fraction of max health restored per red-ring target destroyed
  private readonly targetDestroyHealFraction = 0.05;

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

  /** Non-negative-number URL override for a pacing knob, else the default.
   *  Debug/tuning only — gameplay balance itself lives in the defaults. */
  private static readPacingParam(name: string, fallback: number): number {
    const param = new URLSearchParams(window.location.search).get(name);
    const parsed = param !== null ? Number(param) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  // World seed: ?seed=<uint32> reproduces a run's exact terrain and building
  // layout (shareable maps, deterministic test fixtures); otherwise random.
  // Read it back via getWorldSeed() / __perf.game.
  private readonly worldSeed: number = (() => {
    const param = new URLSearchParams(window.location.search).get('seed');
    const parsed = param !== null ? Number(param) : NaN;
    return Number.isFinite(parsed) ? parsed >>> 0 : (Math.random() * 0xffffffff) >>> 0;
  })();

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;
    // Touch-first game: pointer events never need a pick ray (input reads raw
    // client coordinates and every mesh is unpickable), so skip Babylon's
    // per-event scene picking entirely — moves, downs and ups alike.
    this.scene.skipPointerMovePicking = true;
    this.scene.skipPointerDownPicking = true;
    this.scene.skipPointerUpPicking = true;
    this.canvas = canvas;
  }

  public initialize(): Promise<void> {
    this.setupLighting();
    this.setupCamera();

    // Initialize worker manager first
    this.workerManager = new WorkerManager();

    this.terrainManager = new TerrainManager(this.scene, this.workerManager, this.worldSeed, this.shadowEnabled);
    this.terrainManager.setGame(this);

    this.bomber = new Bomber(this.scene, this.workerManager, this.projectiles);
    if (this.bomberShadow) {
      const renderList = this.bomberShadow.getShadowMap()!.renderList!;
      for (const mesh of this.bomber.getShadowCasterMeshes()) renderList.push(mesh);
    }
    this.bomber.setBombingRunActiveCallback(() => this.isBombingRunInProgress());
    this.bomber.setOnDestroyedCallback(() => this.handleGameOver());
    // Fired by a Tomahawk confirming its launcher kill. The building itself
    // still stands (Tomahawk damage is capped), so this credits launchers —
    // destroyedBuildings/destroyedTargets stay bomb-only.
    this.bomber.setOnTargetDestroyedCallback(() => {
      this.destroyedLaunchers++;
    });

    this.cameraController = new CameraController(this.camera, this.bomber, this.terrainManager, this.events);
    // Cinematography direction lives in CinematicDirector; provider-closure
    // injection (house pattern) keeps CameraController free of a Game import.
    this.cinematics = new CinematicCandidateProvider(
      this.bomber,
      this.projectiles.getIskanders(),
      this.projectiles.getDefenseMissiles(),
      () => this.pendingIskanderLauncher,
      () => this.cameraController.isInTomahawkSequence(),
    );
    this.panicStory = new PanicStory(
      this.bomber,
      this.projectiles.getIskanders(),
      () => this.cameraController.getActivePanicKind(),
    );
    this.cameraController.setMissileProvider(() => this.cinematics.getRocketViewCandidate());
    this.cameraController.setPanicProvider(() => this.panicStory.getCandidate());

    this.inputManager = new InputManager(this.scene, this.canvas);
    this.aiController = new AIController(this, this.bomber, this.terrainManager, this.inputManager, this.events);
    // Manual input suspends the AI (grace period) without disabling it; the
    // cinematic cameras must hand the view back to the pilot for that window.
    this.cameraController.setManualOverrideProvider(() => this.aiController.isSuspended());
    this.uiManager = new UIManager(this, this.inputManager, this.events);

    // (The old `window.uiManager` global is gone — nothing in the HTML ever
    // used it. Headless test drivers reach the UI via `__perf.game.uiManager`.)

    this.radarManager = new RadarManager();
    this.createGroundCrosshair();

    this.bomber.setTerrainManager(this.terrainManager);
    this.terrainManager.setBomber(this.bomber);

    return this.terrainManager.generateInitialTerrain(this.bomber.getPosition()).then(() => {
      // First Iskander launch time in GAME time — the clock doesn't advance
      // until start(), so splash-screen reading time can't count against the
      // player (this used to need a wall-clock re-roll hack in start()).
      const initialInterval = this.iskanderLaunchInterval + Math.random() * this.iskanderRandomInterval;
      this.nextIskanderLaunchTime = GameClock.now() + initialInterval;

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

    // start() runs inside the START-tap gesture — the one moment the browser
    // lets us unlock the AudioContext. Engine drone runs until game over.
    AudioManager.get().unlock();
    AudioManager.get().startEngine();

    // All startup materials (terrain, buildings, bomber, sun, crosshair) have
    // compiled during the splash frames; from here on, no code path needs the
    // material dirty mechanism (verified: launcher/bay emissive animations
    // write plain Color3 uniforms; pooled lights park by intensity, never
    // enable/disable; the ShadowGenerator and all casters were wired in
    // initialize(), and chunks streamed in later still evaluate fresh
    // per-submesh defines on first render regardless). Blocking makes any
    // accidental future markAsDirty storm a no-op instead of a full-scene
    // shader resync hitch. One-line revert if a new feature needs it.
    // (Dev caveat: Inspector live-edits of materials won't propagate while blocked.)
    this.scene.blockMaterialDirtyMechanism = true;
  }

  private setupLighting(): void {
    const hemisphericLight = new HemisphericLight('hemisphericLight', new Vector3(0, 1, 0), this.scene);
    hemisphericLight.intensity = 0.3;

    // Direction is the negated SUN_DIRECTION (~25° elevation) so shading always
    // agrees with the visible sun disc.
    const directionalLight = new DirectionalLight('directionalLight', SUN_DIRECTION.scale(-1), this.scene);
    directionalLight.intensity = 0.8;
    directionalLight.diffuse = new Color3(1, 0.9, 0.7);
    this.sunLight = directionalLight;

    if (this.shadowEnabled) {
      // Created HERE, before TerrainManager/BuildingAssets construct and freeze
      // their materials: shadow support is baked into shader defines at each
      // submesh's first compile, and frozen materials never re-evaluate. Same
      // contract as the pooled-light prewarm below.
      this.bomberShadow = new ShadowGenerator(512, directionalLight);
      // Sane frustum from the very first (splash) frames; the game loop then
      // tracks the bomber. (0, 175, 0) is the bomber spawn.
      directionalLight.position.set(0, 175, 0);
      // FILTER_NONE (default): one depth tap per terrain pixel — the receiver
      // side is the mobile cost center, so no PCF/blur. The caster set is ~15
      // small meshes; a hard 512 shadow of the whole plane reads fine from
      // 150-200u altitude. If edge aliasing ever offends, PCF QUALITY_LOW is
      // the first upgrade — never blur (extra passes).
      this.bomberShadow.bias = 0.001;
      this.bomberShadow.setDarkness(0.35); // hemi light keeps shadows from going black anyway
      // Ortho XY extents auto-fit the casters (autoUpdateExtends). Depth range
      // must be set MANUALLY: auto Z bounds hug the casters, but the receiving
      // ground lies ~(alt - terrain)/sin(25°) ≈ 350-480u further along the
      // light ray, and fragments outside the light frustum sample unshadowed.
      // The light's position tracks the bomber (game loop), so bomber ≈ depth 0.
      // COUPLED to BOMBER_MAX_ALTITUDE (Balance.ts): worst-case receiver depth
      // is maxAlt/sin(25.2°) + far-corner gradient ≈ 529u at maxAlt 200. If the
      // ceiling ever rises past ~230, raise shadowMaxZ too or the shadow
      // silently vanishes over low terrain.
      directionalLight.shadowMinZ = -50;
      directionalLight.shadowMaxZ = 600;
    }

    createSun(this.scene);

    // Pre-warm the shared explosion pool (and its effect textures) before combat
    // so no particle systems or textures are ever built mid-fight.
    ExplosionPool.get(this.scene);

    // Pre-warm the light pool HERE, before any terrain/building/missile
    // material compiles and freezes: frozen StandardMaterials bake their
    // affecting-light set into shader defines at first compile and never
    // recompute, so lights created later (the old lazy first-bomb-drop init)
    // could never illuminate them. See LightManager for the intensity-parking
    // half of this contract.
    LightManager.get(this.scene);
  }

  private setupCamera(): void {
    // Initial framing matches the bomber's spawn altitude (175) + default follow height
    this.camera = new FreeCamera('camera', new Vector3(0, 255, -200), this.scene);
    this.camera.setTarget(new Vector3(0, 175, 0));
    // Limit the far clip plane to cull distant terrain. Must sit beyond FOG_END
    // so terrain fully fades to sky — both live in Balance.ts.
    this.camera.maxZ = CAMERA_MAX_Z;
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
        // Game time advances by the CLAMPED delta only while running (the
        // early-returns above freeze it on the splash screen and at game over),
        // so every cooldown/schedule survives a tab-away intact.
        GameClock.advance(safeDeltaTime);
        const safeCurrentTime = GameClock.now();

        // Threat state is computed once per frame; AI, countermeasures, and UI read the cache
        this.iskanderAlertActive = this.computeIskanderAlert();
        // Escalating warning beeper mirrors the INBOUND/LOCKED banner; tempo
        // compresses as the closest threat closes (closeness 0 @ 500u → 1 @ 0u)
        AudioManager.get().setThreat(
          this.iskanderLockedActive ? 'locked' : this.iskanderAlertActive ? 'inbound' : 'none',
          1 - Math.min(1, this.closestIskanderThreatDistance / 500),
        );

        // AI runs first so its virtual controls are consumed by the weapon
        // handlers and bomber update in this same frame
        this.aiController.update(safeDeltaTime, safeCurrentTime);

        // Always update critical systems
        this.handleBombing(safeCurrentTime);
        this.handleMissileLaunch();
        this.handleIskanderLaunch(safeCurrentTime);
        this.handleCountermeasures();

        this.bomber.update(safeDeltaTime, this.inputManager);
        // Directional-light position is the shadow depth origin; keep it on the
        // bomber so shadowMinZ/MaxZ stay valid as the plane flies kilometers out.
        // (Transform-only write — no material dirtying, safe under the
        // blockMaterialDirtyMechanism set in start().)
        if (this.bomberShadow) this.sunLight.position.copyFrom(this.bomber.getPositionRef());
        this.updateBombs(safeDeltaTime);
        this.panicStory.endBombingStoryIfComplete(this.isBombingRun, this.bombs.length > 0);
        this.updateIskanderMissiles(safeDeltaTime);
        this.updateDefenseMissiles(safeDeltaTime);
        // One unified linger sweep for all projectile types (was three
        // hand-rolled copies); runs before the camera/collision/radar reads,
        // exactly where the last of the old sweeps sat.
        this.projectiles.sweep(safeCurrentTime);
        // (The old "force cinematic views off when AI is off" backstop is gone:
        // CameraController subscribes to aiEnabledChanged and owns that policy.)
        // Camera runs after the missile updates so Rocket View never chases a
        // one-frame-stale Iskander/defense-missile position, and sees a defense
        // missile's hasExploded() the same frame it airbursts (the registry's
        // 1.5s linger is what lets the explosion hold play out before release)
        this.cameraController.update(safeDeltaTime, this.inputManager);
        this.updateGroundCrosshair();
        // Cloud drift is per-frame (smooth), unlike the 10Hz terrain streaming below
        this.terrainManager.updateClouds(safeDeltaTime);

        // Check for defense missile collisions (high frequency for responsive damage)
        if (currentTime - this.lastCollisionCheckTime > this.collisionCheckInterval) {
          this.checkDefenseMissileCollisions();
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
            this.destroyedBuildings,
            this.destroyedLaunchers,
            this.projectiles.getIskanders(),
            this.projectiles.getDefenseMissiles(),
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
      this.bombingCooldown.fire();
    }
  }

  private handleMissileLaunch(): void {
    // Prevent missile launch if bombing run is in progress
    if (this.isBombingRun) {
      return; // Can't launch missiles during bombing run
    }

    if (this.inputManager.isMissileKeyPressed() && this.bomber.canLaunchMissile()) {
      // tryLaunchMissile self-validates the target, so no separate pre-check scan
      this.bomber.tryLaunchMissile();
    }
  }

  /** Instrumentation for tests. */
  public getGameTime(): number { return GameClock.now(); }

  private handleIskanderLaunch(currentTime: number): void {
    // Pre-select the launcher during the lead window so Rocket View can dwell on
    // it before the missile exists. Re-validated per-frame: a launcher destroyed
    // mid-dwell is dropped and replaced (or left null if none is in range yet).
    if (
      currentTime >= this.nextIskanderLaunchTime - this.iskanderPreselectLead &&
      currentTime < this.nextIskanderLaunchTime
    ) {
      if (this.pendingIskanderLauncher && this.pendingIskanderLauncher.getIsDestroyed()) {
        this.pendingIskanderLauncher = null;
      }
      if (!this.pendingIskanderLauncher) {
        this.pendingIskanderLauncher = this.findFarthestLauncher();
      }
    }

    // Check if it's time to launch an Iskander missile
    if (currentTime >= this.nextIskanderLaunchTime) {
      this.launchIskanderMissile();
      this.pendingIskanderLauncher = null;

      // Calculate next launch time
      const totalInterval = this.iskanderLaunchInterval + Math.random() * this.iskanderRandomInterval;
      this.nextIskanderLaunchTime = currentTime + totalInterval;
    }
  }

  /** The live defense launcher farthest from the bomber within 1000u, or null. */
  private findFarthestLauncher(): Building | null {
    const bomberPosition = this.bomber.getPosition();

    const buildings = this.terrainManager.getBuildingsInRadiusSync(bomberPosition, 1000);
    let farthestLauncher: Building | null = null;
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
    return farthestLauncher;
  }

  /** Instrumentation for tests: the launcher Rocket View is dwelling on, if any. */
  public getPendingIskanderLauncher(): Building | null {
    return this.pendingIskanderLauncher;
  }

  private launchIskanderMissile(): void {
    // Prefer the pre-selected launcher (re-validated — it may have been destroyed
    // this same frame); fall back to a fresh scan so a launcher that entered range
    // after the preselect window opened can still fire.
    const farthestLauncher =
      this.pendingIskanderLauncher && !this.pendingIskanderLauncher.getIsDestroyed()
        ? this.pendingIskanderLauncher
        : this.findFarthestLauncher();

    if (farthestLauncher) {
      const launchPosition = farthestLauncher.getPosition().clone();
      // Launcher buildings have flat roofs with the 2-tall launcher box on top
      // (Building.createBuildingMesh), so this is 3 above the launcher.
      launchPosition.y += farthestLauncher.getMaxHeight() + 5;

      const missile = new IskanderMissile(this.scene, launchPosition, this.bomber);
      missile.setTerrainManager(this.terrainManager);

      missile.launch();
      this.projectiles.addIskander(missile);
    }
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

    // Cloud concealment: computed once per frame for all seekers (and only while
    // any Iskander is live — the cloud scan isn't free).
    const iskanders = this.projectiles.getIskanders();
    this.bomberConcealed =
      iskanders.length > 0 && this.terrainManager.isCloudConcealing(this.bomber.getPositionRef());

    for (const missile of iskanders) {
      // Update flare targets efficiently (replaces old list with current active flares)
      // This ensures missiles always track current flares without duplication
      missile.updateFlareTargets(activeFlares);

      // Update missile physics (exploded/lingering missiles early-return inside)
      missile.update(deltaTime, this.bomberConcealed);
    }
  }

  // Inline synchronous check (was a collision-worker round trip). Besides the
  // ~125 timers/sec and per-frame serialization it removes, this fixes a real
  // bug: the worker mapped results back by array index, but the missile array
  // is spliced between send and receive, so the wrong missile could explode.
  private checkIskanderMissileCollisions(): void {
    if (this.gameOver || this.bomber.isBomberDestroyed()) return;

    const bomberPosition = this.bomber.getPositionRef();
    // Same threshold the worker used: direct hits (8u) and proximity bursts
    // (20u) both only triggered explode(), so a single 20u check suffices.
    const proximityRadiusSq = 20 * 20;

    for (const missile of this.projectiles.getIskanders()) {
      if (!missile.isLaunched() || missile.hasExploded()) continue;

      if (Vector3.DistanceSquared(bomberPosition, missile.getPositionRef()) <= proximityRadiusSq) {
        // explode() applies its own distance-based proximity damage (≤25u) — that is
        // the single damage path. A direct hit means distance ≈ 0, i.e. max damage,
        // so applying extra damage here as well double-damaged the bomber.
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
      this.lastBombDropTime = GameClock.now();
      this.bomber.openBombBay();
      // Panic View's story anchor: the AI's target the instant the run starts.
      this.panicStory.beginBombingRun(
        this.aiController.isEnabled() ? this.aiController.getCurrentTarget() : null,
      );
      // Don't drop bomb immediately - wait for doors to open
    }
  }

  public isBombingAvailable(): boolean {
    const noWeaponActive = !this.bomber.isWeaponSystemActive();
    return !this.isBombingRun && this.bombingCooldown.ready() && noWeaponActive;
  }

  public isBombingRunActive(): boolean {
    return this.isBombingRun;
  }

  public isBombingRunInProgress(): boolean {
    return this.isBombingRun || this.bomber.isBombBayActive();
  }

  public getBombCooldownStatus(): number {
    return this.isBombingRun ? 0 : this.bombingCooldown.status();
  }

  public getWorldSeed(): number {
    return this.worldSeed;
  }

  // Read-only instrumentation for the ?debug=1 overlay (and headless drivers)
  public getScene(): Scene {
    return this.scene;
  }

  public getBombCount(): number {
    return this.bombs.length;
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
    this.projectiles.addDefenseMissile(missile);
  }

  public getDefenseMissiles(): DefenseMissile[] {
    return this.projectiles.getDefenseMissiles();
  }

  public getIskanderMissiles(): IskanderMissile[] {
    return this.projectiles.getIskanders();
  }

  private updateDefenseMissiles(deltaTime: number): void {
    for (const missile of this.projectiles.getDefenseMissiles()) {
      // Terrain height under the missile: a shot down a slope detonates on the
      // hillside instead of tunneling through to flat-world y=0
      const mp = missile.getPositionRef();
      missile.update(deltaTime, this.terrainManager.getTerrainHeightAt(mp.x, mp.z));
    }
  }

  public hasIskanderMissilesForAlert(): boolean {
    return this.iskanderAlertActive;
  }

  /** True only when a threat in alert range has an ACTUAL lock (the 4s lock
   *  timer completed) — the honest trigger for the LOCKED banner. The broader
   *  hasIskanderMissilesForAlert() keeps its approach semantics for the AI's
   *  flare decision and the flare-button highlight. */
  public hasLockedIskanderMissiles(): boolean {
    return this.iskanderLockedActive;
  }

  /** True while the bomber is cloud-concealed with Iskanders in flight (lock
   *  progress paused for unlocked seekers). */
  public isBomberConcealed(): boolean {
    return this.bomberConcealed;
  }

  public getClosestIskanderThreatDistance(): number {
    return this.closestIskanderThreatDistance;
  }

  /** Live ref to the nearest locking/locked Iskander's position. Valid only
   *  while hasIskanderMissilesForAlert(); closestIskanderThreatDistance !==
   *  Infinity is the wider validity check. Never mutate. */
  public getClosestIskanderThreatPositionRef(): Vector3 {
    return this.closestIskanderThreatPosition;
  }

  private computeIskanderAlert(): boolean {
    let closestThreatDistanceSq = Infinity;
    this.closestIskanderThreatDistance = Infinity;
    this.iskanderLockedActive = false;
    const iskanders = this.projectiles.getIskanders();
    if (iskanders.length === 0) return false;

    const bomberPosition = this.bomber.getPositionRef();
    const alertRangeSq = RADAR_RANGE * RADAR_RANGE; // alerts fire for exactly what the radar shows

    for (const missile of iskanders) {
      if (missile.isLaunched() && !missile.hasExploded()) {
        // Check if missile is locked on OR in the process of locking on
        const isLockedOn = missile.getIsLockedOn();
        const lockProgress = missile.getLockProgress();

        // Track alert if missile is locked on, has started the lock process
        // (progress > 0), or is still in its boost climb — with the real 4s lock
        // window plus cloud pauses, progress can be 0 well past launch, and
        // INBOUND must still fire from launch.
        // DELIBERATE silence: a post-climb seeker whose lock is fully paused by
        // cloud cover (progress exactly 0) triggers no banner/beeper/flare
        // access at ANY range — its target is frozen at the bomber's last-seen
        // point, the radar blip stays visible, and "you're hidden, it's blind"
        // is the honest read. Don't "fix" this by alerting on mere existence.
        if (isLockedOn || lockProgress > 0 || missile.isClimbing()) {
          const missilePosition = missile.getPositionRef();
          const distanceSq = Vector3.DistanceSquared(bomberPosition, missilePosition);
          if (distanceSq < closestThreatDistanceSq) {
            closestThreatDistanceSq = distanceSq;
            this.closestIskanderThreatPosition.copyFrom(missilePosition);
          }
          // A completed lock in range escalates the banner INBOUND → LOCKED
          if (isLockedOn && distanceSq <= alertRangeSq) {
            this.iskanderLockedActive = true;
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

      // Detonate at the rendered surface, not sea level — buildings sit at terrain
      // height, so an underground burst would eat up to 60u of the blast radius
      // (and the explosion would render inside the hill).
      const terrainY = this.terrainManager.getTerrainHeightAt(bombPosition.x, bombPosition.z);
      if (bombPosition.y <= terrainY) {
        const explosionPoint = new Vector3(bombPosition.x, terrainY, bombPosition.z);

        const blastRadius = 75;

        const nearbyBuildings = this.terrainManager.getBuildingsInRadiusSync(explosionPoint, blastRadius);
        for (const building of nearbyBuildings) {
          // XZ falloff: identical to the old flat-world numbers (dy was always 0),
          // and hillside buildings aren't short-changed by the vertical term.
          const buildingPosition = building.getPosition();
          const dx = explosionPoint.x - buildingPosition.x;
          const dz = explosionPoint.z - buildingPosition.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          const damage = Math.max(10, 50 - distance);

          const wasDestroyed = building.takeDamage(damage, true);
          if (wasDestroyed) {
            this.destroyedBuildings++;
            if (building.isTarget()) {
              this.destroyedTargets++;
              this.bomber.heal(this.bomber.getMaxHealth() * this.targetDestroyHealFraction);
            }
          }
        }

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

      // Sit on the actual terrain so the projected aim cue matches where bombs
      // land on high ground. (The reticle's depth-cleared rendering group still
      // deliberately draws over nearer geometry — it's a HUD element.)
      const groundY = this.terrainManager.getTerrainHeightAt(forwardX, forwardZ);
      this.groundCrosshair.position.set(forwardX, groundY + 0.5, forwardZ);
    } else {
      this.groundCrosshair.setEnabled(false);
    }
  }

  private handleGameOver(): void {
    this.gameOver = true;

    // The loop's early-return stops setThreat naturally; kill the drone too
    AudioManager.get().stopEngine();

    // Game-over stops camera updates entirely; end any cinematic story so the
    // final frame behind the overlay is the bomber, not a mid-story pose.
    this.cameraController.setViewMode('chase');

    // Disable shadowing BEFORE disposing the bomber: mesh disposal empties the
    // shadow map's renderList, and autoUpdateExtends over an empty caster list
    // degenerates the ortho matrix (±Infinity extents — NaN UVs are
    // GPU-undefined). shadowEnabled=false stops both the map render and the
    // per-bind shadow uniform refresh, freezing the last valid state.
    if (this.bomberShadow) {
      this.sunLight.shadowEnabled = false;
    }

    if (this.bomber) {
      this.bomber.dispose();
    }

    // The settings modal (z-index 3000) would cover the game-over screen (1000)
    this.uiManager.closeSettingsModal();

    // The UI update loop stops on game over, so clear alerts (e.g. the
    // persistent LOCKED banner) that would otherwise stay pinned forever
    this.uiManager.clearAllAlerts();

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
                <p>Launchers Knocked Out: ${this.destroyedLaunchers}</p>
                <button id="restart-button" onclick="location.reload()">Restart Mission</button>
            </div>
        `;
    document.body.appendChild(gameOverDiv);
  }

  // Inline synchronous check — same thresholds and damage curve the collision
  // worker used (8u direct hit = 25 damage, 20u proximity = 5..20 falloff),
  // minus the index-mismatch bug (see checkIskanderMissileCollisions).
  private checkDefenseMissileCollisions(): void {
    if (this.gameOver || this.bomber.isBomberDestroyed()) return;

    const bomberPosition = this.bomber.getPositionRef();
    const directHitRadiusSq = 8 * 8;
    const proximityRadiusSq = 20 * 20;

    for (const missile of this.projectiles.getDefenseMissiles()) {
      if (!missile.isLaunched() || missile.hasExploded()) continue;

      const distanceSq = Vector3.DistanceSquared(bomberPosition, missile.getPositionRef());
      if (distanceSq <= directHitRadiusSq) {
        this.bomber.takeDamage(25);
        missile.explode();
      } else if (distanceSq <= proximityRadiusSq) {
        this.bomber.takeDamage(Math.max(5, 20 - Math.sqrt(distanceSq)));
        missile.explode();
      }
    }
  }
}
