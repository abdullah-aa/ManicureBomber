import { Bomber } from '../entities/Bomber';
import { FreeCamera, Vector3 } from '@babylonjs/core';
import { InputManager } from './InputManager';
import { TerrainManager } from './TerrainManager';
import { EventBus } from '../utils/EventBus';
import { GameEvents, ViewMode } from './GameEvents';
import { CameraRig } from './CameraRig';

/**
 * Minimal surface a missile must expose for Rocket View to chase it.
 * IskanderMissile and DefenseMissile satisfy this structurally. Only the
 * Iskander implements isClimbing(); only the Tomahawk implements
 * isInLaunchPhase() and getTargetPosition(); where undefined they are
 * treated as false / absent.
 */
export interface FollowableMissile {
  getPositionRef(): Vector3;
  getVelocityRef(): Vector3;
  hasExploded(): boolean;
  isClimbing?(): boolean;
  isInLaunchPhase?(): boolean;
  getTargetPosition?(): Vector3;
}

export enum RocketViewKind {
  Iskander,
  Tomahawk,
  Defense,
  IskanderPrelaunch,
  TomahawkBay,
}

/** What the provider hands the camera each pull: the missile plus its class. */
export interface RocketViewCandidate {
  missile: FollowableMissile | null; // null for anchor-only kinds (IskanderPrelaunch, TomahawkBay)
  kind: RocketViewKind;
  anchorX: number; // IskanderPrelaunch: launcher x/z as scalars — keeps the reused
  anchorZ: number; // descriptor allocation-free and avoids importing Building
}

export enum PanicViewKind {
  Bombing,
  Tomahawk,
}

/**
 * What the panic provider hands the camera each pull: the story kind, the
 * Tomahawk once it exists (null while pending / for bombing), and the target
 * building's anchor as scalars (Building.getPosition() is a live ref — copying
 * keeps the reused descriptor allocation-free and avoids importing Building).
 */
export interface PanicViewCandidate {
  kind: PanicViewKind;
  missile: FollowableMissile | null;
  anchorX: number;
  anchorZ: number;
  topY: number; // target's visible-top world Y — look-at blend + hold aim
}

/**
 * Panic View camera sub-states. None falls through to the bomber chase.
 * See the panic branch in update().
 */
enum PanicSubState {
  None,
  BombWatch,      // standing at the bombing target, staring up at the bomber
  TomahawkWatch,  // standing at the targeted launcher, watching the Tomahawk come in
  ImpactHold,     // linger on the impact for a beat, then revert
}

/**
 * Rocket View camera sub-states. None falls through to the bomber chase (the
 * revert view). See the priority/transition rules in RocketViewDirector.update().
 */
enum RocketSubState {
  None,
  IskanderPrelaunch,   // dwell on the pre-selected launcher before the missile exists
  IskanderLaunch,
  IskanderChase,
  TomahawkBelly,       // Beat 1: belly cam on the bomber through door-open + drop
  TomahawkChase,       // Beat 2: bearing-anchored chase framing missile + target, to impact
  DefenseFollow,
  ExplosionHold,
}

export class CameraController {
  private camera: FreeCamera;
  private bomber: Bomber;
  private terrainManager: TerrainManager;
  private rig: CameraRig;
  private followDistance: number = 200;
  // Camera height is an offset relative to the bomber (not an absolute world Y). A positive
  // offset rises above the bomber to look down; a negative offset drops below it to look up at
  // the underside / bomb bay. Either way the camera is kept above the ground floor below.
  private followHeightOffset: number = 140;
  private smoothing: number = 2.0;
  // Negative minimum lets the camera pass below the bomber for a bomb-bay view.
  private minFollowHeightOffset: number = -250;
  private maxFollowHeightOffset: number = 450;
  private showGroundCrosshairs: boolean = false;

  // Initial camera state for the snap-behind-bomber action
  private initialFollowHeightOffset: number = 140;

  // Camera panning properties
  private panSpeed: number = 1.5; // Radians per second for angular panning
  private panAngleOffset: number = 0; // Current angular offset from normal position (no limits)

  // Reused scratch for the bomber-chase desired pose (GC-pressure-free updates).
  private chaseDesired: Vector3 = new Vector3();

  // Cache trigonometric calculations to avoid repeated computations
  private lastEffectiveRotation: number = 0;
  private cachedSin: number = 0;
  private cachedCos: number = 0;
  private trigCacheValid: boolean = false;

  // Single view-mode owner: 'rocket'/'panic' are the ENABLED modes (player
  // toggle); whether a story is ACTIVE is the sub-state machines below.
  // Mutated ONLY by setViewMode(), which enforces mutual exclusivity and the
  // AI-mode requirement — the exclusivity policy previously smeared across
  // the cross-forcing setters, Game's loop backstop, and UIManager.
  private viewMode: ViewMode = 'chase';
  // Mirrored from aiEnabledChanged (AIController starts disabled). Rocket/Panic
  // View only exist in AI mode.
  private aiEnabled: boolean = false;
  private readonly events: EventBus<GameEvents>;

  // Rocket View director: owns the missile-follow FSM and its scratch state.
  private rocket: RocketViewDirector;
  // True while the player has grabbed the stick (AI suspended): cinematic
  // stories end immediately so the pilot isn't flying blind from a victim's-eye
  // camera; the enabled flags stay on, so the FSMs re-listen once it clears.
  private manualOverrideProvider: (() => boolean) | null = null;

  // Panic View director: owns the victim's-eye FSM and its scratch state.
  private panic: PanicViewDirector;

  constructor(
    camera: FreeCamera,
    bomber: Bomber,
    terrainManager: TerrainManager,
    events: EventBus<GameEvents>,
  ) {
    this.camera = camera;
    this.bomber = bomber;
    this.terrainManager = terrainManager;
    this.events = events;
    this.rig = new CameraRig(camera, terrainManager);
    this.rocket = new RocketViewDirector(this.rig, bomber, terrainManager, () => this.snapBehindBomber());
    this.panic = new PanicViewDirector(this.rig, bomber, terrainManager, () => this.snapBehindBomber());

    // The whole "cinematic views require autopilot" policy lives here now
    // (replaces Game's per-frame backstop and UIManager's cross force-offs).
    events.on('aiEnabledChanged', ({ enabled }) => {
      this.aiEnabled = enabled;
      if (!enabled) this.setViewMode('chase');
    });

    // Store initial value for the snap-behind-bomber action
    this.initialFollowHeightOffset = this.followHeightOffset;
  }

  // TUNABLE — shake amplitudes (chase camera sits 200u back; 2-5u reads well)
  private static readonly DAMAGE_SHAKE_BASE = 1.5;
  private static readonly DAMAGE_SHAKE_PER_HP = 0.08; // 25-dmg hit → ~3.5u
  private static readonly DAMAGE_SHAKE_MAX = 5.0;
  private lastHealthSeen = -1;

  public update(deltaTime: number, inputManager: InputManager): void {
    this.rig.beginShakeFrame();
    const health = this.bomber.getHealth();
    if (this.lastHealthSeen >= 0 && health < this.lastHealthSeen) {
      this.rig.addShake(Math.min(
        CameraController.DAMAGE_SHAKE_MAX,
        CameraController.DAMAGE_SHAKE_BASE + (this.lastHealthSeen - health) * CameraController.DAMAGE_SHAKE_PER_HP,
      ));
    }
    this.lastHealthSeen = health;
    this.updatePose(deltaTime, inputManager);
    this.rig.applyShake(deltaTime);
  }

