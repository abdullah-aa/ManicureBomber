import { Bomber } from '../entities/Bomber';
import { FreeCamera, Vector3 } from '@babylonjs/core';
import { InputManager } from './InputManager';
import { TerrainManager } from './TerrainManager';

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
  private zoomSpeed: number = 5;
  private showGroundCrosshairs: boolean = false;

  // Camera distance adjustment properties
  private minFollowDistance: number = 50;
  private maxFollowDistance: number = 500;
  private distanceSpeed: number = 100; // Units per second

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

  constructor(camera: FreeCamera, bomber: Bomber, terrainManager: TerrainManager) {
    this.camera = camera;
    this.bomber = bomber;
    this.terrainManager = terrainManager;

    // Store initial value for the snap-behind-bomber action
    this.initialFollowHeightOffset = this.followHeightOffset;
  }

  public update(deltaTime: number, inputManager: InputManager): void {
    // Camera adjustments are only allowed while the camera-control mode is active.
    // Otherwise a single-finger swipe steers the plane and the camera just follows.
    const isCameraMode = inputManager.getTouchCameraMode();

    // Handle zoom (driven by the two-finger pinch gesture via wheelDelta)
    const wheelDelta = inputManager.getWheelDelta();
    if (wheelDelta !== 0) {
      const zoomAmount = (wheelDelta / 100) * this.distanceSpeed;
      this.followDistance += zoomAmount;
      this.followDistance = Math.max(this.minFollowDistance, Math.min(this.maxFollowDistance, this.followDistance));
    }

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
   * offsets accumulated in camera mode. Zoom (followDistance) is a preference and
   * is deliberately kept. The per-frame smoothing lerp in update() turns this into
   * a smooth swing-back rather than a teleport.
   */
  public snapBehindBomber(): void {
    this.followHeightOffset = this.initialFollowHeightOffset;
    this.panAngleOffset = 0;
    this.trigCacheValid = false;
  }
}
