import { Scene, DynamicTexture, Texture } from '@babylonjs/core';

/**
 * Per-Scene cache of the shared procedural particle textures (fire, smoke, trail,
 * flare, spark, shockwave). These gradients used to be redrawn as a fresh
 * DynamicTexture by every bomb, missile, and flare — mid-combat — which churned
 * scene.textures and GPU uploads. Like BuildingAssets, each texture is built once
 * on first use and lives for the Scene's lifetime; entities reference them and
 * must dispose their particle systems with dispose(false) to leave them intact.
 */
export class EffectTextures {
  private static cache: WeakMap<Scene, EffectTextures> = new WeakMap();

  static get(scene: Scene): EffectTextures {
    let textures = EffectTextures.cache.get(scene);
    if (!textures) {
      textures = new EffectTextures(scene);
      EffectTextures.cache.set(scene, textures);
    }
    return textures;
  }

  private scene: Scene;
  private fireTexture: DynamicTexture | null = null;
  private smokeTexture: DynamicTexture | null = null;
  private trailTexture: DynamicTexture | null = null;
  private redTrailTexture: DynamicTexture | null = null;
  private flareTexture: DynamicTexture | null = null;
  private sparkTexture: DynamicTexture | null = null;
  private shockwaveTexture: DynamicTexture | null = null;
  private pixelTexture: Texture | null = null;

  private constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Bright white-to-red explosion fireball gradient. */
  getFireTexture(): DynamicTexture {
    if (!this.fireTexture) {
      const texture = new DynamicTexture('effectFireTexture', { width: 64, height: 64 }, this.scene, true);
      const context = texture.getContext();
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.2, 'rgba(255, 255, 0, 0.9)');
      gradient.addColorStop(0.5, 'rgba(255, 100, 0, 0.6)');
      gradient.addColorStop(0.8, 'rgba(255, 50, 0, 0.3)');
      gradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      texture.update();
      this.fireTexture = texture;
    }
    return this.fireTexture;
  }

  /** Noisy overlapping-puff smoke texture. */
  getSmokeTexture(): DynamicTexture {
    if (!this.smokeTexture) {
      const texture = new DynamicTexture('effectSmokeTexture', { width: 64, height: 64 }, this.scene, true);
      const context = texture.getContext();
      context.fillStyle = 'rgba(0, 0, 0, 0)';
      context.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 8; i++) {
        const x = 32 + (Math.random() - 0.5) * 40;
        const y = 32 + (Math.random() - 0.5) * 40;
        const radius = 15 + Math.random() * 15;
        const alpha = 0.1 + Math.random() * 0.3;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(100, 100, 100, ${alpha})`);
        gradient.addColorStop(1, 'rgba(50, 50, 50, 0)');
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius, 0, 2 * Math.PI);
        context.fill();
      }
      texture.update();
      this.smokeTexture = texture;
    }
    return this.smokeTexture;
  }

  /** Soft white/gray dot for vapor and bomb trails. */
  getTrailTexture(): DynamicTexture {
    if (!this.trailTexture) {
      const texture = new DynamicTexture('effectTrailTexture', { width: 64, height: 64 }, this.scene, true);
      const context = texture.getContext();
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.5, 'rgba(200, 200, 200, 0.5)');
      gradient.addColorStop(1, 'rgba(100, 100, 100, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      texture.update();
      this.trailTexture = texture;
    }
    return this.trailTexture;
  }

  /** Red-tinted trail dot (Iskander exhaust trail). */
  getRedTrailTexture(): DynamicTexture {
    if (!this.redTrailTexture) {
      const texture = new DynamicTexture('effectRedTrailTexture', { width: 64, height: 64 }, this.scene, true);
      const context = texture.getContext();
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255, 100, 100, 1)');
      gradient.addColorStop(0.5, 'rgba(200, 50, 50, 0.5)');
      gradient.addColorStop(1, 'rgba(100, 25, 25, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      texture.update();
      this.redTrailTexture = texture;
    }
    return this.redTrailTexture;
  }

  /** Bright countermeasure-flare glow. */
  getFlareTexture(): DynamicTexture {
    if (!this.flareTexture) {
      const texture = new DynamicTexture('effectFlareTexture', { width: 32, height: 32 }, this.scene, true);
      const context = texture.getContext();
      const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.3, 'rgba(255, 255, 200, 0.9)');
      gradient.addColorStop(0.7, 'rgba(255, 200, 100, 0.6)');
      gradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 32, 32);
      texture.update();
      this.flareTexture = texture;
    }
    return this.flareTexture;
  }

  /** Hot spark point. */
  getSparkTexture(): DynamicTexture {
    if (!this.sparkTexture) {
      const texture = new DynamicTexture('effectSparkTexture', { width: 32, height: 32 }, this.scene, true);
      const context = texture.getContext();
      const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.3, 'rgba(255, 255, 200, 0.8)');
      gradient.addColorStop(0.7, 'rgba(255, 200, 100, 0.4)');
      gradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 32, 32);
      texture.update();
      this.sparkTexture = texture;
    }
    return this.sparkTexture;
  }

  /** Expanding ring for explosion shockwaves. */
  getShockwaveTexture(): DynamicTexture {
    if (!this.shockwaveTexture) {
      const texture = new DynamicTexture('effectShockwaveTexture', { width: 64, height: 64 }, this.scene, true);
      const context = texture.getContext();
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
      gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
      gradient.addColorStop(0.7, 'rgba(255, 200, 100, 0.4)');
      gradient.addColorStop(1, 'rgba(255, 150, 50, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      texture.update();
      this.shockwaveTexture = texture;
    }
    return this.shockwaveTexture;
  }

  /** 1x1 white pixel — untextured engine-exhaust particles tint it via particle colors. */
  getPixelTexture(): Texture {
    if (!this.pixelTexture) {
      this.pixelTexture = new Texture(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        this.scene,
      );
    }
    return this.pixelTexture;
  }
}