  private updatePose(deltaTime: number, inputManager: InputManager): void {
    // Manual override: the player is steering (AI suspended). End any active
    // story and fall through to the bomber chase — watching a building 400u
    // away while hand-flying at the altitude floor is not survivable. viewMode
    // is untouched: when the AI's grace expires the FSMs acquire fresh.
    const manualOverride = this.manualOverrideProvider ? this.manualOverrideProvider() : false;
    if (manualOverride && this.viewMode !== 'chase') {
      const hadStory = this.rocket.hasStory() || this.panic.hasStory();
      if (hadStory) {
        this.rocket.reset();
        this.panic.reset();
        this.snapBehindBomber();
      }
    }

    // Rocket View state machine. Falls through to the normal bomber chase when
    // there is nothing to follow (that fall-through IS the revert view).
    if (this.viewMode === 'rocket' && !manualOverride && this.rocket.update(deltaTime)) return;

    // Panic View state machine: victim's-eye stories. Returns while a story owns
    // the camera (free-look drags are ignored, Rocket View parity); None with no
    // candidate falls through to the bomber chase below.
    if (this.viewMode === 'panic' && !manualOverride && this.panic.update(deltaTime)) return;

    // Camera adjustments are only allowed while the camera-control mode is active.
    // Otherwise a single-finger swipe steers the plane and the camera just follows.
    const isCameraMode = inputManager.getTouchCameraMode();

    // Handle mouse controls - drag to pan/raise the camera (only in camera mode)
    if (isCameraMode && inputManager.getIsMouseDragging()) {
      const mouseDeltaX = inputManager.getMouseDeltaX();
      const mouseDeltaY = inputManager.getMouseDeltaY();
      const mouseSensitivity = 0.005; // Adjust sensitivity

      // Mouse X controls panning (like Z/C keys)
      if (Math.abs(mouseDeltaX) > 0) {
        this.panAngleOffset += mouseDeltaX * mouseSensitivity;
        this.trigCacheValid = false;
      }

      // Mouse Y controls height (like Q/E keys) - not inverted, much higher sensitivity to match panning
      if (Math.abs(mouseDeltaY) > 0) {
        this.followHeightOffset += mouseDeltaY * mouseSensitivity * 300; // Tripled sensitivity to match pan amount
      }
    }

    // Handle touch camera controls (single-finger swipe) - only in camera mode
    if (isCameraMode && inputManager.getIsTouchCamera()) {
      const touchDeltaX = inputManager.getTouchDeltaX();
      const touchDeltaY = inputManager.getTouchDeltaY();
      const touchSensitivity = 0.005; // Same as mouse sensitivity

      // Touch X controls panning (like Z/C keys)
      if (Math.abs(touchDeltaX) > 0) {
        this.panAngleOffset += touchDeltaX * touchSensitivity;
        this.trigCacheValid = false;
      }

      // Touch Y controls height (like Q/E keys) - not inverted, much higher sensitivity to match panning
      if (Math.abs(touchDeltaY) > 0) {
        this.followHeightOffset += touchDeltaY * touchSensitivity * 300; // Tripled sensitivity to match pan amount
      }
    }

    const bomberPos = this.bomber.getPositionRef();
    const bomberRotation = this.bomber.getRotationRef();

    // Calculate effective rotation with caching to avoid repeated trig calculations
    const effectiveRotation = bomberRotation.y + this.panAngleOffset;

    // Only recalculate trigonometric values if rotation changed significantly
    if (!this.trigCacheValid || Math.abs(effectiveRotation - this.lastEffectiveRotation) > 0.01) {
      this.cachedSin = Math.sin(effectiveRotation);
      this.cachedCos = Math.cos(effectiveRotation);
      this.lastEffectiveRotation = effectiveRotation;
      this.trigCacheValid = true;
    }

    // Calculate desired camera position using cached values and reusable vectors
    const desiredX = bomberPos.x - this.cachedSin * this.followDistance;
    const desiredZ = bomberPos.z - this.cachedCos * this.followDistance;

    const minHeightAboveGround = 10; // Minimum height above ground
    // Height is an offset relative to the bomber. followHeightOffset is raised/lowered unbounded
    // by mouse/touch drag above, so clamp it here (it may be negative to sit below the bomber),
    // then place the camera that far from the bomber's altitude — but never below the ground
    // floor. So a negative offset only descends below the bomber when there's room above ground.
    const clampedOffset = Math.max(this.minFollowHeightOffset, Math.min(this.maxFollowHeightOffset, this.followHeightOffset));
    const clampedFollowHeight = Math.max(bomberPos.y + clampedOffset, minHeightAboveGround);

    this.chaseDesired.set(desiredX, clampedFollowHeight, desiredZ);
    this.rig.moveToward(this.chaseDesired, this.smoothing, deltaTime, false);

    // Always look at the bomber directly
    this.rig.setTargetDirect(bomberPos);
  }

  public setMissileProvider(provider: () => RocketViewCandidate | null): void {
    this.rocket.setProvider(provider);
  }

  public setManualOverrideProvider(provider: () => boolean): void {
    this.manualOverrideProvider = provider;
  }

  public setPanicProvider(provider: () => PanicViewCandidate | null): void {
    this.panic.setProvider(provider);
  }

  /**
   * THE single view-mode transition. Enforces mutual exclusivity (leaving a
   * mode ends its active story) and the AI-mode requirement in one place.
   * Enabled ≠ active: entering a mode only makes its FSM listen; leaving it is
   * what tears an active story down.
   */
  public setViewMode(mode: ViewMode): void {
    if (mode === this.viewMode) return;
    if (mode !== 'chase' && !this.aiEnabled) return; // cinematic views require autopilot
    const prev = this.viewMode;
    this.viewMode = mode;
    if (prev === 'rocket') {
      this.rocket.disable();
    } else if (prev === 'panic') {
      this.panic.disable();
    }
    this.events.emit('viewModeChanged', { mode });
  }

  public getViewMode(): ViewMode {
    return this.viewMode;
  }

  // Compat delegates — headless test drivers and .claude/skills/verify use these.
  public setRocketViewEnabled(enabled: boolean): void {
    if (enabled) this.setViewMode('rocket');
    else if (this.viewMode === 'rocket') this.setViewMode('chase');
  }

  public setPanicViewEnabled(enabled: boolean): void {
    if (enabled) this.setViewMode('panic');
    else if (this.viewMode === 'panic') this.setViewMode('chase');
  }

  public isPanicViewEnabled(): boolean {
    return this.viewMode === 'panic';
  }

  /** Instrumentation for tests: the current Panic View sub-state name. */
  public getPanicSubState(): string {
    return this.panic.getSubStateName();
  }

  /** The story kind the camera is committed to (retained through ImpactHold), or null. */
  public getActivePanicKind(): PanicViewKind | null {
    return this.panic.getActiveKind();
  }

  /** Instrumentation for tests: the current Rocket View sub-state name. */
  public getRocketSubState(): string {
    return this.rocket.getSubStateName();
  }

  public isRocketViewEnabled(): boolean {
    return this.viewMode === 'rocket';
  }

  public isFollowingMissile(): boolean {
    return this.rocket.isFollowingMissile();
  }

  /** True while Rocket View is committed to a Tomahawk story (bay/belly, chase, or its explosion hold). */
  public isInTomahawkSequence(): boolean {
    return this.rocket.isInTomahawkSequence();
  }

