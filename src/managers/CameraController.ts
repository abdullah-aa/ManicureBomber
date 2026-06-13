import { Bomber } from '../entities/Bomber';
import { FreeCamera, Vector3 } from '@babylonjs/core';
import { InputManager } from './InputManager';
import { TerrainManager } from './TerrainManager';

/**
 * Minimal surface a missile must expose for Rocket View to chase it.
 * IskanderMissile and DefenseMissile satisfy this structurally.
 */
export interface FollowableMissile {
  getPositionRef(): Vector3;
  getVelocityRef(): Vector3;
  hasExploded(): boolean;
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

  // Rocket View: while enabled, chase the missile supplied by the provider instead of
  // the bomber. Lock-until-explosion: acquisition only runs when nothing is followed.
  private rocketViewEnabled: boolean = false;
  private followedMissile: FollowableMissile | null = null;
  private missileProvider: (() => FollowableMissile | null) | null = null;
  // Missiles are ~5 units long (vs the bomber's 200-unit follow distance), and they
  // maneuver hard — sit close behind and track stiffly.
  private missileChaseDistance: number = 30;
  private missileChaseHeight: number = 10;
  private missileChaseSmoothing: number = 5.0;
  // Heading fallback for any near-zero-velocity frame (e.g. the instant of acquisition).
  private lastChaseDir: Vector3 = new Vector3(0, 0, 1);

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
    if (this.followedMissile && this.followedMissile.hasExploded()) {
      // Release on the explosion frame — safely before the dispose sweeps.
      this.followedMissile = null;
      this.snapBehindBomber();
    }
    if (this.rocketViewEnabled && !this.followedMissile && this.missileProvider) {
      this.followedMissile = this.missileProvider();
      if (this.followedMissile) {
        // The missile may be far away; teleport to the chase pose instead of
        // lerping the camera across the map, then let the lerp take over.
        this.updateMissileChase(this.followedMissile, deltaTime, true);
        return;
      }
    }
    if (this.followedMissile) {
      // Locked chase: free-look drags are intentionally ignored while following.
      this.updateMissileChase(this.followedMissile, deltaTime, false);
      return;
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

  public setMissileProvider(provider: () => FollowableMissile | null): void {
    this.missileProvider = provider;
  }

  public setRocketViewEnabled(enabled: boolean): void {
    this.rocketViewEnabled = enabled;
    if (!enabled && this.followedMissile) {
      this.followedMissile = null;
      this.snapBehindBomber();
    }
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
