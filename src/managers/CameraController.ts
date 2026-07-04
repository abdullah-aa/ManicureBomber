import { Bomber } from '../entities/Bomber';
import { FreeCamera, Vector3 } from '@babylonjs/core';
import { InputManager } from './InputManager';
import { TerrainManager } from './TerrainManager';

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

/**
 * Rocket View camera sub-states. None falls through to the bomber chase (the
 * revert view). See the priority/transition rules in update().
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

  // Performance optimization: reuse Vector3 objects to reduce GC pressure
  private tempVector1: Vector3 = new Vector3();
  private tempVector2: Vector3 = new Vector3();

  // Cache trigonometric calculations to avoid repeated computations
  private lastEffectiveRotation: number = 0;
  private cachedSin: number = 0;
  private cachedCos: number = 0;
  private trigCacheValid: boolean = false;

  // Rocket View: while enabled, follow the missile supplied by the provider instead of
  // the bomber, showing its full lifecycle. A small sub-state machine handles the
  // Iskander launch-framing → chase hand-off and the post-explosion hold (see update()).
  private rocketViewEnabled: boolean = false;
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
  private smoothedTarget: Vector3 = new Vector3(); // smoothed look-at (launch + chase)
  private smoothedTargetValid: boolean = false;    // false until seeded at acquisition

  constructor(camera: FreeCamera, bomber: Bomber, terrainManager: TerrainManager) {
    this.camera = camera;
    this.bomber = bomber;
    this.terrainManager = terrainManager;

    // Store initial value for the snap-behind-bomber action
    this.initialFollowHeightOffset = this.followHeightOffset;
  }

  public update(deltaTime: number, inputManager: InputManager): void {
    // Rocket View state machine. Falls through to the normal bomber chase when
    // there is nothing to follow (that fall-through IS the revert view).
    if (this.rocketViewEnabled) {
      // ExplosionHold: linger on the copied blast point, then revert and re-evaluate.
      if (this.rocketSubState === RocketSubState.ExplosionHold) {
        this.explosionHoldTimer -= deltaTime;
        this.holdOnExplosion(deltaTime);
        if (this.explosionHoldTimer <= 0) {
          this.resetFollow();
          this.snapBehindBomber();
        }
        return;
      }

      // Followed missile just exploded → copy the blast point and enter the hold.
      if (this.followedMissile && this.followedMissile.hasExploded()) {
        this.explosionPoint.copyFrom(this.followedMissile.getPositionRef());
        this.explosionHoldTimer = this.explosionHoldDuration;
        this.rocketSubState = RocketSubState.ExplosionHold;
        this.holdOnExplosion(deltaTime);
        return;
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
            return;
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
            return;
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
              this.resetFollow();
              if (candidate) {
                this.acquire(candidate);
                this.applyRocketPose(deltaTime, true);
                return;
              }
              this.snapBehindBomber();
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
        return;
      }
    }

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

    this.tempVector1.set(desiredX, clampedFollowHeight, desiredZ);

    // Use a more performance-friendly smoothing approach
    // Instead of Vector3.Lerp which creates new objects, modify existing vectors
    const lerpFactor = Math.min(this.smoothing * deltaTime, 1.0); // Cap lerp factor
    const invLerpFactor = 1.0 - lerpFactor;

    // Manually interpolate to avoid object creation
    this.camera.position.x = this.camera.position.x * invLerpFactor + this.tempVector1.x * lerpFactor;
    this.camera.position.y = this.camera.position.y * invLerpFactor + this.tempVector1.y * lerpFactor;
    this.camera.position.z = this.camera.position.z * invLerpFactor + this.tempVector1.z * lerpFactor;

    // Always look at the bomber directly
    this.camera.setTarget(bomberPos);
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
      let bx = this.camera.position.x - missilePos.x;
      let bz = this.camera.position.z - missilePos.z;
      const b = Math.sqrt(bx * bx + bz * bz);
      if (b > 0.001) { bx /= b; bz /= b; } else { bx = 0; bz = 1; }
      ox = -bx * minHoriz; // camera = missile - offset*distance → negative pushes
      oz = -bz * minHoriz; // the camera toward the borrowed bearing
      oy = Math.sign(oy || 1) * Math.sqrt(1 - minHoriz * minHoriz);
    }

    this.tempVector1.set(
      missilePos.x - ox * this.missileChaseDistance,
      missilePos.y - oy * this.missileChaseDistance + this.missileChaseHeight,
      missilePos.z - oz * this.missileChaseDistance,
    );
    // Followed missiles fly near the rooftops at launch, so clamp against real
    // terrain, not just the world floor. Over unloaded chunks
    // getTerrainHeightAt returns 0 and the 10-unit floor still applies.
    const groundHeight = this.terrainManager.getTerrainHeightAt(this.tempVector1.x, this.tempVector1.z);
    this.tempVector1.y = Math.max(this.tempVector1.y, groundHeight + 5, 10);

    if (snap) {
      this.camera.position.copyFrom(this.tempVector1);
    } else {
      const lerpFactor = Math.min(posRate * deltaTime, 1.0);
      const invLerpFactor = 1.0 - lerpFactor;
      this.camera.position.x = this.camera.position.x * invLerpFactor + this.tempVector1.x * lerpFactor;
      this.camera.position.y = this.camera.position.y * invLerpFactor + this.tempVector1.y * lerpFactor;
      this.camera.position.z = this.camera.position.z * invLerpFactor + this.tempVector1.z * lerpFactor;
    }
    this.applySmoothedTarget(missilePos, deltaTime, snap);
  }

  /** True while Rocket View owns the camera — anchor-only follows have no missile. */
  private hasFollow(): boolean {
    return this.followedKind !== null;
  }

  /** Drop the current follow entirely; the next frame acquires or reverts. */
  private resetFollow(): void {
    this.followedMissile = null;
    this.followedKind = null;
    this.tomahawkTargetRef = null;
    this.rocketSubState = RocketSubState.None;
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
        this.beginLaunchFraming(candidate.missile); // captures the static pose + seeds smoothedTarget
        // The boost is straight up; seeding the heading vertical makes the dolly-in
        // borrow its azimuth from the camera position from the first frame.
        this.lastChaseDir.set(0, 1, 0);
      } else {
        this.rocketSubState = RocketSubState.IskanderChase;
        this.smoothedTarget.copyFrom(candidate.missile.getPositionRef());
        this.smoothedTargetValid = true;
      }
    } else if (candidate.kind === RocketViewKind.TomahawkBay) {
      // Belly cam on the bomber while the bay doors open; the look-at seeds at
      // the bay point so the first frame isn't aimed at a stale target.
      this.rocketSubState = RocketSubState.TomahawkBelly;
      const bomberPos = this.bomber.getPositionRef();
      const yaw = this.bomber.getRotationRef().y;
      this.smoothedTarget.set(
        bomberPos.x - Math.sin(yaw) * 3,
        bomberPos.y - 3,
        bomberPos.z - Math.cos(yaw) * 3,
      );
      this.smoothedTargetValid = true;
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
      this.smoothedTarget.copyFrom(candidate.missile.getPositionRef());
      this.smoothedTargetValid = true;
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
          this.camera.position.copyFrom(this.launchCamPos);
          this.applySmoothedTarget(this.launchLookAt, deltaTime, false);
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
    let dirX = this.camera.position.x - ax;
    let dirZ = this.camera.position.z - az;
    const dl = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (dl > 0.001) { dirX /= dl; dirZ /= dl; } else { dirX = 0; dirZ = 1; }
    this.launchCamPos.set(
      ax + dirX * this.DOWNSHOT_DIST,
      baseY + this.DOWNSHOT_HEIGHT,
      az + dirZ * this.DOWNSHOT_DIST,
    );
    const camGround = this.terrainManager.getTerrainHeightAt(this.launchCamPos.x, this.launchCamPos.z);
    this.launchCamPos.y = Math.max(this.launchCamPos.y, camGround + 5, 10);
    this.launchLookAt.set(ax, baseY + this.DOWNSHOT_LOOKAT_UP, az);
    // Seed the smoothed look-at so the first setTarget isn't aimed at the origin.
    this.smoothedTarget.copyFrom(this.launchLookAt);
    this.smoothedTargetValid = true;
  }

  /** Frame the down-shot at the missile's x,z — the launcher it is climbing off. */
  private beginLaunchFraming(missile: FollowableMissile): void {
    const iPos = missile.getPositionRef();
    this.beginLauncherDownShot(iPos.x, iPos.z);
  }

  /** Ease the camera's look-at toward a target instead of snapping it. */
  private applySmoothedTarget(target: Vector3, deltaTime: number, snap: boolean, rate: number = this.targetSmoothing): void {
    if (snap || !this.smoothedTargetValid) {
      this.smoothedTarget.copyFrom(target);
      this.smoothedTargetValid = true;
    } else {
      const lf = Math.min(rate * deltaTime, 1.0);
      const inv = 1.0 - lf;
      this.smoothedTarget.x = this.smoothedTarget.x * inv + target.x * lf;
      this.smoothedTarget.y = this.smoothedTarget.y * inv + target.y * lf;
      this.smoothedTarget.z = this.smoothedTarget.z * inv + target.z * lf;
    }
    this.camera.setTarget(this.smoothedTarget);
  }

  /**
   * Hold the static down-shot captured in beginLauncherDownShot. The pose is
   * constant, so the lerp settles within ~0.3s and the camera is then genuinely
   * still (smoothest). No missile needed — framing is anchored to the captured
   * launcher, so this drives the anchor-only IskanderPrelaunch dwell.
   */
  private updateLaunchFraming(deltaTime: number, snap: boolean): void {
    if (snap) {
      this.camera.position.copyFrom(this.launchCamPos);
    } else {
      const lerpFactor = Math.min(this.missileChaseSmoothing * deltaTime, 1.0);
      const invLerpFactor = 1.0 - lerpFactor;
      this.camera.position.x = this.camera.position.x * invLerpFactor + this.launchCamPos.x * lerpFactor;
      this.camera.position.y = this.camera.position.y * invLerpFactor + this.launchCamPos.y * lerpFactor;
      this.camera.position.z = this.camera.position.z * invLerpFactor + this.launchCamPos.z * lerpFactor;
    }
    this.applySmoothedTarget(this.launchLookAt, deltaTime, snap);
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

    this.tempVector1.set(
      bomberPos.x + rx * this.BELLY_SIDE - fx * this.BELLY_BACK,
      bomberPos.y - this.BELLY_DOWN,
      bomberPos.z + rz * this.BELLY_SIDE - fz * this.BELLY_BACK,
    );
    const groundHeight = this.terrainManager.getTerrainHeightAt(this.tempVector1.x, this.tempVector1.z);
    this.tempVector1.y = Math.max(this.tempVector1.y, groundHeight + 5, 10);

    if (snap) {
      this.camera.position.copyFrom(this.tempVector1);
    } else {
      const lerpFactor = Math.min(this.bellySmoothing * deltaTime, 1.0);
      const invLerpFactor = 1.0 - lerpFactor;
      this.camera.position.x = this.camera.position.x * invLerpFactor + this.tempVector1.x * lerpFactor;
      this.camera.position.y = this.camera.position.y * invLerpFactor + this.tempVector1.y * lerpFactor;
      this.camera.position.z = this.camera.position.z * invLerpFactor + this.tempVector1.z * lerpFactor;
    }

    let lookAt: Vector3;
    if (this.followedMissile) {
      lookAt = this.followedMissile.getPositionRef();
    } else {
      this.tempVector2.set(bomberPos.x - fx * 3, bomberPos.y - 3, bomberPos.z - fz * 3);
      lookAt = this.tempVector2;
    }
    this.applySmoothedTarget(lookAt, deltaTime, snap, this.bellyTargetSmoothing);
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
      bx = this.camera.position.x - pos.x;
      bz = this.camera.position.z - pos.z;
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

    this.tempVector1.set(
      m.x + b.x * this.TOMA_CHASE_BACK,
      m.y + this.TOMA_CHASE_UP,
      m.z + b.z * this.TOMA_CHASE_BACK,
    );
    const groundHeight = this.terrainManager.getTerrainHeightAt(this.tempVector1.x, this.tempVector1.z);
    this.tempVector1.y = Math.max(this.tempVector1.y, groundHeight + 5, 10);

    if (snap) {
      this.camera.position.copyFrom(this.tempVector1);
    } else {
      const lerpFactor = Math.min(this.tomaChaseSmoothing * deltaTime, 1.0);
      const invLerpFactor = 1.0 - lerpFactor;
      this.camera.position.x = this.camera.position.x * invLerpFactor + this.tempVector1.x * lerpFactor;
      this.camera.position.y = this.camera.position.y * invLerpFactor + this.tempVector1.y * lerpFactor;
      this.camera.position.z = this.camera.position.z * invLerpFactor + this.tempVector1.z * lerpFactor;
    }

    this.tempVector2.set(
      m.x + (tgt.x - m.x) * this.TOMA_LOOKAT_BLEND,
      m.y + (tgt.y - m.y) * this.TOMA_LOOKAT_BLEND,
      m.z + (tgt.z - m.z) * this.TOMA_LOOKAT_BLEND,
    );
    this.applySmoothedTarget(this.tempVector2, deltaTime, snap, this.tomaChaseTargetSmoothing);

    // Keep the hold seed live: at impact the ExplosionHold backs off along
    // -lastChaseDir — the same side of the blast the chase camera is already on.
    this.lastChaseDir.set(-b.x, 0, -b.z);
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
      let bx = this.camera.position.x - this.explosionPoint.x;
      let bz = this.camera.position.z - this.explosionPoint.z;
      const b = Math.sqrt(bx * bx + bz * bz);
      if (b > 0.001) { bx /= b; bz /= b; } else { bx = 0; bz = 1; }
      ox = -bx * minHoriz;
      oz = -bz * minHoriz;
      oy = Math.sign(oy || 1) * Math.sqrt(1 - minHoriz * minHoriz);
    }
    this.tempVector1.set(
      this.explosionPoint.x - ox * this.missileChaseDistance,
      this.explosionPoint.y - oy * this.missileChaseDistance + this.missileChaseHeight,
      this.explosionPoint.z - oz * this.missileChaseDistance,
    );
    const groundHeight = this.terrainManager.getTerrainHeightAt(this.tempVector1.x, this.tempVector1.z);
    this.tempVector1.y = Math.max(this.tempVector1.y, groundHeight + 5, 10);

    const lerpFactor = Math.min(this.missileChaseSmoothing * 0.5 * deltaTime, 1.0);
    const invLerpFactor = 1.0 - lerpFactor;
    this.camera.position.x = this.camera.position.x * invLerpFactor + this.tempVector1.x * lerpFactor;
    this.camera.position.y = this.camera.position.y * invLerpFactor + this.tempVector1.y * lerpFactor;
    this.camera.position.z = this.camera.position.z * invLerpFactor + this.tempVector1.z * lerpFactor;
    this.camera.setTarget(this.explosionPoint);
  }

  public setMissileProvider(provider: () => RocketViewCandidate | null): void {
    this.missileProvider = provider;
  }

  public setRocketViewEnabled(enabled: boolean): void {
    this.rocketViewEnabled = enabled;
    if (!enabled) {
      if (this.followedKind !== null) {
        this.resetFollow();
        this.explosionHoldTimer = 0;
        this.snapBehindBomber();
      }
    }
  }

  /** Instrumentation for tests: the current Rocket View sub-state name. */
  public getRocketSubState(): string {
    return RocketSubState[this.rocketSubState];
  }

  public isRocketViewEnabled(): boolean {
    return this.rocketViewEnabled;
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