  public toggleGroundCrosshairs(): void {
    this.showGroundCrosshairs = !this.showGroundCrosshairs;
  }

  public getShowGroundCrosshairs(): boolean {
    return this.showGroundCrosshairs;
  }

  public setShowGroundCrosshairs(show: boolean): void {
    this.showGroundCrosshairs = show;
  }

  public getCamera(): FreeCamera {
    return this.camera;
  }

  /**
   * Re-center the camera behind the bomber: clears the free-look yaw and height
   * offsets accumulated in camera mode. The per-frame smoothing lerp in update()
   * turns this into a smooth swing-back rather than a teleport.
   */
  public snapBehindBomber(): void {
    this.followHeightOffset = this.initialFollowHeightOffset;
    this.panAngleOffset = 0;
    this.trigCacheValid = false;
  }
}

/**
 * Rocket View: while enabled, follow the missile supplied by the provider instead of
 * the bomber, showing its full lifecycle. A small sub-state machine handles the
 * Iskander launch-framing → chase hand-off and the post-explosion hold (see update()).
 *
 * Private to this module: CameraController owns the viewMode and the manual-
 * override gate; this director owns the follow FSM, its tunables, and its own
 * scratch vectors. It never touches the camera except via the CameraRig.
 */
class RocketViewDirector {
  private readonly rig: CameraRig;
  private readonly bomber: Bomber;
  private readonly terrainManager: TerrainManager;
  // Reverts the free-look offsets when a story ends (bound snapBehindBomber).
  private readonly onRevert: () => void;

  private followedMissile: FollowableMissile | null = null;
  private followedKind: RocketViewKind | null = null;
  private rocketSubState: RocketSubState = RocketSubState.None;
  private missileProvider: (() => RocketViewCandidate | null) | null = null;
  // Missiles are ~5 units long (vs the bomber's 200-unit follow distance), and they
  // maneuver hard — sit close behind and track stiffly.
  private missileChaseDistance: number = 30;
  private missileChaseHeight: number = 10;
  private missileChaseSmoothing: number = 5.0;
  // Heading fallback for any near-zero-velocity frame (e.g. the instant of acquisition).
  private lastChaseDir: Vector3 = new Vector3(0, 0, 1);
  // Explosion-hold: linger on the blast for a beat so the player sees the missile die.
  private explosionPoint: Vector3 = new Vector3();
  private explosionHoldTimer: number = 0;
  private readonly explosionHoldDuration: number = 1.5;
  // Launch framing: a STATIC elevated down-shot on the launcher — near enough to read
  // the vehicle, high enough that a slice of horizon stays in frame (see the pitch
  // math in beginLauncherDownShot). Captured once when the prelaunch dwell begins;
  // IskanderLaunch then dollies in from it toward the chase pose. TUNABLE.
  private readonly DOWNSHOT_DIST = 120;            // horizontal standoff from the launcher
  private readonly DOWNSHOT_HEIGHT = 70;           // camera height above the launcher base
  private readonly DOWNSHOT_LOOKAT_UP = 35;        // aim point this far above the base
  private readonly launchDollySmoothing = 3.0;     // dolly-in position rate (chase runs 5.0)
  private launchCamPos: Vector3 = new Vector3();   // captured static camera pose (reused)
  private launchLookAt: Vector3 = new Vector3();   // captured static look-at (reused)
  // Column anchor x/z captured by beginLauncherDownShot — compared against the provider's
  // anchor each frame during IskanderPrelaunch so a swapped launcher re-frames.
  private columnAnchorX: number = 0;
  private columnAnchorZ: number = 0;
  // Tomahawk cinematic: Beat 1 is a stiff belly cam riding with the bomber while the bay
  // doors open and the missile drops; Beat 2 eases out to a chase pose hung above the
  // missile on the far side from the target and rides it through the loops and the
  // terminal dive to impact; the shared ExplosionHold then falls close for the kill.
  // TUNABLE.
  // Belly pose — bomber-local offsets: beside, below and behind the bomb bay.
  private readonly BELLY_SIDE = 8;
  private readonly BELLY_DOWN = 12;
  private readonly BELLY_BACK = 18;
  private readonly bellySmoothing = 10.0;          // stiff — the pose tracks a moving bomber
  private readonly bellyTargetSmoothing = 8.0;
  // Chase pose — anchored to the horizontal missile→target bearing, NOT the velocity
  // (the loops swing the velocity through full turns; the bearing drifts slowly). The
  // camera hangs behind/above the missile away from the target and aims between the
  // two so both stay in frame while the missile swings beneath it — the offset is
  // anchored to the missile, so bearing error never moves the missile in frame, only
  // (transiently) the target. See updateTomahawkChase.
  private readonly TOMA_CHASE_BACK = 75;           // horizontal standoff behind the missile
  private readonly TOMA_CHASE_UP = 35;             // height above the missile (≈25° depression)
  private readonly TOMA_LOOKAT_BLEND = 0.3;        // aim at missile + blend·(target − missile)
  private readonly tomaBearingSmoothing = 1.5;     // bearing slew — low-passes the loop wobble
  private readonly tomaChaseSmoothing = 4.0;       // position rate; the lag IS the string-swing
  private readonly tomaChaseTargetSmoothing = 5.0; // look-at rate
  // Inside this horizontal radius the bearing freezes: covers the loop-2 close pass,
  // the overfly flip, and the terminal dive — the camera holds its offset and rides down.
  private readonly TOMA_BEARING_FREEZE_DIST = 120;
  // Unit horizontal target→missile bearing the chase offset hangs from.
  private tomahawkBearing: Vector3 = new Vector3(0, 0, 1);
  private tomahawkTargetRef: Vector3 | null = null; // followed Tomahawk's impact point (ref)
  // Chase de-jerk: slew the heading toward velocity and smooth the look-at instead of
  // snapping each frame, so the camera follows the arc but not every guidance wag. TUNABLE.
  private readonly headingSmoothing = 2.5;
  private readonly targetSmoothing = 6.0;
  // Own per-frame scratch — never aliased with the controller's or Panic View's.
  private desiredPos: Vector3 = new Vector3();
  private aimScratch: Vector3 = new Vector3();

  constructor(
    rig: CameraRig,
    bomber: Bomber,
    terrainManager: TerrainManager,
    onRevert: () => void,
  ) {
    this.rig = rig;
    this.bomber = bomber;
    this.terrainManager = terrainManager;
    this.onRevert = onRevert;
  }

