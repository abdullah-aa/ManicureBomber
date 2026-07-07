import { FreeCamera, Vector3 } from '@babylonjs/core';
import { TerrainManager } from './TerrainManager';

/**
 * Owns the camera-motion mechanics shared by every view mode: position
 * lerp/snap, the smoothed look-at, and the terrain floor clamp.
 * Allocation-free — every method mutates in place.
 */
export class CameraRig {
  private camera: FreeCamera;
  private terrainManager: TerrainManager;
  // The camera's eased aim (single camera → single aim). Every mode/story
  // entry seeds it (or snaps it via aimToward), so within-mode handoffs can
  // rely on it persisting across sub-states.
  private smoothedTarget: Vector3 = new Vector3();
  private smoothedTargetValid: boolean = false; // false until first seed; never reset

  constructor(camera: FreeCamera, terrainManager: TerrainManager) {
    this.camera = camera;
    this.terrainManager = terrainManager;
  }

  /**
   * Move the camera toward a desired position: snap copies it outright,
   * otherwise a rate-capped manual lerp (no object creation).
   */
  public moveToward(desired: Vector3, rate: number, deltaTime: number, snap: boolean): void {
    const p = this.camera.position;
    if (snap) {
      p.copyFrom(desired);
      return;
    }
    const lf = Math.min(rate * deltaTime, 1.0);
    const inv = 1.0 - lf;
    p.x = p.x * inv + desired.x * lf;
    p.y = p.y * inv + desired.y * lf;
    p.z = p.z * inv + desired.z * lf;
  }

  /** Ease the camera's look-at toward a target instead of snapping it. */
  public aimToward(target: Vector3, deltaTime: number, snap: boolean, rate: number): void {
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

  /** Seed the smoothed look-at (copy semantics — no ref retained). */
  public seedAim(target: Vector3): void {
    this.smoothedTarget.copyFrom(target);
    this.smoothedTargetValid = true;
  }

  /** Aim the camera directly at a point — does NOT touch the smoothed aim. */
  public setTargetDirect(target: Vector3): void {
    this.camera.setTarget(target);
  }

  /**
   * Terrain floor clamp: keep a point 5 units above real terrain and never
   * below the 10-unit world floor. Over unloaded chunks getTerrainHeightAt
   * returns 0 and the 10-unit floor still applies.
   */
  public clampAboveTerrain(v: Vector3): void {
    const groundHeight = this.terrainManager.getTerrainHeightAt(v.x, v.z);
    v.y = Math.max(v.y, groundHeight + 5, 10);
  }

  /** Live ref to the camera position — bearing-borrow math reads it. */
  public getPositionRef(): Vector3 {
    return this.camera.position;
  }
}
