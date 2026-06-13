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
  private tempVector2: Vector3 = new Vector3(); // look-at target for launch framing

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
  // Launch framing (favor the Iskander launch site, bomber at the frame edge). TUNABLE.
  private launchFramingSide: number = 1; // which side of the launch the camera sits (fixed per acquisition)
  private readonly launchFramingDistance: number = 90;
  private readonly launchFramingHeight: number = 25;
  // How far the look-at slides from the iskander toward the bomber. Small, because the
  // iskander is close and the bomber far: a little shift swings the bomber to the frame
  // edge while keeping the rising rocket dominant. TUNABLE (playtest).
  private readonly launchFramingBomberBias: number = 0.08;

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
    // (speed > 5 u/s); otherwise keep the last known direction.
    if (velocity.lengthSquared() > 25) {
      this.lastChaseDir.copyFrom(velocity).normalize();
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
    this.camera.setTarget(missilePos);
  }

  /** Record a freshly acquired (or preempted) target and pick the sub-state. */
  private acquire(candidate: RocketViewCandidate): void {
    this.followedMissile = candidate.missile;
    this.followedKind = candidate.kind;
    if (candidate.kind === RocketViewKind.Iskander && candidate.missile.isClimbing?.()) {
      this.rocketSubState = RocketSubState.IskanderLaunch;
      this.chooseLaunchFramingSide(candidate.missile);
    } else if (candidate.kind === RocketViewKind.Iskander) {
      this.rocketSubState = RocketSubState.IskanderChase;
    } else {
      this.rocketSubState = RocketSubState.DefenseFollow;
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
   * Pick which side of the launch axis the camera sits on, once per acquisition,
   * based on where the camera already is — so it doesn't flip sides mid-launch.
   */
  private chooseLaunchFramingSide(missile: FollowableMissile): void {
    const iPos = missile.getPositionRef();
    const bPos = this.bomber.getPositionRef();
    let nx = bPos.x - iPos.x, nz = bPos.z - iPos.z;
    const d = Math.sqrt(nx * nx + nz * nz);
    if (d > 0.001) { nx /= d; nz /= d; } else { nx = 0; nz = 1; }
    const px = -nz, pz = nx; // perpendicular bearing
    const cx = this.camera.position.x - iPos.x;
    const cz = this.camera.position.z - iPos.z;
    this.launchFramingSide = cx * px + cz * pz >= 0 ? 1 : -1;
  }

  /**
   * "Favor the launch" framing: sit behind-and-to-one-side of the Iskander launch
   * site so the rising rocket dominates the frame, looking mostly at the Iskander
   * with a small bias toward the bomber so the bomber sits near the frame edge.
   * Allocation-free (reuses tempVector1 for position, tempVector2 for look-at).
   */
  private updateLaunchFraming(missile: FollowableMissile, deltaTime: number, snap: boolean): void {
    const iPos = missile.getPositionRef();
    const bPos = this.bomber.getPositionRef();
    // Horizontal bearing iskander → bomber.
    let nx = bPos.x - iPos.x, nz = bPos.z - iPos.z;
    const d = Math.sqrt(nx * nx + nz * nz);
    if (d > 0.001) { nx /= d; nz /= d; } else { nx = 0; nz = 1; }
    const px = -nz, pz = nx; // perpendicular → side-on view of the liftoff
    // Blend "behind the launch" with a sideways kick so the rocket is foreground.
    let cdx = -nx * 0.7 + px * this.launchFramingSide * 0.7;
    let cdz = -nz * 0.7 + pz * this.launchFramingSide * 0.7;
    const cl = Math.sqrt(cdx * cdx + cdz * cdz);
    if (cl > 0.001) { cdx /= cl; cdz /= cl; } else { cdx = 0; cdz = 1; }

    this.tempVector1.set(
      iPos.x + cdx * this.launchFramingDistance,
      iPos.y + this.launchFramingHeight,
      iPos.z + cdz * this.launchFramingDistance,
    );
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

    // Look mostly at the iskander, nudged toward the bomber so it sits near the edge.
    const t = this.launchFramingBomberBias;
    this.tempVector2.set(
      iPos.x + (bPos.x - iPos.x) * t,
      iPos.y + (bPos.y - iPos.y) * t,
      iPos.z + (bPos.z - iPos.z) * t,
    );
    this.camera.setTarget(this.tempVector2);
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
