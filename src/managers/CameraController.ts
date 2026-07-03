import { Bomber } from '../entities/Bomber';
import { FreeCamera, Vector3 } from '@babylonjs/core';
import { InputManager } from './InputManager';
import { TerrainManager } from './TerrainManager';
import { TomahawkLoopFraming } from '../workers/worker-utils';

/**
 * Minimal surface a missile must expose for Rocket View to chase it.
 * IskanderMissile and DefenseMissile satisfy this structurally. Only the
 * Iskander implements isClimbing(); only the Tomahawk implements
 * isInLaunchPhase(); where undefined they are treated as false.
 */
export interface FollowableMissile {
  getPositionRef(): Vector3;
  getVelocityRef(): Vector3;
  hasExploded(): boolean;
  isClimbing?(): boolean;
  isInLaunchPhase?(): boolean;
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
  TomahawkMaster,      // Beat 2: wide master shot framing both loops + target
  TomahawkZoom,        // Beat 3: same pose, FOV zooms onto the target for the dive
  DefensePad,          // frame the launcher pad until the trajectory solve arrives
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
  // Launch framing: a wide STATIC establishing shot capturing the whole vertical launch
  // column (launcher base → climb apex) so both stay in frame the entire climb. Captured
  // once when IskanderLaunch begins; no bomber reference. TUNABLE.
  private readonly LAUNCH_APEX_Y = 90;             // mirrors IskanderMissile.CLIMB_ALTITUDE
  private readonly LAUNCH_MIN_EXTENT = 45;         // floor on column height for the distance calc
  private readonly LAUNCH_V_MARGIN = 12;           // world-unit padding above apex / below base
  private readonly LAUNCH_MIN_DIST = 55;
  private readonly LAUNCH_MAX_DIST = 140;          // fits (90/2+12)/tan(0.4)=134.8
  private readonly LAUNCH_HALF_VFOV_TAN = 0.42279; // tan(0.4) — Babylon default 0.8rad vertical FOV
  private launchCamPos: Vector3 = new Vector3();   // captured static camera pose (reused)
  private launchLookAt: Vector3 = new Vector3();   // captured static look-at (reused)
  // Column anchor x/z captured by beginColumnFraming — compared against the provider's
  // anchor each frame during IskanderPrelaunch so a swapped launcher re-frames.
  private columnAnchorX: number = 0;
  private columnAnchorZ: number = 0;
  // Tomahawk cinematic: Beat 1 is a stiff belly cam riding with the bomber while the bay
  // doors open and the missile drops; Beat 2 sweeps to a FIXED wide master shot framing
  // both loops + target; Beat 3 keeps the pose and FOV-zooms onto the target for the
  // terminal dive; the shared ExplosionHold then falls close for the kill. TUNABLE.
  // Belly pose — bomber-local offsets: beside, below and behind the bomb bay.
  private readonly BELLY_SIDE = 8;
  private readonly BELLY_DOWN = 12;
  private readonly BELLY_BACK = 18;
  private readonly bellySmoothing = 10.0;          // stiff — the pose tracks a moving bomber
  private readonly bellyTargetSmoothing = 8.0;
  // Master pose — placed above-and-behind the loop start; offsets scale with the loop→target
  // span so near and far targets both frame. See beginTomahawkMaster.
  private readonly TOMA_LOCK_BACK_K = 0.5;         // pull back behind loop-start by this * span
  private readonly TOMA_LOCK_UP_K = 0.55;          // raise above cruise altitude by this * span
  private readonly TOMA_LOCK_SIDE_K = 1.2;         // lateral offset in loop-radius units (sign TUNABLE)
  private readonly TOMA_LOCK_LOOK_BIAS = 0.45;     // look-at: 0 = loop center, 1 = target
  private readonly masterTransitionSmoothing = 1.5; // slow position lerp = the Beat 1→2 sweep (~2s)
  private readonly masterTargetSmoothing = 2.0;
  // Zoom — FOV narrows once the missile is inside the trigger radius of the target
  // (mirrors the guidance terminal flip) and restores on every exit path (see updateFov).
  private readonly TOMA_ZOOM_FOV = 0.3;
  private readonly TOMA_ZOOM_TRIGGER_DIST_SQ = 300 * 300;
  // Proximity alone can't gate the zoom: the bomber only fires within its 300u
  // acquisition range, so the missile is already "close" when the master shot
  // starts. The loops fly AT cruise altitude — only the terminal dive descends —
  // so also require the missile to be meaningfully below cruise.
  private readonly TOMA_ZOOM_DIVE_DROP = 20;
  private tomahawkCruiseAlt = 0; // cruise altitude of the followed Tomahawk's path
  private readonly fovZoomRate = 2.0;
  private readonly fovRestoreRate = 2.5;
  private readonly defaultFov: number;             // captured from the camera at construction
  private tomahawkCamPos: Vector3 = new Vector3(); // captured static camera pose (reused)
  private tomahawkLookAt: Vector3 = new Vector3(); // locked look-at (reused)
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
    // The FOV zoom always restores to whatever the camera started with (Babylon default 0.8).
    this.defaultFov = camera.fov;