  /**
   * Run the Rocket View state machine for one frame. Returns true while it owns
   * the camera; false falls through to the bomber chase (the revert view).
   */
  public update(deltaTime: number): boolean {
    // ExplosionHold: linger on the copied blast point, then revert and re-evaluate.
    if (this.rocketSubState === RocketSubState.ExplosionHold) {
      this.explosionHoldTimer -= deltaTime;
      this.holdOnExplosion(deltaTime);
      if (this.explosionHoldTimer <= 0) {
        this.reset();
        this.onRevert();
      }
      return true;
    }

    // Followed missile just exploded → copy the blast point and enter the hold.
    if (this.followedMissile && this.followedMissile.hasExploded()) {
      this.explosionPoint.copyFrom(this.followedMissile.getPositionRef());
      this.explosionHoldTimer = this.explosionHoldDuration;
      this.rocketSubState = RocketSubState.ExplosionHold;
      this.holdOnExplosion(deltaTime);
      return true;
    }

    if (this.missileProvider) {
      if (!this.hasFollow()) {
        // Acquire a fresh target (provider only returns about-to-launch defense
        // missiles, so we never snap onto one already mid-flight).
        const candidate = this.missileProvider();
        if (candidate) {
          this.acquire(candidate);
          // Teleport to the pose instead of lerping across the map, then lerp.
          this.applyRocketPose(deltaTime, true);
          return true;
        }
      } else {
        // A strictly higher-ranked live candidate preempts the current follow
        // (see priorityOf). The Iskander preempting its own prelaunch IS the
        // prelaunch→launch handoff; likewise Tomahawk over TomahawkBay. Same
        // rank never hops, and anchor-only↔anchor-only same-kind compares
        // equal (null === null) so it never re-acquires.
        const candidate = this.missileProvider();
        if (
          candidate &&
          candidate.missile !== this.followedMissile &&
          this.priorityOf(candidate.kind) > this.priorityOf(this.followedKind)
        ) {
          this.acquire(candidate);
          this.applyRocketPose(deltaTime, true);
          return true;
        }
        // Anchor-only follow maintenance: there is no missile whose explosion
        // ends the follow, so track the provider's anchor instead.
        if (this.followedMissile === null) {
          if (candidate && candidate.kind === this.followedKind) {
            // Launcher swapped mid-dwell → lerped re-frame onto the new column
            // (no snap). Only prelaunch anchors a column; the belly cam tracks
            // the bomber itself and carries no meaningful anchor.
            if (
              this.followedKind === RocketViewKind.IskanderPrelaunch &&
              Math.abs(candidate.anchorX - this.columnAnchorX) +
                Math.abs(candidate.anchorZ - this.columnAnchorZ) > 0.5
            ) {
              this.beginLauncherDownShot(candidate.anchorX, candidate.anchorZ);
            }
          } else {
            // Anchor lost (launcher destroyed with no replacement, or the
            // Tomahawk launch aborted while the doors opened) → drop the
            // follow, take whatever the provider still offers, else revert.
            this.reset();
            if (candidate) {
              this.acquire(candidate);
              this.applyRocketPose(deltaTime, true);
              return true;
            }
            this.onRevert();
          }
        }
      }
    }

    if (this.hasFollow()) {
      const followed = this.followedMissile;
      // Hand off from the launch dolly-in to the chase once the Iskander tops out.
      // lastChaseDir is already live from the heading slew, so the handoff is a
      // pure smoothing-rate change (launchDollySmoothing → missileChaseSmoothing).
      if (
        this.rocketSubState === RocketSubState.IskanderLaunch &&
        followed &&
        followed.isClimbing?.() === false
      ) {
        this.rocketSubState = RocketSubState.IskanderChase;
      } else if (
        this.rocketSubState === RocketSubState.TomahawkBelly &&
        followed &&
        followed.isInLaunchPhase?.() === false
      ) {
        // Beat 1 → Beat 2: the drop is done; ease out from the belly pose into
        // the chase (the belly cam already sits roughly on the away-from-target
        // side of the just-dropped missile, so the lerp reads as a crane-out).
        this.rocketSubState = RocketSubState.TomahawkChase;
        this.beginTomahawkChase(followed);
      }
      // Locked follow: free-look drags are intentionally ignored.
      this.applyRocketPose(deltaTime, false);
      return true;
    }

    return false;
  }

  /**
   * Leaving Rocket View (setViewMode): tear down an active story. Guards on
   * followedKind, NOT the sub-state — during ExplosionHold the kind is still
   * set. Also zeroes the hold timer so a re-enable can't resume a stale hold.
   */
  public disable(): void {
    if (this.followedKind !== null) {
      this.reset();
      this.explosionHoldTimer = 0;
      this.onRevert();
    }
  }

  /** True while any Rocket View story state is live (follow or sub-state). */
  public hasStory(): boolean {
    return this.hasFollow() || this.rocketSubState !== RocketSubState.None;
  }

  /** Drop the current follow entirely; the next frame acquires or reverts. */
  public reset(): void {
    this.followedMissile = null;
    this.followedKind = null;
    this.tomahawkTargetRef = null;
    this.rocketSubState = RocketSubState.None;
  }

  public setProvider(provider: () => RocketViewCandidate | null): void {
    this.missileProvider = provider;
  }

  /** Instrumentation for tests: the current Rocket View sub-state name. */
  public getSubStateName(): string {
    return RocketSubState[this.rocketSubState];
  }

  public isFollowingMissile(): boolean {
    return this.followedMissile !== null;
  }

  /** True while Rocket View is committed to a Tomahawk story (bay/belly, chase, or its explosion hold). */
  public isInTomahawkSequence(): boolean {
    return (
      this.followedKind === RocketViewKind.Tomahawk ||
      this.followedKind === RocketViewKind.TomahawkBay
    );
  }

  /** True while Rocket View owns the camera — anchor-only follows have no missile. */
  private hasFollow(): boolean {
    return this.followedKind !== null;
  }

  /** Record a freshly acquired (or preempted) target and pick the sub-state. */
  private acquire(candidate: RocketViewCandidate): void {
    this.followedMissile = candidate.missile;
    this.followedKind = candidate.kind;
    if (candidate.kind === RocketViewKind.IskanderPrelaunch) {
      // Dwell on the pre-selected launcher: the same down-shot the launch dollies
      // in from, so the later prelaunch→launch preemption lands where we already are.
      this.rocketSubState = RocketSubState.IskanderPrelaunch;
      this.beginLauncherDownShot(candidate.anchorX, candidate.anchorZ);
    } else if (candidate.kind === RocketViewKind.Iskander && candidate.missile) {
      if (candidate.missile.isClimbing?.()) {
        this.rocketSubState = RocketSubState.IskanderLaunch;
        this.beginLaunchFraming(candidate.missile); // captures the static pose + seeds the rig's aim
        // The boost is straight up; seeding the heading vertical makes the dolly-in
        // borrow its azimuth from the camera position from the first frame.
        this.lastChaseDir.set(0, 1, 0);
      } else {
        this.rocketSubState = RocketSubState.IskanderChase;
        this.rig.seedAim(candidate.missile.getPositionRef());
      }
    } else if (candidate.kind === RocketViewKind.TomahawkBay) {
      // Belly cam on the bomber while the bay doors open; the look-at seeds at
      // the bay point so the first frame isn't aimed at a stale target.
      this.rocketSubState = RocketSubState.TomahawkBelly;
      const bomberPos = this.bomber.getPositionRef();
      const yaw = this.bomber.getRotationRef().y;
      this.aimScratch.set(
        bomberPos.x - Math.sin(yaw) * 3,
        bomberPos.y - 3,
        bomberPos.z - Math.cos(yaw) * 3,
      );
      this.rig.seedAim(this.aimScratch);
    } else if (candidate.kind === RocketViewKind.Tomahawk && candidate.missile) {
      if (candidate.missile.isInLaunchPhase?.()) {
        // Keep the belly cam through the drop; the chase bearing is seeded at the
        // Beat 1→2 transition, not here.
        this.rocketSubState = RocketSubState.TomahawkBelly;
      } else {
        // Defensive: acquired outside the launch window — go straight to the chase
        // (the caller's snap frame lands the pose immediately).
        this.rocketSubState = RocketSubState.TomahawkChase;
        this.beginTomahawkChase(candidate.missile);
      }
    } else if (candidate.missile) {
      // One immediate cut straight into the chase pose — no pad-framing beat.
      this.rocketSubState = RocketSubState.DefenseFollow;
      const v = candidate.missile.getVelocityRef();
      if (v.lengthSquared() < 1) {
        // On-pad (velocity still zero awaiting the trajectory solve): the missile
        // rises vertically, so seed the heading straight up. The vertical clamp
        // then borrows its azimuth from the camera position — and the snapped
        // chase pose is a fixed point of that borrow, so the shot holds still
        // through the climb instead of corkscrewing.
        this.lastChaseDir.set(0, 1, 0);
      } else {
        const vl = v.length();
        this.lastChaseDir.set(v.x / vl, v.y / vl, v.z / vl);
      }
      this.rig.seedAim(candidate.missile.getPositionRef());
    }
  }

