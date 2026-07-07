import {
  Scene,
  StandardMaterial,
  Color3,
  Mesh,
  MeshBuilder,
  DynamicTexture,
  Animation,
} from '@babylonjs/core';
import { BuildingType } from './Building';

/**
 * Per-Scene cache of shared building assets (materials, source meshes for instancing,
 * and the fire/smoke particle textures).
 *
 * The game runs on a single persistent Scene, so these are built once on first use and
 * live for the scene's lifetime. Buildings reference them instead of allocating their own
 * copies — this is what lets building count scale without exploding draw calls, material
 * count, and texture memory. All assets are children of the Scene, so they are disposed
 * automatically when the Scene is disposed; nothing here is disposed per building.
 */
export class BuildingAssets {
  private static cache: WeakMap<Scene, BuildingAssets> = new WeakMap();

  static get(scene: Scene): BuildingAssets {
    let assets = BuildingAssets.cache.get(scene);
    if (!assets) {
      assets = new BuildingAssets(scene);
      BuildingAssets.cache.set(scene, assets);
    }
    return assets;
  }

  private scene: Scene;
  private materials: Map<string, StandardMaterial> = new Map();
  private boxSources: Map<string, Mesh> = new Map();
  private antennaSource: Mesh | null = null;
  private smokestackSource: Mesh | null = null;
  private launcherMaterial: StandardMaterial | null = null;
  private launcherSource: Mesh | null = null;
  private fireTexture: DynamicTexture | null = null;
  private smokeTexture: DynamicTexture | null = null;
  private ringMaterial: StandardMaterial | null = null;
  private ringSource: Mesh | null = null;

  private constructor(scene: Scene) {
    this.scene = scene;
  }

  private colorForType(type: string): Color3 {
    switch (type) {
      case BuildingType.RESIDENTIAL:
        return new Color3(0.8, 0.7, 0.6); // Warm beige
      case BuildingType.COMMERCIAL:
        return new Color3(0.6, 0.8, 0.9); // Light blue
      case BuildingType.INDUSTRIAL:
        return new Color3(0.5, 0.5, 0.5); // Gray
      case BuildingType.SKYSCRAPER:
        return new Color3(0.3, 0.3, 0.4); // Dark blue-gray
      default:
        return new Color3(0.7, 0.7, 0.7); // Light gray
    }
  }

  /**
   * Shared material for a building type — one instance reused by every building
   * of that type. Frozen: nothing ever writes to it after creation (damage is
   * particles-only), so Babylon can skip its per-frame material sync. Writes to
   * a frozen material would silently no-op.
   */
  getMaterial(type: string): StandardMaterial {
    let material = this.materials.get(type);
    if (!material) {
      material = new StandardMaterial(`buildingMaterial_${type}`, this.scene);
      material.diffuseColor = this.colorForType(type);
      material.specularColor = new Color3(0.1, 0.1, 0.1);
      // Hemi + directional + 4 pooled-light slots so damage flashes/bomb glow
      // can light buildings (default 4 total leaves only 2 pool slots; the full
      // 8 costs measurable per-pixel shader work — see terrainMaterial's note).
      // Pre-freeze: the light count is baked into the shader defines at compile.
      material.maxSimultaneousLights = 6;
      material.freeze();
      this.materials.set(type, material);
    }
    return material;
  }

  /** Hidden unit (1x1x1) box per type whose material is shared; instances are scaled per building. */
  getBoxSource(type: string): Mesh {
    let src = this.boxSources.get(type);
    if (!src) {
      src = MeshBuilder.CreateBox(`buildingBoxSource_${type}`, { size: 1 }, this.scene);
      src.material = this.getMaterial(type);
      src.isVisible = false; // hide the source itself; instances still render
      this.boxSources.set(type, src);
    }
    return src;
  }

  /** Hidden antenna source (fixed size) — commercial buildings instance this. */
  getAntennaSource(): Mesh {
    if (!this.antennaSource) {
      this.antennaSource = MeshBuilder.CreateCylinder(
        'buildingAntennaSource',
        { height: 4, diameterTop: 0.5, diameterBottom: 1 },
        this.scene,
      );
      this.antennaSource.material = this.getMaterial(BuildingType.COMMERCIAL);
      this.antennaSource.isVisible = false;
    }
    return this.antennaSource;
  }

  /** Hidden unit cylinder source — industrial smokestacks instance and scale this. */
  getSmokestackSource(): Mesh {
    if (!this.smokestackSource) {
      this.smokestackSource = MeshBuilder.CreateCylinder(
        'buildingSmokestackSource',
        { height: 1, diameter: 1 },
        this.scene,
      );
      this.smokestackSource.material = this.getMaterial(BuildingType.INDUSTRIAL);
      this.smokestackSource.isVisible = false;
    }
    return this.smokestackSource;
  }