    // Store initial value for the snap-behind-bomber action
    this.initialFollowHeightOffset = this.followHeightOffset;
  }

  public update(deltaTime: number, inputManager: InputManager): void {
    // FOV runs first, every frame, all modes — so every exit path out of the
    // Tomahawk zoom (hold, preemption, revert to bomber chase) self-heals.
    this.updateFov(deltaTime);

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
                this.beginColumnFraming(candidate.anchorX, candidate.anchorZ);
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
        // Hand off from launch framing to the chase once the Iskander tops out.
        if (
          this.rocketSubState === RocketSubState.IskanderLaunch &&
          followed &&
          followed.isClimbing?.() === false
        ) {
          this.rocketSubState = RocketSubState.IskanderChase;
          // Seed the chase heading to the current (vertical) velocity so the heading
          // slew eases from straight-up rather than from a stale direction.
          const v = followed.getVelocityRef();
          if (v.lengthSquared() > 25) {
            const vl = v.length();
            this.lastChaseDir.set(v.x / vl, v.y / vl, v.z / vl);
          }
        } else if (
          this.rocketSubState === RocketSubState.TomahawkBelly &&
          followed &&
          followed.isInLaunchPhase?.() === false
        ) {
          // Beat 1 → Beat 2: the drop is done; sweep to the wide master shot.
          // seedTarget=false so the look-at lerps off the missile instead of cutting.
          this.rocketSubState = RocketSubState.TomahawkMaster;
          this.beginTomahawkMaster(followed, false);
        } else if (this.rocketSubState === RocketSubState.TomahawkMaster && followed && this.tomahawkTargetRef) {
          // Beat 2 → Beat 3: FOV zoom once the missile enters its terminal dive.
          const p = followed.getPositionRef();
          const dx = p.x - this.tomahawkTargetRef.x;
          const dy = p.y - this.tomahawkTargetRef.y;
          const dz = p.z - this.tomahawkTargetRef.z;
          if (
            dx * dx + dy * dy + dz * dz < this.TOMA_ZOOM_TRIGGER_DIST_SQ &&
            p.y < this.tomahawkCruiseAlt - this.TOMA_ZOOM_DIVE_DROP
          ) {
            this.rocketSubState = RocketSubState.TomahawkZoom;
            // Retarget the pan onto the impact point; the pose itself never moves.
            this.tomahawkLookAt.copyFrom(this.tomahawkTargetRef);
          }
        } else if (this.rocketSubState === RocketSubState.DefensePad && followed) {
          // The async trajectory solve landed and the missile is off the pad.
          const v = followed.getVelocityRef();
          if (v.lengthSquared() > 1) {
            this.rocketSubState = RocketSubState.DefenseFollow;
            const vl = v.length();
            this.lastChaseDir.set(v.x / vl, v.y / vl, v.z / vl);
          }
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

  private updateMissileChase(missile: FollowableMissile, deltaTime: number, snap: boolean): void {
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
      const lerpFactor = Math.min(this.missileChaseSmoothing * deltaTime, 1.0);
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

  /**
   * Ease the FOV toward the sub-state's goal: narrowed during the Tomahawk zoom,
   * the native FOV everywhere else. Runs unconditionally every frame so every
   * exit path out of the zoom (hold, preemption, revert, toggle) un-zooms itself.
   */
  private updateFov(deltaTime: number): void {
    const goal = this.rocketSubState === RocketSubState.TomahawkZoom ? this.TOMA_ZOOM_FOV : this.defaultFov;
    const f = this.camera.fov;
    if (Math.abs(f - goal) < 0.0005) {
      if (f !== goal) this.camera.fov = goal;
      return;
    }
    const rate = goal < f ? this.fovZoomRate : this.fovRestoreRate;
    this.camera.fov = f + (goal - f) * Math.min(rate * deltaTime, 1.0);
  }

  /** Record a freshly acquired (or preempted) target and pick the sub-state. */
  private acquire(candidate: RocketViewCandidate): void {
    this.followedMissile = candidate.missile;
    this.followedKind = candidate.kind;
    // Acquisition is a hard cut, so a preempted mid-zoom Tomahawk must not bleed
    // its narrowed FOV into the new shot.
    this.camera.fov = this.defaultFov;
    if (candidate.kind === RocketViewKind.IskanderPrelaunch) {
      // Dwell on the pre-selected launcher: the same column framing the launch
      // uses, so the later prelaunch→launch preemption lands where we already are.
      this.rocketSubState = RocketSubState.IskanderPrelaunch;
      this.beginColumnFraming(candidate.anchorX, candidate.anchorZ);
    } else if (candidate.kind === RocketViewKind.Iskander && candidate.missile) {
      if (candidate.missile.isClimbing?.()) {
        this.rocketSubState = RocketSubState.IskanderLaunch;
        this.beginLaunchFraming(candidate.missile); // captures the static pose + seeds smoothedTarget
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
        // Keep the belly cam through the drop; the master pose is computed at the
        // Beat 1→2 transition, not here.
        this.rocketSubState = RocketSubState.TomahawkBelly;
      } else {
        // Defensive: acquired outside the launch window — go straight to the master shot.
        this.rocketSubState = RocketSubState.TomahawkMaster;
        this.beginTomahawkMaster(candidate.missile); // computes the pose + seeds smoothedTarget
      }
    } else if (candidate.missile) {
      if (candidate.missile.getVelocityRef().lengthSquared() < 1) {
        // On-pad (velocity still zero awaiting the trajectory solve): frame the
        // pad like a launch column instead of chasing from a stale heading.
        this.rocketSubState = RocketSubState.DefensePad;
        const p = candidate.missile.getPositionRef();
        this.beginColumnFraming(p.x, p.z);
      } else {
        this.rocketSubState = RocketSubState.DefenseFollow;
        this.smoothedTarget.copyFrom(candidate.missile.getPositionRef());
        this.smoothedTargetValid = true;
      }
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
   * (IskanderPrelaunch, DefensePad column framing, missile-less TomahawkBelly)
   * work without a followed missile.
   */
  private applyRocketPose(deltaTime: number, snap: boolean): void {
    switch (this.rocketSubState) {
      case RocketSubState.IskanderPrelaunch:
      case RocketSubState.IskanderLaunch:
      case RocketSubState.DefensePad:
        this.updateLaunchFraming(deltaTime, snap);
        break;
      case RocketSubState.TomahawkBelly:
        this.updateTomahawkBelly(deltaTime, snap);
        break;
      case RocketSubState.TomahawkMaster:
      case RocketSubState.TomahawkZoom:
        // The zoom keeps the master pose; only the FOV goal and look-at differ.
        this.updateTomahawkMaster(deltaTime, snap);
        break;
      default:
        // IskanderChase and DefenseFollow share the chase machinery.
        if (this.followedMissile) {
          this.updateMissileChase(this.followedMissile, deltaTime, snap);
        }
    }
  }

  /**
   * Capture the static wide establishing shot for a launch column, ONCE when the
   * framing state begins (Iskander prelaunch dwell, Iskander launch, defense pad).
   * The column sits at the anchor x,z with its base at terrain height and apex at
   * LAUNCH_APEX_Y. The camera is placed far enough to fit the whole column
   * vertically in the FOV, on a bomber-free bearing taken from where the camera
   * already is. No per-frame recompute — the pose is held static. Because the
   * missile spawns at the same x,z the prelaunch dwelled on, re-running this at
   * launch reproduces ~the settled pose and the handoff is seamless.
   */
  private beginColumnFraming(ax: number, az: number): void {
    this.columnAnchorX = ax;
    this.columnAnchorZ = az;
    const baseY = this.terrainManager.getTerrainHeightAt(ax, az); // 0 over unloaded chunks — fine
    const columnMidY = (baseY + this.LAUNCH_APEX_Y) * 0.5;
    const extent = Math.max(this.LAUNCH_APEX_Y - baseY, this.LAUNCH_MIN_EXTENT);
    // Fit half the column (+ margin) within the vertical half-FOV at distance D.
    let dist = (extent * 0.5 + this.LAUNCH_V_MARGIN) / this.LAUNCH_HALF_VFOV_TAN;
    dist = Math.max(this.LAUNCH_MIN_DIST, Math.min(this.LAUNCH_MAX_DIST, dist));
    // Bomber-free bearing: horizontal direction from the column to the current camera,
    // so the establishing cut doesn't swing far. Fallback to +Z if degenerate.
    let dirX = this.camera.position.x - ax;
    let dirZ = this.camera.position.z - az;
    const dl = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (dl > 0.001) { dirX /= dl; dirZ /= dl; } else { dirX = 0; dirZ = 1; }
    this.launchCamPos.set(ax + dirX * dist, columnMidY, az + dirZ * dist);
    const camGround = this.terrainManager.getTerrainHeightAt(this.launchCamPos.x, this.launchCamPos.z);
    this.launchCamPos.y = Math.max(this.launchCamPos.y, camGround + 5, 10);
    this.launchLookAt.set(ax, columnMidY, az);
    // Seed the smoothed look-at so the first setTarget isn't aimed at the origin.
    this.smoothedTarget.copyFrom(this.launchLookAt);
    this.smoothedTargetValid = true;
  }

  /** Frame the launch column at the missile's x,z (frozen during the vertical climb). */
  private beginLaunchFraming(missile: FollowableMissile): void {
    const iPos = missile.getPositionRef();
    this.beginColumnFraming(iPos.x, iPos.z);
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
   * Hold the static wide establishing shot captured in beginColumnFraming: a fixed
   * side-on view that contains the whole launch column so the launcher and the rising
   * missile both stay framed for the entire vertical climb. The pose is constant, so
   * the lerp settles within ~0.3s and the camera is then genuinely still (smoothest).
   * No missile needed — framing is anchored to the captured column, so this also
   * drives the anchor-only IskanderPrelaunch dwell and the DefensePad wait.
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
   * Beat 2: plant the fixed master shot — a pose high above-and-behind the loop start, angled so
   * the full loop excursions AND the distant target stay framed. Offsets scale with the
   * loop→target span (padded by both loop excursions) so near and far targets both fit. The
   * look-at is biased between the loop center and the target. Also aims lastChaseDir down the
   * flight axis so the later ExplosionHold sits behind the approach. Falls back to a
   * launch→target plant if the loop framing isn't available (it is computed synchronously at
   * construction, so this is rare). seedTarget=false makes the look-at lerp from wherever the
   * smoother currently points (the Beat 1→2 sweep) instead of hard-cutting.
   */
  private beginTomahawkMaster(missile: FollowableMissile, seedTarget: boolean = true): void {
    const m = missile as unknown as {
      getLoopFraming(): TomahawkLoopFraming | null;
      getTargetPosition(): Vector3;
    };
    const f = m.getLoopFraming();
    this.tomahawkTargetRef = m.getTargetPosition();
    // Fallback (no framing): treat the current altitude as cruise so the dive
    // check still keys off a real descent.
    this.tomahawkCruiseAlt = f ? f.cruiseAltitude : missile.getPositionRef().y;

    if (f) {
      const ls = f.loopStart, lc = f.loopCenter, tgt = f.target;
      // Horizontal axis loop-start → target.
      let ax = tgt.x - ls.x, az = tgt.z - ls.z;
      const run = Math.sqrt(ax * ax + az * az);
      if (run > 0.001) { ax /= run; az /= run; } else { ax = 0; az = 1; }
      const px = -az, pz = ax; // lateral for the 3/4 angle
      // Loop 1 extends ±R beyond the run's ends (loop 2 is 0.7R inside it), so pad
      // the span by a full loop excursion on each side.
      const span = run + 2 * f.loopRadius;

      this.tomahawkCamPos.set(
        ls.x - ax * (span * this.TOMA_LOCK_BACK_K) + px * (f.loopRadius * this.TOMA_LOCK_SIDE_K),
        f.cruiseAltitude + span * this.TOMA_LOCK_UP_K,
        ls.z - az * (span * this.TOMA_LOCK_BACK_K) + pz * (f.loopRadius * this.TOMA_LOCK_SIDE_K),
      );
      this.tomahawkLookAt.set(
        lc.x + (tgt.x - lc.x) * this.TOMA_LOCK_LOOK_BIAS,
        f.cruiseAltitude * 0.5,
        lc.z + (tgt.z - lc.z) * this.TOMA_LOCK_LOOK_BIAS,
      );
      this.lastChaseDir.set(ax, 0, az);
    } else {
      // Fallback: anchor a raised plant behind the missile along the launch→target bearing.
      const pos = missile.getPositionRef();
      const target = m.getTargetPosition();
      let ax = target.x - pos.x, az = target.z - pos.z;
      const run = Math.sqrt(ax * ax + az * az);
      if (run > 0.001) { ax /= run; az /= run; } else { ax = 0; az = 1; }
      this.tomahawkCamPos.set(pos.x - ax * 80, pos.y + 120, pos.z - az * 80);
      this.tomahawkLookAt.copyFrom(target);
      this.lastChaseDir.set(ax, 0, az);
    }

    const camGround = this.terrainManager.getTerrainHeightAt(this.tomahawkCamPos.x, this.tomahawkCamPos.z);
    this.tomahawkCamPos.y = Math.max(this.tomahawkCamPos.y, camGround + 5, 10);

    if (seedTarget) {
      this.smoothedTarget.copyFrom(this.tomahawkLookAt);
      this.smoothedTargetValid = true;
    }
  }

  /**
   * Hold the fixed pose captured in beginTomahawkMaster: the slow position lerp IS the
   * cinematic Beat 1→2 sweep, after which the camera is genuinely still with the loops +
   * target framed. TomahawkZoom reuses this pose unchanged — only the FOV (updateFov) and
   * the look-at (retargeted to the impact point at zoom entry) differ. The shared
   * ExplosionHold takes over for the kill.
   */
  private updateTomahawkMaster(deltaTime: number, snap: boolean): void {
    if (snap) {
      this.camera.position.copyFrom(this.tomahawkCamPos);
    } else {
      const lerpFactor = Math.min(this.masterTransitionSmoothing * deltaTime, 1.0);
      const invLerpFactor = 1.0 - lerpFactor;
      this.camera.position.x = this.camera.position.x * invLerpFactor + this.tomahawkCamPos.x * lerpFactor;
      this.camera.position.y = this.camera.position.y * invLerpFactor + this.tomahawkCamPos.y * lerpFactor;
      this.camera.position.z = this.camera.position.z * invLerpFactor + this.tomahawkCamPos.z * lerpFactor;
    }
    this.applySmoothedTarget(this.tomahawkLookAt, deltaTime, snap, this.masterTargetSmoothing);
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
      // Backstop: game-over and AI-off can land here mid-zoom, after which the
      // camera may never update again — never leave a narrowed FOV behind.
      this.camera.fov = this.defaultFov;
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