  /**
   * Preemption rank: higher wins (strictly — equal never hops).
   * Iskander > IskanderPrelaunch > Tomahawk > TomahawkBay > Defense.
   */
  private priorityOf(kind: RocketViewKind | null): number {
    switch (kind) {
      case RocketViewKind.Iskander: return 4;
      case RocketViewKind.IskanderPrelaunch: return 3;
      case RocketViewKind.Tomahawk: return 2;
      case RocketViewKind.TomahawkBay: return 1;
      case RocketViewKind.Defense: return 0;
      default: return -1;
    }
  }

  /**
   * Dispatch the per-frame pose for the current sub-state. Anchor-only states
   * (IskanderPrelaunch, missile-less TomahawkBelly) work without a followed
   * missile.
   */
  private applyRocketPose(deltaTime: number, snap: boolean): void {
    switch (this.rocketSubState) {
      case RocketSubState.IskanderPrelaunch:
        this.updateLaunchFraming(deltaTime, snap);
        break;
      case RocketSubState.IskanderLaunch:
        // Snap frame (the prelaunch→launch preemption): cut to the down-shot pose,
        // which is where the settled prelaunch camera already sits, with an EASED
        // look-at — an invisible cut. Every frame after, dolly in toward the chase
        // pose. The climb is vertical, so the chase offset borrows its azimuth
        // from the camera position and the camera flies radially inward along its
        // own bearing — a fixed point of the borrow, so no corkscrew.
        if (snap) {
          this.rig.moveToward(this.launchCamPos, this.launchDollySmoothing, deltaTime, true);
          this.rig.aimToward(this.launchLookAt, deltaTime, false, this.targetSmoothing);
        } else if (this.followedMissile) {
          this.updateMissileChase(this.followedMissile, deltaTime, false, this.launchDollySmoothing);
        }
        break;
      case RocketSubState.TomahawkBelly:
        this.updateTomahawkBelly(deltaTime, snap);
        break;
      case RocketSubState.TomahawkChase:
        // Belt-and-braces: without an impact point the bearing chase can't aim,
        // so fall back to the plain velocity chase.
        if (this.followedMissile && this.tomahawkTargetRef) {
          this.updateTomahawkChase(this.followedMissile, deltaTime, snap);
        } else if (this.followedMissile) {
          this.updateMissileChase(this.followedMissile, deltaTime, snap);
        }
        break;
      default:
        // IskanderChase and DefenseFollow share the chase machinery.
        if (this.followedMissile) {
          this.updateMissileChase(this.followedMissile, deltaTime, snap);
        }
    }
  }

  /**
   * Capture the static elevated down-shot on a launcher, ONCE when the framing
   * state begins (Iskander prelaunch dwell, Iskander launch). The camera stands
   * DOWNSHOT_DIST out and DOWNSHOT_HEIGHT above the launcher base, aiming at a
   * point DOWNSHOT_LOOKAT_UP above it: pitch-down = atan((70−35)/120) ≈ 16.3°,
   * inside the 22.9° half-VFOV — so the horizon sits near the top of the frame
   * with the launcher in the lower half. The bearing is taken from where the
   * camera already is (fallback +Z), so the establishing cut doesn't swing far.
   * No per-frame recompute — the pose is held static. Because the missile spawns
   * at the same x,z the prelaunch dwelled on, re-running this at launch
   * reproduces ~the settled pose and the handoff is seamless.
   */
  private beginLauncherDownShot(ax: number, az: number): void {
    this.columnAnchorX = ax;
    this.columnAnchorZ = az;
    const baseY = this.terrainManager.getTerrainHeightAt(ax, az); // 0 over unloaded chunks — fine
    const camPos = this.rig.getPositionRef();
    let dirX = camPos.x - ax;
    let dirZ = camPos.z - az;
    const dl = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (dl > 0.001) { dirX /= dl; dirZ /= dl; } else { dirX = 0; dirZ = 1; }
    this.launchCamPos.set(
      ax + dirX * this.DOWNSHOT_DIST,
      baseY + this.DOWNSHOT_HEIGHT,
      az + dirZ * this.DOWNSHOT_DIST,
    );
    this.rig.clampAboveTerrain(this.launchCamPos);
    this.launchLookAt.set(ax, baseY + this.DOWNSHOT_LOOKAT_UP, az);
    // Seed the smoothed look-at so the first setTarget isn't aimed at the origin.
    this.rig.seedAim(this.launchLookAt);
  }

  /** Frame the down-shot at the missile's x,z — the launcher it is climbing off. */
  private beginLaunchFraming(missile: FollowableMissile): void {
    const iPos = missile.getPositionRef();
    this.beginLauncherDownShot(iPos.x, iPos.z);
  }

  /**
   * Hold the static down-shot captured in beginLauncherDownShot. The pose is
   * constant, so the lerp settles within ~0.3s and the camera is then genuinely
   * still (smoothest). No missile needed — framing is anchored to the captured
   * launcher, so this drives the anchor-only IskanderPrelaunch dwell.
   */
  private updateLaunchFraming(deltaTime: number, snap: boolean): void {
    this.rig.moveToward(this.launchCamPos, this.missileChaseSmoothing, deltaTime, snap);
    this.rig.aimToward(this.launchLookAt, deltaTime, snap, this.targetSmoothing);
  }

  /**
   * Beat 1: belly cam riding with the bomber — beside, below and behind the bomb
   * bay so the opening doors and the dropping missile fill the frame. The pose is
   * recomputed every frame in the bomber's yaw frame and tracked stiffly (the
   * bomber is moving). The look-at is the missile once it exists, else the bay
   * point under the doors; the two are ~2u apart, so the TomahawkBay→Tomahawk
   * handoff (same formula on both sides) is invisible.
   */
  private updateTomahawkBelly(deltaTime: number, snap: boolean): void {
    const bomberPos = this.bomber.getPositionRef();
    const yaw = this.bomber.getRotationRef().y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);  // bomber forward
    const rx = Math.cos(yaw), rz = -Math.sin(yaw); // bomber right

    this.desiredPos.set(
      bomberPos.x + rx * this.BELLY_SIDE - fx * this.BELLY_BACK,
      bomberPos.y - this.BELLY_DOWN,
      bomberPos.z + rz * this.BELLY_SIDE - fz * this.BELLY_BACK,
    );
    this.rig.clampAboveTerrain(this.desiredPos);
    this.rig.moveToward(this.desiredPos, this.bellySmoothing, deltaTime, snap);