  /**
   * Shared animated launcher material — one flashing animation drives all
   * launchers. Deliberately NOT frozen: the animation writes emissiveColor
   * every frame, which a frozen material would ignore.
   */
  getLauncherMaterial(): StandardMaterial {
    if (!this.launcherMaterial) {
      const material = new StandardMaterial('launcherMaterial_shared', this.scene);
      material.diffuseColor = new Color3(1.0, 0.5, 0.0); // Orange
      material.specularColor = new Color3(1.0, 0.7, 0.3);
      material.emissiveColor = new Color3(0.3, 0.15, 0.0); // Base orange glow

      const emissiveAnimation = new Animation(
        'launcherFlash',
        'emissiveColor',
        30,
        Animation.ANIMATIONTYPE_COLOR3,
        Animation.ANIMATIONLOOPMODE_CYCLE,
      );
      emissiveAnimation.setKeys([
        { frame: 0, value: new Color3(0.3, 0.15, 0.0) }, // Dim orange
        { frame: 15, value: new Color3(1.0, 0.5, 0.0) }, // Bright orange
        { frame: 30, value: new Color3(0.3, 0.15, 0.0) }, // Back to dim orange
      ]);
      material.animations = [emissiveAnimation];
      this.scene.beginAnimation(material, 0, 30, true);

      this.launcherMaterial = material;
    }
    return this.launcherMaterial;
  }

  /** Hidden launcher box source (fixed 3x2x3) — launcher buildings instance this. */
  getLauncherSource(): Mesh {
    if (!this.launcherSource) {
      this.launcherSource = MeshBuilder.CreateBox(
        'buildingLauncherSource',
        { width: 3, height: 2, depth: 3 },
        this.scene,
      );
      this.launcherSource.material = this.getLauncherMaterial();
      this.launcherSource.isVisible = false;
    }
    return this.launcherSource;
  }

  /** Shared fire particle texture (identical for every building). */
  getFireTexture(): DynamicTexture {
    if (!this.fireTexture) {
      const texture = new DynamicTexture('buildingFireTexture', { width: 64, height: 64 }, this.scene);
      const ctx = texture.getContext();
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.3, 'rgba(255, 200, 0, 0.8)');
      gradient.addColorStop(0.7, 'rgba(255, 100, 0, 0.4)');
      gradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
      texture.update();
      this.fireTexture = texture;
    }
    return this.fireTexture;
  }

  /**
   * Shared animated red target-ring material — one pulsing animation drives
   * every target ring. Deliberately NOT frozen: the shared pulse animation
   * writes emissiveColor every frame — launcherMaterial precedent. 2s period,
   * deliberately different from the launcher's 1s so the two reds don't
   * strobe in sync.
   */
  getRingMaterial(): StandardMaterial {
    if (!this.ringMaterial) {
      const material = new StandardMaterial('ringMaterial', this.scene);
      material.emissiveColor = new Color3(0.45, 0, 0); // Dim red base
      material.diffuseColor = new Color3(0.8, 0, 0);

      const emissiveAnimation = new Animation(
        'ringPulse',
        'emissiveColor',
        30,
        Animation.ANIMATIONTYPE_COLOR3,
        Animation.ANIMATIONLOOPMODE_CYCLE,
      );
      emissiveAnimation.setKeys([
        { frame: 0, value: new Color3(0.45, 0, 0) },      // Dim red
        { frame: 30, value: new Color3(1, 0.12, 0.06) },  // Hot red
        { frame: 60, value: new Color3(0.45, 0, 0) },     // Back to dim red
      ]);
      material.animations = [emissiveAnimation];
      this.scene.beginAnimation(material, 0, 60, true);

      this.ringMaterial = material;
    }
    return this.ringMaterial;
  }

  /**
   * Hidden unit torus — target rings instance and uniformly scale this, so every
   * ring batches into one draw call. Tube thickness (0.03 of the diameter) scales
   * with the ring; at the typical ~35-unit diameter it matches the old fixed 1.
   */
  getRingSource(): Mesh {
    if (!this.ringSource) {
      this.ringSource = MeshBuilder.CreateTorus('buildingRingSource', { diameter: 1, thickness: 0.03 }, this.scene);
      this.ringSource.material = this.getRingMaterial();
      this.ringSource.isVisible = false;
    }
    return this.ringSource;
  }

  /** Shared smoke particle texture (identical for every building). */
  getSmokeTexture(): DynamicTexture {
    if (!this.smokeTexture) {
      const texture = new DynamicTexture('buildingSmokeTexture', { width: 64, height: 64 }, this.scene);
      const ctx = texture.getContext();
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 8; i++) {
        const x = 32 + (Math.random() - 0.5) * 40;
        const y = 32 + (Math.random() - 0.5) * 40;
        const radius = 15 + Math.random() * 15;
        const alpha = 0.1 + Math.random() * 0.3;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(100, 100, 100, ${alpha})`);
        gradient.addColorStop(1, 'rgba(50, 50, 50, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fill();
      }
      texture.update();
      this.smokeTexture = texture;
    }
    return this.smokeTexture;
  }
}
