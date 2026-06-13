import { Bomber } from '../entities/Bomber';
import { FreeCamera, Vector3 } from '@babylonjs/core';
import { InputManager } from './InputManager';
import { TerrainManager } from './TerrainManager';

/**
 * Minimal surface a missile must expose for Rocket View to chase it.
 * IskanderMissile and DefenseMissile satisfy this structurally. Only the
 * Iskander implements isClimbing(); for defense missiles it is undefined and
 * treated as not-climbing.
 */
export interface FollowableMissile {
  getPositionRef(): Vector3;
  getVelocityRef(): Vector3;
  hasExploded(): boolean;
  isClimbing?(): boolean;
}

export enum RocketViewKind {
  Iskander,
  Defense,
}

/** What the provider hands the camera each pull: the missile plus its class. */
export interface RocketViewCandidate {
  missile: FollowableMissile;
  kind: RocketViewKind;
}

/**
 * Rocket View camera sub-states. None falls through to the bomber chase (the
 * revert view). See the priority/transition rules in update().
 */
enum RocketSubState {
  None,
  IskanderLaunch,
  IskanderChase,
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
          this.followedMissile = null;
          this.followedKind = null;
          this.rocketSubState = RocketSubState.None;
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
        if (!this.followedMissile) {
          // Acquire a fresh target (provider only returns about-to-launch defense
          // missiles, so we never snap onto one already mid-flight).
          const candidate = this.missileProvider();
          if (candidate) {
            this.acquire(candidate);
            // Teleport to the pose instead of lerping across the map, then lerp.
            this.applyRocketPose(deltaTime, true);
            return;
          }
        } else if (this.followedKind === RocketViewKind.Defense) {
          // A live Iskander outranks an in-progress defense follow — preempt it.
          const candidate = this.missileProvider();
          if (
            candidate &&
            candidate.kind === RocketViewKind.Iskander &&
            candidate.missile !== this.followedMissile
          ) {
            this.acquire(candidate);
            this.applyRocketPose(deltaTime, true);
            return;
          }
        }
      }

      if (this.followedMissile) {
        // Hand off from launch framing to the chase once the Iskander tops out.
        if (
          this.rocketSubState === RocketSubState.IskanderLaunch &&
          this.followedMissile.isClimbing?.() === false
        ) {
          this.rocketSubState = RocketSubState.IskanderChase;
          // Seed the chase heading to the current (vertical) velocity so the heading
          // slew eases from straight-up rather than from a stale direction.
          const v = this.followedMissile.getVelocityRef();
          if (v.lengthSquared() > 25) {
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

  /** Record a freshly acquired (or preempted) target and pick the sub-state. */
  private acquire(candidate: RocketViewCandidate): void {
    this.followedMissile = candidate.missile;
    this.followedKind = candidate.kind;
    if (candidate.kind === RocketViewKind.Iskander && candidate.missile.isClimbing?.()) {
      this.rocketSubState = RocketSubState.IskanderLaunch;
      this.beginLaunchFraming(candidate.missile); // captures the static pose + seeds smoothedTarget
    } else if (candidate.kind === RocketViewKind.Iskander) {
      this.rocketSubState = RocketSubState.IskanderChase;
      this.smoothedTarget.copyFrom(candidate.missile.getPositionRef());
      this.smoothedTargetValid = true;
    } else {
      this.rocketSubState = RocketSubState.DefenseFollow;
      this.smoothedTarget.copyFrom(candidate.missile.getPositionRef());
      this.smoothedTargetValid = true;
    }
  }

  /** Dispatch the per-frame pose for the current sub-state. */
  private applyRocketPose(deltaTime: number, snap: boolean): void {
    if (!this.followedMissile) return;
    if (this.rocketSubState === RocketSubState.IskanderLaunch) {
      this.updateLaunchFraming(this.followedMissile, deltaTime, snap);
    } else {
      this.updateMissileChase(this.followedMissile, deltaTime, snap);
    }
  }

  /**
   * Capture the static wide establishing shot for an Iskander launch, ONCE when
   * IskanderLaunch begins. The launch column is at the missile's frozen x,z (it
   * climbs straight up) with its base at terrain height and apex at LAUNCH_APEX_Y.
   * The camera is placed far enough to fit the whole column vertically in the FOV,
   * on a bomber-free bearing taken from where the camera already is. No per-frame
   * recompute — the pose is held static for the entire climb.
   */
  private beginLaunchFraming(missile: FollowableMissile): void {
    const iPos = missile.getPositionRef();
    const ax = iPos.x, az = iPos.z; // frozen during the vertical climb
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

  /** Ease the camera's look-at toward a target instead of snapping it. */
  private applySmoothedTarget(target: Vector3, deltaTime: number, snap: boolean): void {
    if (snap || !this.smoothedTargetValid) {
      this.smoothedTarget.copyFrom(target);
      this.smoothedTargetValid = true;
    } else {
      const lf = Math.min(this.targetSmoothing * deltaTime, 1.0);
      const inv = 1.0 - lf;
      this.smoothedTarget.x = this.smoothedTarget.x * inv + target.x * lf;
      this.smoothedTarget.y = this.smoothedTarget.y * inv + target.y * lf;
      this.smoothedTarget.z = this.smoothedTarget.z * inv + target.z * lf;
    }
    this.camera.setTarget(this.smoothedTarget);
  }

  /**
   * Hold the static wide establishing shot captured in beginLaunchFraming: a fixed
   * side-on view that contains the whole launch column so the launcher and the rising
   * missile both stay framed for the entire vertical climb. The pose is constant, so
   * the lerp settles within ~0.3s and the camera is then genuinely still (smoothest).
   * The missile param is unused — framing is anchored to the captured launch column.
   */
  private updateLaunchFraming(_missile: FollowableMissile, deltaTime: number, snap: boolean): void {
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
    if (!enabled && this.followedMissile) {
      this.followedMissile = null;
      this.followedKind = null;
      this.rocketSubState = RocketSubState.None;
      this.explosionHoldTimer = 0;
      this.snapBehindBomber();
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