    let lookAt: Vector3;
    if (this.followedMissile) {
      lookAt = this.followedMissile.getPositionRef();
    } else {
      this.aimScratch.set(bomberPos.x - fx * 3, bomberPos.y - 3, bomberPos.z - fz * 3);
      lookAt = this.aimScratch;
    }
    this.rig.aimToward(lookAt, deltaTime, snap, this.bellyTargetSmoothing);
  }

  /**
   * Beat 2 setup: cache the impact point and seed the chase bearing — horizontal
   * target→missile, falling back to the camera's own bearing off the missile
   * (prior art: the vertical-heading borrow in updateMissileChase), then +Z.
   * The smoothed look-at is deliberately left alive from the belly cam so the
   * pan into the new aim point is continuous — the handoff is an ease, not a cut.
   * lastChaseDir is aimed at the target so the shared ExplosionHold later sits
   * behind the approach, on the same side the chase camera already is.
   */
  private beginTomahawkChase(missile: FollowableMissile): void {
    this.tomahawkTargetRef = missile.getTargetPosition?.() ?? null;
    const pos = missile.getPositionRef();
    let bx: number, bz: number;
    if (this.tomahawkTargetRef) {
      bx = pos.x - this.tomahawkTargetRef.x;
      bz = pos.z - this.tomahawkTargetRef.z;
    } else {
      const camPos = this.rig.getPositionRef();
      bx = camPos.x - pos.x;
      bz = camPos.z - pos.z;
    }
    const bl = Math.sqrt(bx * bx + bz * bz);
    if (bl > 0.001) { bx /= bl; bz /= bl; } else { bx = 0; bz = 1; }
    this.tomahawkBearing.set(bx, 0, bz);
    this.lastChaseDir.set(-bx, 0, -bz);
  }

  /**
   * Beat 2 per-frame: hang the camera TOMA_CHASE_BACK behind / TOMA_CHASE_UP
   * above the missile along the slewed horizontal target→missile bearing and aim
   * between missile and target (TOMA_LOOKAT_BLEND — missile lower-center, target
   * upper-center). The offset is anchored to the missile, so however wrong the
   * bearing transiently is (loop 2 can spin it faster than any slew tracks), the
   * missile itself never leaves frame — it just swings beneath the camera as it
   * flies the loops, hanging as if from a string. Inside TOMA_BEARING_FREEZE_DIST
   * the bearing freezes: the camera keeps its offset through the overfly flip and
   * rides it down the terminal dive to impact.
   */
  private updateTomahawkChase(missile: FollowableMissile, deltaTime: number, snap: boolean): void {
    const tgt = this.tomahawkTargetRef;
    if (!tgt) return; // dispatch guards this; keep the pose if it ever slips through
    const m = missile.getPositionRef();
    const b = this.tomahawkBearing;

    const dx = m.x - tgt.x;
    const dz = m.z - tgt.z;
    const dHoriz = Math.sqrt(dx * dx + dz * dz);
    if (dHoriz > this.TOMA_BEARING_FREEZE_DIST) {
      const lf = Math.min(this.tomaBearingSmoothing * deltaTime, 1.0);
      const nx = b.x + (dx / dHoriz - b.x) * lf;
      const nz = b.z + (dz / dHoriz - b.z) * lf;
      const nl = Math.sqrt(nx * nx + nz * nz);
      // Near-opposite bearings can cancel to ~zero — keep the old bearing then.
      if (nl > 0.0001) b.set(nx / nl, 0, nz / nl);
    }

    this.desiredPos.set(
      m.x + b.x * this.TOMA_CHASE_BACK,
      m.y + this.TOMA_CHASE_UP,
      m.z + b.z * this.TOMA_CHASE_BACK,
    );
    this.rig.clampAboveTerrain(this.desiredPos);
    this.rig.moveToward(this.desiredPos, this.tomaChaseSmoothing, deltaTime, snap);

    this.aimScratch.set(
      m.x + (tgt.x - m.x) * this.TOMA_LOOKAT_BLEND,
      m.y + (tgt.y - m.y) * this.TOMA_LOOKAT_BLEND,
      m.z + (tgt.z - m.z) * this.TOMA_LOOKAT_BLEND,
    );
    this.rig.aimToward(this.aimScratch, deltaTime, snap, this.tomaChaseTargetSmoothing);

    // Keep the hold seed live: at impact the ExplosionHold backs off along
    // -lastChaseDir — the same side of the blast the chase camera is already on.
    this.lastChaseDir.set(-b.x, 0, -b.z);
  }

  private updateMissileChase(missile: FollowableMissile, deltaTime: number, snap: boolean, posRate: number = this.missileChaseSmoothing): void {
    const missilePos = missile.getPositionRef();
    const velocity = missile.getVelocityRef();
    // Trust velocity as the heading only when the missile is actually moving
    // (speed > 5 u/s); otherwise keep the last known direction. Slew toward the
    // velocity instead of snapping so the camera follows the missile's arc but not
    // every high-rate guidance wag (the main source of chase jerk).
    if (velocity.lengthSquared() > 25) {
      const vl = velocity.length();
      const tx = velocity.x / vl, ty = velocity.y / vl, tz = velocity.z / vl;
      const hlf = Math.min(this.headingSmoothing * deltaTime, 1.0);
      const nx = this.lastChaseDir.x + (tx - this.lastChaseDir.x) * hlf;
      const ny = this.lastChaseDir.y + (ty - this.lastChaseDir.y) * hlf;
      const nz = this.lastChaseDir.z + (tz - this.lastChaseDir.z) * hlf;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl > 0.0001) this.lastChaseDir.set(nx / nl, ny / nl, nz / nl);
    }
    const dir = this.lastChaseDir; // full 3D heading — the camera pitches with dives

    // Both followed types climb steeply; a near-vertical heading would park the
    // camera exactly under/over the missile where setTarget's default up vector
    // degenerates. Clamp the OFFSET direction only (lastChaseDir keeps the true
    // heading) to keep a horizontal standoff.
    let ox = dir.x, oy = dir.y, oz = dir.z;
    const horiz = Math.sqrt(ox * ox + oz * oz);
    const minHoriz = 0.35; // ~20° off vertical
    if (horiz < minHoriz) {
      // Borrow the horizontal bearing from where the camera already is so it
      // holds its side instead of snapping to an arbitrary azimuth.
      const camPos = this.rig.getPositionRef();
      let bx = camPos.x - missilePos.x;
      let bz = camPos.z - missilePos.z;
      const b = Math.sqrt(bx * bx + bz * bz);
      if (b > 0.001) { bx /= b; bz /= b; } else { bx = 0; bz = 1; }
      ox = -bx * minHoriz; // camera = missile - offset*distance → negative pushes
      oz = -bz * minHoriz; // the camera toward the borrowed bearing
      oy = Math.sign(oy || 1) * Math.sqrt(1 - minHoriz * minHoriz);
    }

    this.desiredPos.set(
      missilePos.x - ox * this.missileChaseDistance,
      missilePos.y - oy * this.missileChaseDistance + this.missileChaseHeight,
      missilePos.z - oz * this.missileChaseDistance,
    );
    // Followed missiles fly near the rooftops at launch, so clamp against real
    // terrain, not just the world floor.
    this.rig.clampAboveTerrain(this.desiredPos);

    this.rig.moveToward(this.desiredPos, posRate, deltaTime, snap);
    this.rig.aimToward(missilePos, deltaTime, snap, this.targetSmoothing);
  }

  /**
   * Linger on a missile's explosion. Eases to a standoff from the copied blast
   * point along the last chase heading and watches it. The point is copied at
   * hold entry, so this is independent of when the missile object is disposed.
   */
  private holdOnExplosion(deltaTime: number): void {
    const dir = this.lastChaseDir;
    let ox = dir.x, oy = dir.y, oz = dir.z;
    const horiz = Math.sqrt(ox * ox + oz * oz);
    const minHoriz = 0.35;
    if (horiz < minHoriz) {
      const camPos = this.rig.getPositionRef();
      let bx = camPos.x - this.explosionPoint.x;
      let bz = camPos.z - this.explosionPoint.z;
      const b = Math.sqrt(bx * bx + bz * bz);
      if (b > 0.001) { bx /= b; bz /= b; } else { bx = 0; bz = 1; }
      ox = -bx * minHoriz;
      oz = -bz * minHoriz;
      oy = Math.sign(oy || 1) * Math.sqrt(1 - minHoriz * minHoriz);
    }
    this.desiredPos.set(
      this.explosionPoint.x - ox * this.missileChaseDistance,
      this.explosionPoint.y - oy * this.missileChaseDistance + this.missileChaseHeight,
      this.explosionPoint.z - oz * this.missileChaseDistance,
    );
    this.rig.clampAboveTerrain(this.desiredPos);

    this.rig.moveToward(this.desiredPos, this.missileChaseSmoothing * 0.5, deltaTime, false);
    this.rig.setTargetDirect(this.explosionPoint);
  }
}

