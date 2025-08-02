import { Bomber } from '../entities/Bomber';
import { FreeCamera, Vector3 } from '@babylonjs/core';
import { InputManager } from './InputManager';


export class CameraController {
  private camera: FreeCamera;
  private bomber: Bomber;
  private followDistance: number = 200;
  private followHeight: number = 280;
  private smoothing: number = 2.0;
  private minFollowHeight: number = 20;
  private maxFollowHeight: number = 500;
  private zoomSpeed: number = 5;
  private showGroundCrosshairs: boolean = false;

  // Camera distance adjustment properties
  private minFollowDistance: number = 50;
  private maxFollowDistance: number = 500;
  private distanceSpeed: number = 100; // Units per second

  // Initial camera state for reset functionality
  private initialFollowDistance: number = 200;
  private initialFollowHeight: number = 320;

  // Camera panning properties
  private panSpeed: number = 1.5; // Radians per second for angular panning
  private panAngleOffset: number = 0; // Current angular offset from normal position (no limits)

  // Reset cooldown to prevent rapid resets
  private lastResetTime: number = 0;
  private resetCooldown: number = 0.5; // 500ms cooldown

  // Performance optimization: reuse Vector3 objects to reduce GC pressure
  private tempVector1: Vector3 = new Vector3();

  // Cache trigonometric calculations to avoid repeated computations
  private lastEffectiveRotation: number = 0;
  private cachedSin: number = 0;
  private cachedCos: number = 0;
  private trigCacheValid: boolean = false;

  constructor(camera: FreeCamera, bomber: Bomber) {
    this.camera = camera;
    this.bomber = bomber;

    // Store initial values for reset functionality
    this.initialFollowDistance = this.followDistance;
    this.initialFollowHeight = this.followHeight;
  }

  public update(deltaTime: number, inputManager: InputManager): void {
    const currentTime = performance.now() / 1000;

    // Handle camera reset with 1 key
    if (inputManager.isCameraResetPressed()) {
      this.resetCamera(currentTime);
    }

    // Handle camera panning with Q and E keys
    if (inputManager.isCameraPanLeftPressed()) {
      // Pan camera left (negative X direction)
      this.panAngleOffset -= this.panSpeed * deltaTime;
      this.trigCacheValid = false; // Invalidate cache when panning
    }
    if (inputManager.isCameraPanRightPressed()) {
      // Pan camera right (positive X direction)
      this.panAngleOffset += this.panSpeed * deltaTime;
      this.trigCacheValid = false; // Invalidate cache when panning
    }

    // Handle camera pitch adjustment with R and F keys
    if (inputManager.isPitchUpPressed()) {
      this.followHeight += this.zoomSpeed * deltaTime * 60; // R raises camera
      this.followHeight = Math.min(this.maxFollowHeight, this.followHeight);
    }
    if (inputManager.isPitchDownPressed()) {
      this.followHeight -= this.zoomSpeed * deltaTime * 60; // F lowers camera
      this.followHeight = Math.max(this.minFollowHeight, this.followHeight);
    }

    // Handle camera zoom with 3 and 4 keys
    if (inputManager.isCameraZoomInPressed()) {
      this.followDistance -= this.distanceSpeed * deltaTime; // 3 decreases distance (zoom in)
      this.followDistance = Math.max(this.minFollowDistance, this.followDistance);
    }
    if (inputManager.isCameraZoomOutPressed()) {
      this.followDistance += this.distanceSpeed * deltaTime; // 4 increases distance (zoom out)
      this.followDistance = Math.min(this.maxFollowDistance, this.followDistance);
    }

    // Handle scroll wheel zoom
    const wheelDelta = inputManager.getWheelDelta();
    if (wheelDelta !== 0) {
      const zoomAmount = (wheelDelta / 100) * this.distanceSpeed;
      this.followDistance += zoomAmount;
      this.followDistance = Math.max(this.minFollowDistance, Math.min(this.maxFollowDistance, this.followDistance));
    }

    // Handle mouse controls - similar to keyboard but with mouse delta
    if (inputManager.getIsMouseDragging()) {
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
        this.followHeight += mouseDeltaY * mouseSensitivity * 300; // Tripled sensitivity to match pan amount
        this.followHeight = Math.max(this.minFollowHeight, Math.min(this.maxFollowHeight, this.followHeight));
      }
    }

    // Handle touch camera controls (two finger swipe)
    if (inputManager.getIsTouchCamera()) {
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
        this.followHeight += touchDeltaY * touchSensitivity * 300; // Tripled sensitivity to match pan amount
        this.followHeight = Math.max(this.minFollowHeight, Math.min(this.maxFollowHeight, this.followHeight));
      }
    }


    const bomberPos = this.bomber.getPosition();
    const bomberRotation = this.bomber.getRotation();

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
    this.tempVector1.set(
      bomberPos.x - this.cachedSin * this.followDistance,
      this.followHeight,
      bomberPos.z - this.cachedCos * this.followDistance,
    );

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

  public resetCamera(currentTime: number): void {
    // Check if cooldown has passed
    if (currentTime - this.lastResetTime < this.resetCooldown) {
      return; // Cooldown not yet complete
    }

    // Reset other camera properties to initial state
    this.followDistance = this.initialFollowDistance;
    this.followHeight = this.initialFollowHeight;

    // Reset pan offset to center the camera
    this.panAngleOffset = 0;

    // Update last reset time
    this.lastResetTime = currentTime;
  }
}
