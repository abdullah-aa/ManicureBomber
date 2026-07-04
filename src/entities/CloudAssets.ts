import { Scene, StandardMaterial, Color3, Mesh, MeshBuilder } from '@babylonjs/core';

/**
 * Per-Scene cache of the shared cloud assets: one hidden sphere source and one
 * frozen material. Every cloud blob in the game is an instance of the single
 * source, so the whole sky batches into one draw call (BuildingAssets pattern).
 */
export class CloudAssets {
  private static cache: WeakMap<Scene, CloudAssets> = new WeakMap();

  static get(scene: Scene): CloudAssets {
    let assets = CloudAssets.cache.get(scene);
    if (!assets) {
      assets = new CloudAssets(scene);
      CloudAssets.cache.set(scene, assets);
    }
    return assets;
  }

  private scene: Scene;
  private blobMaterial: StandardMaterial | null = null;
  private blobSource: Mesh | null = null;

  private constructor(scene: Scene) {
    this.scene = scene;
  }

  private getBlobMaterial(): StandardMaterial {
    if (!this.blobMaterial) {
      const material = new StandardMaterial('cloudMaterial', this.scene);
      // Opaque with an emissive lift toward the sky color: the scene's dim
      // hemispheric light would otherwise render undersides storm-grey. Opaque
      // also keeps overlapping blobs out of the transparent queue (no sorting
      // artifacts within the single instanced draw call). Scene fog applies by
      // default, so distant clouds dissolve into the horizon like terrain.
      material.diffuseColor = new Color3(0.93, 0.94, 0.96);
      material.specularColor = new Color3(0, 0, 0);
      material.emissiveColor = new Color3(0.42, 0.46, 0.52);
      material.freeze();
      this.blobMaterial = material;
    }
    return this.blobMaterial;
  }

  /** Hidden unit sphere; clouds instance it with per-blob non-uniform scaling. */
  getBlobSource(): Mesh {
    if (!this.blobSource) {
      this.blobSource = MeshBuilder.CreateSphere('cloudBlobSource', { diameter: 1, segments: 10 }, this.scene);
      this.blobSource.material = this.getBlobMaterial();
      this.blobSource.isVisible = false; // hide the source itself; instances still render
    }
    return this.blobSource;
  }
}