/**
 * Panic View: victim's-eye camera. Stands near the attack target staring up at
 * the bomber (bombing run) or the incoming Tomahawk — simulating being struck.
 * Mutually exclusive with Rocket View (single viewMode owner). See update().
 *
 * Private to this module: CameraController owns the viewMode and the manual-
 * override gate; this director owns the story FSM, its tunables, and its own
 * scratch vectors. It never touches the camera except via the CameraRig.
 */
class PanicViewDirector {
  private readonly rig: CameraRig;
  private readonly bomber: Bomber;
  private readonly terrainManager: TerrainManager;
  // Reverts the free-look offsets when a story ends (bound snapBehindBomber).
  private readonly onRevert: () => void;

  private panicSubState: PanicSubState = PanicSubState.None;
  private panicProvider: (() => PanicViewCandidate | null) | null = null;
  private panicKind: PanicViewKind | null = null; // retained through ImpactHold — gates the provider
  private panicMissile: FollowableMissile | null = null;
  private panicCamPos: Vector3 = new Vector3();   // static victim pose (recomputed on anchor swap)
  private panicAnchorX: number = 0;               // target-building anchor scalars
  private panicAnchorZ: number = 0;
  private panicTopY: number = 0;                  // target's visible-top world Y
  private panicHoldTimer: number = 0;
  private panicStoryTimer: number = 0;
  // Impact linger: the copied blast/impact point the hold stares at.
  private impactPoint: Vector3 = new Vector3();
  // Mirrors Rocket View's explosionHoldDuration — the two lingers feel the same.
  private readonly impactHoldDuration: number = 1.5;
  // Victim pose: stand past the target on the far side from the bomber, off to
  // one side, eyes near the ground, staring up. TUNABLE.
  private static readonly IMPACT_SHAKE = 2.0;      // rig shake kick as the impact lands
  private readonly PANIC_MAX_STORY = 30;           // s — hard cap on any one story
  private readonly PANIC_STANDOFF = 55;            // horizontal standoff past the building (half-footprint ≤17.5 + clearance)
  private readonly PANIC_SIDE = 25;                // lateral offset — the overfly never passes dead-vertical
  private readonly PANIC_EYE = 5;                  // eye height above the ground
  private readonly PANIC_AIM_BOMBER_WEIGHT = 0.65; // look-at = lerp(building top, bomber/missile, this) —
                                                   // dead-on at the bomber drops typical 8-30-tall targets below frame
  private readonly PANIC_MIN_HORIZ_RATIO = 0.18;   // ~80° pitch cap — setTarget degenerates near vertical
  private readonly panicPosSmoothing = 4.0;
  private readonly panicTargetSmoothing = 5.0;
  // Bombing-story pose: lower and further back than the (Tomahawk) victim pose so
  // the building, the ground the stick lands on, AND the approaching bomber all
  // frame up (45.8° VFOV; bomber cruises 150-200 up). The aim weight is bound by
  // the LATE stick — the lerp drags the aim past the camera as the bomber
  // overflies, pitching the frame up; ≥ ~0.18 cuts the ground right when the
  // near impacts land. The bomber exiting the frame top just before overfly is
  // the accepted trade (user-chosen "balanced" standoff). TUNABLE.
  private readonly PANIC_BOMB_STANDOFF = 120;
  private readonly PANIC_BOMB_SIDE = 35;      // horizontal dist = hypot(120,35) = 125
  private readonly PANIC_BOMB_EYE = 3;
  private readonly PANIC_BOMB_AIM_WEIGHT = 0.15;
  // Own per-frame scratch — never aliased with the controller's or Rocket View's.
  private aimScratch: Vector3 = new Vector3();

  constructor(
    rig: CameraRig,
    bomber: Bomber,
    terrainManager: TerrainManager,
    onRevert: () => void,
  ) {
    this.rig = rig;
    this.bomber = bomber;
    this.terrainManager = terrainManager;
    this.onRevert = onRevert;
  }

  /**
   * Run the Panic View state machine for one frame. Returns true while a story
   * owns the camera (free-look drags are ignored, Rocket View parity); false
   * falls through to the bomber chase.
   */
  public update(deltaTime: number): boolean {
    // Linger on the impact, then revert and re-listen for the next story.
    if (this.panicSubState === PanicSubState.ImpactHold) {
      this.panicHoldTimer -= deltaTime;
      this.applyPanicPose(deltaTime, false);
      if (this.panicHoldTimer <= 0) {
        this.reset();
        this.onRevert();
      }
      return true;
    }

    if (this.panicSubState !== PanicSubState.None) {
      this.panicStoryTimer += deltaTime;
      // The watched Tomahawk just hit — hold on the blast at the camera's feet.
      if (this.panicMissile && this.panicMissile.hasExploded()) {
        this.impactPoint.copyFrom(this.panicMissile.getPositionRef());
        this.beginPanicHold();
        this.applyPanicPose(deltaTime, false);
        return true;
      }
      // Backstop against a story that never ends (the provider's lifecycle
      // clears should always fire first). One re-framed re-acquire is fine.
      // A live-missile watch is self-terminating (the missile always impacts)
      // and long Tomahawk loop paths legitimately fly past 30s — cutting away
      // seconds before impact loses the whole payoff — so it gets 3x the leash.
      const storyCap = this.panicMissile ? this.PANIC_MAX_STORY * 3 : this.PANIC_MAX_STORY;
      if (this.panicStoryTimer > storyCap) {
        this.reset();
        this.onRevert();
        return true;
      }
    }

    if (this.panicProvider) {
      const candidate = this.panicProvider();
      if (this.panicSubState === PanicSubState.None) {
        if (candidate) {
          this.acquire(candidate);
          // Teleport to the victim pose instead of lerping across the map.
          this.applyPanicPose(deltaTime, true);
          return true;
        }
      } else if (candidate && candidate.kind === this.panicKind) {
        // Pending→flight handoff: adopt the Tomahawk the frame it spawns.
        if (candidate.missile) this.panicMissile = candidate.missile;
        // Re-resolved onto a different building → lerped re-frame (no snap;
        // prelaunch-swap precedent in the Rocket View director).
        if (
          Math.abs(candidate.anchorX - this.panicAnchorX) +
            Math.abs(candidate.anchorZ - this.panicAnchorZ) > 0.5
        ) {
          this.beginPanicPose(candidate);
        }
        this.applyPanicPose(deltaTime, false);
        return true;
      } else {
        // Provider no longer offers the committed kind — the story is over.
        if (this.panicKind === PanicViewKind.Bombing) {
          // The stick just finished landing around the camera — hold on the target.
          this.impactPoint.set(this.panicAnchorX, this.panicTopY, this.panicAnchorZ);
          this.beginPanicHold();
          this.applyPanicPose(deltaTime, false);
          return true;
        }
        if (this.panicMissile) {
          // Tomahawk story with the missile still flying: ride it to impact
          // (the explosion check above ends the story).
          this.applyPanicPose(deltaTime, false);
          return true;
        }
        // Pending Tomahawk aborted before the missile existed → revert (and let
        // the bomber chase run this same frame).
        this.reset();
        this.onRevert();
      }
    }

    return false;
  }

