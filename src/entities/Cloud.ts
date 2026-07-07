import { Scene, Vector3, TransformNode, InstancedMesh } from '@babylonjs/core';
import { CloudAssets } from './CloudAssets';

// Cloud centers span the bomber's flyable band (150-200) shifted up by half its
// height, so the bomber flies through the lower clouds and under the upper ones.
export const CLOUD_BAND_MIN_Y = 175;
export const CLOUD_BAND_MAX_Y = 225;
// One shared wind vector — every cloud drifts the same way, slowly (~4.7 u/s).
export const CLOUD_WIND_VELOCITY = new Vector3(4, 0, 2.5);
export const CLOUD_FADE_SECONDS = 2;
const CLOUD_MIN_BLOBS = 5;
const CLOUD_MAX_BLOBS = 9;
const CLOUD_BLOB_RADIUS_MIN = 14;
const CLOUD_BLOB_RADIUS_MAX = 24;
const CLOUD_FLATTEN_Y = 0.55; // vertical squash for a cumulus silhouette

/**
 * A decorative cotton-puff cloud: a clump of overlapping sphere instances under
 * one TransformNode. Purely visual — no collision, nothing else references it.
 * Fade in/out is done by scaling the root (per-instance alpha is impossible on
 * InstancedMesh, and scaling keeps the shared material frozen and opaque).
 */
export class Cloud {
  private root: TransformNode;
  private blobs: InstancedMesh[] = [];
  private fadeProgress: number;
  private state: 'growing' | 'alive' | 'dying';
  private disposed: boolean = false;

  constructor(scene: Scene, position: Vector3, initialFadeProgress: number = 0) {
    this.fadeProgress = Math.min(Math.max(initialFadeProgress, 0), 1);
    this.state = this.fadeProgress >= 1 ? 'alive' : 'growing';

    this.root = new TransformNode('cloud', scene);
    this.root.position.copyFrom(position);
    this.applyScale();

    const source = CloudAssets.get(scene).getBlobSource();
    const coreRadius = CLOUD_BLOB_RADIUS_MIN + Math.random() * (CLOUD_BLOB_RADIUS_MAX - CLOUD_BLOB_RADIUS_MIN);
    const blobCount = CLOUD_MIN_BLOBS + Math.floor(Math.random() * (CLOUD_MAX_BLOBS - CLOUD_MIN_BLOBS + 1));

    for (let i = 0; i < blobCount; i++) {
      const blob = source.createInstance('cloudBlob');
      const isCore = i === 0;
      const scale = isCore ? 1 : 0.5 + Math.random() * 0.4;
      const diameter = 2 * coreRadius * scale;
      blob.scaling.set(diameter, diameter * CLOUD_FLATTEN_Y, diameter * (0.85 + Math.random() * 0.3));
      if (!isCore) {
        // Satellites cluster around the core: puffy on top, flat underneath.
        blob.position.set(
          (Math.random() * 2 - 1) * coreRadius * 1.2,
          Math.random() * coreRadius * 0.35,
          (Math.random() * 2 - 1) * coreRadius * 1.2,
        );
      }
      blob.isPickable = false;
      // No freezeWorldMatrix/doNotSyncBoundingInfo: the cloud moves every frame,
      // and frustum culling needs live bounds.
      blob.parent = this.root;
      this.blobs.push(blob);
    }
  }

  update(deltaTime: number): void {
    if (this.disposed) return;

    this.root.position.x += CLOUD_WIND_VELOCITY.x * deltaTime;
    this.root.position.y += CLOUD_WIND_VELOCITY.y * deltaTime;
    this.root.position.z += CLOUD_WIND_VELOCITY.z * deltaTime;

    if (this.state === 'growing') {
      this.fadeProgress += deltaTime / CLOUD_FADE_SECONDS;
      if (this.fadeProgress >= 1) {
        this.fadeProgress = 1;
        this.state = 'alive';
      }
      this.applyScale();
    } else if (this.state === 'dying') {
      this.fadeProgress -= deltaTime / CLOUD_FADE_SECONDS;
      if (this.fadeProgress <= 0) {
        this.dispose();
        return;
      }
      this.applyScale();
    }
  }

  private applyScale(): void {
    // Smoothstep-eased puff; never exactly 0 to avoid a degenerate matrix.
    const t = this.fadeProgress;
    const eased = Math.max(t * t * (3 - 2 * t), 0.0001);
    this.root.scaling.setAll(eased);
  }

  beginFadeOut(): void {
    this.state = 'dying';
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /** True while this cloud is substantial enough to mask the bomber from IR lock
   *  (mostly grown, not fading out). */
  isConcealing(): boolean {
    return !this.disposed && this.state !== 'dying' && this.fadeProgress >= 0.7;
  }

  getPosition(): Vector3 {
    return this.root.position;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const blob of this.blobs) {
      blob.dispose();
    }
    this.blobs.length = 0;
    this.root.dispose();
  }
}
