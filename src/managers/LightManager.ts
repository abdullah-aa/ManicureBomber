import { PointLight, Scene, Vector3 } from '@babylonjs/core';

export enum LightPriority {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
}

interface PoolEntry {
  light: PointLight;
  inUse: boolean;
  priority: LightPriority;
  generation: number;
  expiresAt: number | null;
}

/**
 * Handle to a pooled light. All setters silently no-op once the handle is
 * inert (never backed by a light, released, expired, or stolen by a
 * higher-priority acquire), so call sites need no null checks or ownership
 * bookkeeping.
 */
export class LightHandle {
  private entry: PoolEntry | null;
  private generation: number;

  constructor(entry: PoolEntry | null, generation: number) {
    this.entry = entry;
    this.generation = generation;
  }

  static inert(): LightHandle {
    return new LightHandle(null, 0);
  }

  private get live(): PoolEntry | null {
    const e = this.entry;
    return e && e.inUse && e.generation === this.generation ? e : null;
  }

  public isActive(): boolean {
    return this.live !== null;
  }

  public setPosition(position: Vector3): void {
    const e = this.live;
    if (e) e.light.position.copyFrom(position);
  }

  public setPositionXYZ(x: number, y: number, z: number): void {
    const e = this.live;
    if (e) e.light.position.set(x, y, z);
  }

  public setColor(r: number, g: number, b: number): void {
    const e = this.live;
    if (e) {
      e.light.diffuse.set(r, g, b);
      e.light.specular.set(r, g, b);
    }
  }

  public setIntensity(intensity: number): void {
    const e = this.live;
    if (e) e.light.intensity = intensity;
  }

  public setRange(range: number): void {
    const e = this.live;
    if (e) e.light.range = range;
  }

  /** Extend (or set) the auto-release deadline, in seconds from now. */
  public setTtl(seconds: number): void {
    const e = this.live;
    if (e) e.expiresAt = performance.now() + seconds * 1000;
  }

  public release(): void {
    const e = this.live;
    if (e) LightManager.releaseEntry(e);
    this.entry = null;
  }
}

/**
 * Fixed pool of scene PointLights. The pool is created once at startup and its
 * lights are never disposed or removed from the scene, so the scene's light
 * list stays stable — adding/removing lights dirties every material (shader
 * resync), which was a major source of combat hitches.
 *
 * When the pool is exhausted, an acquire steals the entry with the lowest
 * priority strictly below the requested one; the stolen owner's handle simply
 * goes inert. Pooled lights are intentionally never parented to entity nodes
 * (disposing the parent would dispose the pooled light with it) — owners set
 * world-space positions through the handle each frame.
 */
export class LightManager {
  private static cache: WeakMap<Scene, LightManager> = new WeakMap();

  static get(scene: Scene): LightManager {
    let instance = LightManager.cache.get(scene);
    if (!instance) {
      instance = new LightManager(scene);
      LightManager.cache.set(scene, instance);
    }
    return instance;
  }

  private static readonly POOL_SIZE = 6;
  private entries: PoolEntry[] = [];

  private constructor(scene: Scene) {
    for (let i = 0; i < LightManager.POOL_SIZE; i++) {
      const light = new PointLight(`pooledLight${i}`, new Vector3(0, -10000, 0), scene);
      // Parked by INTENSITY, never by setEnabled: a disabled light is excluded
      // from every mesh's light sources, so frozen materials (terrain,
      // buildings — they bake their light set at first compile and never
      // recompute) would permanently ignore it. An enabled zero-intensity
      // light far below the world costs nothing to render, stays in every
      // shader's defines, and toggling intensity is a uniform write — no
      // _resyncMeshes churn over the whole scene per acquire/release.
      light.intensity = 0;
      this.entries.push({ light, inUse: false, priority: LightPriority.LOW, generation: 0, expiresAt: null });
    }
    scene.onBeforeRenderObservable.add(() => this.sweepExpired());
  }

  /**
   * Acquire a pooled light. Optional ttlSeconds auto-releases the handle after
   * the given time (refreshable via setTtl) — use for fire-and-forget flashes.
   */
  public acquire(priority: LightPriority, ttlSeconds?: number): LightHandle {
    let entry: PoolEntry | undefined = this.entries.find((e) => !e.inUse);
    if (!entry) {
      let lowest: PoolEntry | null = null;
      for (const e of this.entries) {
        if (e.priority < priority && (lowest === null || e.priority < lowest.priority)) {
          lowest = e;
        }
      }
      if (!lowest) {
        return LightHandle.inert();
      }
      lowest.generation++; // stolen owner's handle goes inert
      entry = lowest;
    }
    entry.inUse = true;
    entry.priority = priority;
    entry.expiresAt = ttlSeconds !== undefined ? performance.now() + ttlSeconds * 1000 : null;
    entry.light.intensity = 0; // owner sets intensity/position via the handle
    return new LightHandle(entry, entry.generation);
  }

  static releaseEntry(entry: PoolEntry): void {
    // Intensity-park only (see constructor) — no setEnabled churn
    entry.light.intensity = 0;
    entry.light.position.set(0, -10000, 0);
    entry.inUse = false;
    entry.expiresAt = null;
    entry.generation++;
  }

  private sweepExpired(): void {
    const now = performance.now();
    for (const e of this.entries) {
      if (e.inUse && e.expiresAt !== null && now >= e.expiresAt) {
        LightManager.releaseEntry(e);
      }
    }
  }
}