  /** Leaving Panic View (setViewMode): tear down an active story. */
  public disable(): void {
    if (this.panicSubState !== PanicSubState.None) {
      this.reset();
      this.onRevert();
    }
  }

  /** True while any Panic View story state is live. */
  public hasStory(): boolean {
    return this.panicSubState !== PanicSubState.None;
  }

  /** Drop the current panic story entirely; the next frame acquires or reverts. */
  public reset(): void {
    this.panicKind = null;
    this.panicMissile = null;
    this.panicSubState = PanicSubState.None;
    this.panicHoldTimer = 0;
    this.panicStoryTimer = 0;
  }

  public setProvider(provider: () => PanicViewCandidate | null): void {
    this.panicProvider = provider;
  }

  /** Instrumentation for tests: the current Panic View sub-state name. */
  public getSubStateName(): string {
    return PanicSubState[this.panicSubState];
  }

  /** The story kind the camera is committed to (retained through ImpactHold), or null. */
  public getActiveKind(): PanicViewKind | null {
    return this.panicKind;
  }

  /** Record a freshly acquired panic story and cut to the victim pose. */
  private acquire(candidate: PanicViewCandidate): void {
    this.panicKind = candidate.kind;
    this.panicMissile = candidate.missile;
    this.panicSubState = candidate.kind === PanicViewKind.Bombing
      ? PanicSubState.BombWatch
      : PanicSubState.TomahawkWatch;
    this.panicHoldTimer = 0;
    this.panicStoryTimer = 0;
    this.beginPanicPose(candidate);
    // Seed the look-at at the bomber so the first frame is already staring up.
    this.rig.seedAim(this.bomber.getPositionRef());
  }

  /**
   * Compute the static victim pose for a (possibly re-framed) anchor: stand
   * PANIC_STANDOFF past the target building on the far side from the bomber,
   * PANIC_SIDE off the axis (so the overfly never passes dead-vertical), eyes
   * PANIC_EYE above the ground. Copies the anchor scalars — Building positions
   * are live refs that must not be stored.
   */
  private beginPanicPose(candidate: PanicViewCandidate): void {
    this.panicAnchorX = candidate.anchorX;
    this.panicAnchorZ = candidate.anchorZ;
    this.panicTopY = candidate.topY;
    const bomberPos = this.bomber.getPositionRef();
    let dirX = candidate.anchorX - bomberPos.x;
    let dirZ = candidate.anchorZ - bomberPos.z;
    const dl = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (dl > 0.001) { dirX /= dl; dirZ /= dl; } else { dirX = 0; dirZ = 1; }
    const bombing = candidate.kind === PanicViewKind.Bombing;
    const standoff = bombing ? this.PANIC_BOMB_STANDOFF : this.PANIC_STANDOFF;
    const side = bombing ? this.PANIC_BOMB_SIDE : this.PANIC_SIDE;
    const eye = bombing ? this.PANIC_BOMB_EYE : this.PANIC_EYE;
    const camX = candidate.anchorX + dirX * standoff - dirZ * side;
    const camZ = candidate.anchorZ + dirZ * standoff + dirX * side;
    // Feet on the ground at the victim's spot; the anchor-side max keeps the eye
    // from sinking below the target's own ground on downhill standoffs.
    // NOTE: deliberately NOT the rig's clampAboveTerrain — two samples, eye
    // height instead of the 5-unit clearance.
    const anchorGround = this.terrainManager.getTerrainHeightAt(candidate.anchorX, candidate.anchorZ);
    const camGround = this.terrainManager.getTerrainHeightAt(camX, camZ);
    this.panicCamPos.set(camX, Math.max(anchorGround + eye, camGround + eye, 10), camZ);
  }

  /**
   * Per-frame victim shot: ease to the static pose and aim between the target
   * building's top and the subject (bomber, incoming Tomahawk, or the impact
   * point during the hold) so both stay in frame — the building anchors the
   * frame bottom while the attacker hangs above it.
   */
  private applyPanicPose(deltaTime: number, snap: boolean): void {
    this.rig.moveToward(this.panicCamPos, this.panicPosSmoothing, deltaTime, snap);

    const subject = this.panicSubState === PanicSubState.ImpactHold
      ? this.impactPoint
      : (this.panicMissile ? this.panicMissile.getPositionRef() : this.bomber.getPositionRef());

    const w = this.panicKind === PanicViewKind.Bombing
      ? this.PANIC_BOMB_AIM_WEIGHT
      : this.PANIC_AIM_BOMBER_WEIGHT;
    this.aimScratch.set(
      this.panicAnchorX + (subject.x - this.panicAnchorX) * w,
      this.panicTopY + (subject.y - this.panicTopY) * w,
      this.panicAnchorZ + (subject.z - this.panicAnchorZ) * w,
    );

    // Near-vertical clamp: keep a horizontal component in the view direction or
    // setTarget's default up vector degenerates staring straight up (same trick
    // as the missile chase). Push the aim point out along its own azimuth,
    // falling back to the building's.
    const camPos = this.rig.getPositionRef();
    const dx = this.aimScratch.x - camPos.x;
    const dy = this.aimScratch.y - camPos.y;
    const dz = this.aimScratch.z - camPos.z;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    if (dy > 0 && horiz < this.PANIC_MIN_HORIZ_RATIO * dy) {
      let bx = dx, bz = dz;
      if (horiz > 0.001) {
        bx /= horiz; bz /= horiz;
      } else {
        bx = this.panicAnchorX - camPos.x;
        bz = this.panicAnchorZ - camPos.z;
        const bl = Math.sqrt(bx * bx + bz * bz);
        if (bl > 0.001) { bx /= bl; bz /= bl; } else { bx = 0; bz = 1; }
      }
      const need = this.PANIC_MIN_HORIZ_RATIO * dy;
      this.aimScratch.x = camPos.x + bx * need;
      this.aimScratch.z = camPos.z + bz * need;
    }
    this.rig.aimToward(this.aimScratch, deltaTime, snap, this.panicTargetSmoothing);
  }

  /** Enter the impact linger; the caller has set impactPoint. */
  private beginPanicHold(): void {
    this.rig.addShake(PanicViewDirector.IMPACT_SHAKE);
    this.panicHoldTimer = this.impactHoldDuration;
    this.panicSubState = PanicSubState.ImpactHold;
  }
}
