import { Scene, ParticleSystem, Vector3, Color4 } from '@babylonjs/core';
import { EffectTextures } from './EffectTextures';

export interface ExplodeOptions {
  smoke?: boolean;
  shockwave?: boolean;
  sparks?: boolean;
}

interface ExplosionBundle {
  fire: ParticleSystem;
  smoke: ParticleSystem;
  spark: ParticleSystem;
  shockwave: ParticleSystem;
  /** Shared emitter for all four systems; copyFrom'd per explosion. */
  emitter: Vector3;
  rentedAt: number;
}

/**
 * Per-Scene pool of pre-built explosion effects. Bombs and missiles used to build
 * 2-4 fresh ParticleSystems (plus textures) per detonation and dispose them on
 * setTimeout, so scene.particleSystems churned all combat. The pool's systems are
 * created once, started once, and never stopped or disposed: each is parked with
 * manualEmitCount = 0 (a started system with manualEmitCount 0 emits nothing), and
 * an explosion re-arms it by moving the emitter and setting manualEmitCount again —
 * Babylon consumes the count in one burst and resets it to 0. Particle sizes are
 * sampled at emission, so per-rent size scaling never retro-affects live particles,
 * and emitted particles hold world positions, so re-renting the oldest bundle lets
 * its previous smoke finish fading in place.
 *
 * Particle counts/sizes are tuned for mobile fill rate: fewer, larger particles
 * than the originals (fire 2000 -> 700 at +25% size, smoke 1200 -> 400).
 */
export class ExplosionPool {
  private static cache: WeakMap<Scene, ExplosionPool> = new WeakMap();

  static get(scene: Scene): ExplosionPool {
    let pool = ExplosionPool.cache.get(scene);
    if (!pool) {
      pool = new ExplosionPool(scene);
      ExplosionPool.cache.set(scene, pool);
    }
    return pool;
  }

  private static readonly POOL_SIZE = 4;
  // A bundle is free once its longest-lived particles (smoke, 3.5s) have faded.
  private static readonly FREE_AFTER_MS = 3600;

  private static readonly FIRE_COUNT = 700;
  private static readonly SMOKE_COUNT = 400;
  private static readonly SPARK_COUNT = 150;
  private static readonly SHOCKWAVE_COUNT = 120;

  private static readonly FIRE_MIN_SIZE = 3.1;
  private static readonly FIRE_MAX_SIZE = 8.1;
  private static readonly SMOKE_MIN_SIZE = 4.0;
  private static readonly SMOKE_MAX_SIZE = 8.0;
  private static readonly SPARK_MIN_SIZE = 0.5;
  private static readonly SPARK_MAX_SIZE = 1.5;
  private static readonly SHOCKWAVE_MIN_SIZE = 8.0;
  private static readonly SHOCKWAVE_MAX_SIZE = 15.0;

  private bundles: ExplosionBundle[] = [];

  private constructor(scene: Scene) {
    const textures = EffectTextures.get(scene);

    for (let i = 0; i < ExplosionPool.POOL_SIZE; i++) {
      const emitter = new Vector3(0, -10000, 0);

      const fire = new ParticleSystem(`poolExplosionFire${i}`, ExplosionPool.FIRE_COUNT, scene);
      fire.particleTexture = textures.getFireTexture();
      fire.emitter = emitter;
      fire.minEmitBox = new Vector3(-1.2, 0, -1.2);
      fire.maxEmitBox = new Vector3(1.2, 0, 1.2);
      fire.color1 = new Color4(1, 0.9, 0.1, 1.0);
      fire.color2 = new Color4(1, 0.4, 0, 1.0);
      fire.colorDead = new Color4(0.3, 0.1, 0, 0.0);
      fire.minSize = ExplosionPool.FIRE_MIN_SIZE;
      fire.maxSize = ExplosionPool.FIRE_MAX_SIZE;
      fire.minLifeTime = 0.3;
      fire.maxLifeTime = 0.6;
      fire.blendMode = ParticleSystem.BLENDMODE_ONEONE;
      fire.gravity = new Vector3(0, -9.81, 0);
      fire.direction1 = new Vector3(-10, 8, -10);
      fire.direction2 = new Vector3(10, 10, 10);
      fire.minEmitPower = 5;
      fire.maxEmitPower = 15;
      fire.updateSpeed = 0.005;

      const smoke = new ParticleSystem(`poolExplosionSmoke${i}`, ExplosionPool.SMOKE_COUNT, scene);
      smoke.particleTexture = textures.getSmokeTexture();
      smoke.emitter = emitter;
      smoke.minEmitBox = new Vector3(-2, 0, -2);
      smoke.maxEmitBox = new Vector3(2, 0, 2);
      smoke.color1 = new Color4(0.3, 0.3, 0.3, 0.9);
      smoke.color2 = new Color4(0.5, 0.5, 0.5, 0.7);
      smoke.colorDead = new Color4(0.1, 0.1, 0.1, 0.0);
      smoke.minSize = ExplosionPool.SMOKE_MIN_SIZE;
      smoke.maxSize = ExplosionPool.SMOKE_MAX_SIZE;
      smoke.minLifeTime = 1.5;
      smoke.maxLifeTime = 3.5;
      smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      smoke.gravity = new Vector3(0, -2, 0);
      smoke.direction1 = new Vector3(-1.2, 3, -1.2);
      smoke.direction2 = new Vector3(1.2, 3, 1.2);
      smoke.minEmitPower = 1.2;
      smoke.maxEmitPower = 3;
      smoke.updateSpeed = 0.01;

      const spark = new ParticleSystem(`poolExplosionSpark${i}`, ExplosionPool.SPARK_COUNT, scene);
      spark.particleTexture = textures.getSparkTexture();
      spark.emitter = emitter;
      spark.minEmitBox = new Vector3(-0.5, 0, -0.5);
      spark.maxEmitBox = new Vector3(0.5, 0, 0.5);
      spark.color1 = new Color4(1, 1, 0.8, 1.0);
      spark.color2 = new Color4(1, 0.8, 0.4, 0.8);
      spark.colorDead = new Color4(1, 0.6, 0.2, 0.0);
      spark.minSize = ExplosionPool.SPARK_MIN_SIZE;
      spark.maxSize = ExplosionPool.SPARK_MAX_SIZE;
      spark.minLifeTime = 0.5;
      spark.maxLifeTime = 1.0;
      spark.blendMode = ParticleSystem.BLENDMODE_ONEONE;
      spark.gravity = new Vector3(0, -10, 0);
      spark.direction1 = new Vector3(-8, 5, -8);
      spark.direction2 = new Vector3(8, 8, 8);
      spark.minEmitPower = 10;
      spark.maxEmitPower = 20;
      spark.updateSpeed = 0.01;

      const shockwave = new ParticleSystem(`poolExplosionShockwave${i}`, ExplosionPool.SHOCKWAVE_COUNT, scene);
      shockwave.particleTexture = textures.getShockwaveTexture();
      shockwave.emitter = emitter;
      shockwave.minEmitBox = new Vector3(0, 0, 0);
      shockwave.maxEmitBox = new Vector3(0, 0, 0);
      shockwave.color1 = new Color4(1, 1, 1, 0.8);
      shockwave.color2 = new Color4(1, 0.8, 0.4, 0.6);
      shockwave.colorDead = new Color4(1, 0.6, 0.2, 0.0);
      shockwave.minSize = ExplosionPool.SHOCKWAVE_MIN_SIZE;
      shockwave.maxSize = ExplosionPool.SHOCKWAVE_MAX_SIZE;
      shockwave.minLifeTime = 0.8;
      shockwave.maxLifeTime = 1.2;
      shockwave.blendMode = ParticleSystem.BLENDMODE_ONEONE;
      shockwave.gravity = new Vector3(0, 0, 0);
      shockwave.direction1 = new Vector3(-0.5, 0, -0.5);
      shockwave.direction2 = new Vector3(0.5, 0, 0.5);
      shockwave.minEmitPower = 20;
      shockwave.maxEmitPower = 30;
      shockwave.updateSpeed = 0.01;

      // Park every system: started but emitting nothing until re-armed.
      for (const ps of [fire, smoke, spark, shockwave]) {
        ps.manualEmitCount = 0;
        ps.start();
      }

      this.bundles.push({ fire, smoke, spark, shockwave, emitter, rentedAt: -Infinity });
    }
  }

  /**
   * Fire one explosion at `position`. `scale` multiplies particle sizes and counts
   * (1 = full bomb-sized blast). With all bundles busy, the oldest is re-armed —
   * its surviving particles fade out where they were emitted.
   */
  explode(position: Vector3, scale: number = 1, opts: ExplodeOptions = {}): void {
    const now = performance.now();
    let bundle = this.bundles[0];
    for (const candidate of this.bundles) {
      if (now - candidate.rentedAt > ExplosionPool.FREE_AFTER_MS) {
        bundle = candidate;
        break;
      }
      if (candidate.rentedAt < bundle.rentedAt) {
        bundle = candidate;
      }
    }
    bundle.rentedAt = now;
    bundle.emitter.copyFrom(position);

    const countScale = Math.min(1, scale);

    bundle.fire.minSize = ExplosionPool.FIRE_MIN_SIZE * scale;
    bundle.fire.maxSize = ExplosionPool.FIRE_MAX_SIZE * scale;
    bundle.fire.manualEmitCount = Math.round(ExplosionPool.FIRE_COUNT * countScale);

    if (opts.smoke !== false) {
      bundle.smoke.minSize = ExplosionPool.SMOKE_MIN_SIZE * scale;
      bundle.smoke.maxSize = ExplosionPool.SMOKE_MAX_SIZE * scale;
      bundle.smoke.manualEmitCount = Math.round(ExplosionPool.SMOKE_COUNT * countScale);
    }

    if (opts.sparks !== false) {
      bundle.spark.minSize = ExplosionPool.SPARK_MIN_SIZE * scale;
      bundle.spark.maxSize = ExplosionPool.SPARK_MAX_SIZE * scale;
      bundle.spark.manualEmitCount = Math.round(ExplosionPool.SPARK_COUNT * countScale);
    }

    if (opts.shockwave !== false) {
      bundle.shockwave.minSize = ExplosionPool.SHOCKWAVE_MIN_SIZE * scale;
      bundle.shockwave.maxSize = ExplosionPool.SHOCKWAVE_MAX_SIZE * scale;
      bundle.shockwave.manualEmitCount = Math.round(ExplosionPool.SHOCKWAVE_COUNT * countScale);
    }
  }
}
