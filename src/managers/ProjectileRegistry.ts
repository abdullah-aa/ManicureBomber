import { IskanderMissile } from '../entities/IskanderMissile';
import { DefenseMissile } from '../entities/DefenseMissile';
import { TomahawkMissile } from '../entities/TomahawkMissile';

/** The one lifecycle probe every registered projectile shares. */
interface SweepableProjectile {
  hasExploded(): boolean;
}

/**
 * One projectile type's live list plus its exploded-linger bookkeeping — the
 * "explodedAt map + linger + splice" sweep that used to be copy-pasted across
 * Game (iskanders, defense missiles) and Bomber (tomahawks).
 */
class ProjectileChannel<T extends SweepableProjectile> {
  /** Live members, oldest first. Exposed by reference via the registry's typed accessors. */
  readonly live: T[] = [];
  private readonly explodedAt = new Map<T, number>();

  constructor(
    private readonly lingerSeconds: number,
    private readonly retire: (projectile: T) => void,
  ) {}

  add(projectile: T): void {
    this.live.push(projectile);
  }

  /** Stamp newly-exploded members; retire and remove those past their linger. */
  sweep(currentTime: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const projectile = this.live[i];
      if (!projectile.hasExploded()) continue;
      const explodedAt = this.explodedAt.get(projectile);
      if (explodedAt === undefined) {
        this.explodedAt.set(projectile, currentTime);
      } else if (currentTime - explodedAt > this.lingerSeconds) {
        this.retire(projectile);
        this.explodedAt.delete(projectile);
        this.live.splice(i, 1);
      }
    }
  }
}

/**
 * Owns registration, per-type linger, exploded-at bookkeeping and retirement
 * for every swept projectile. Per-frame UPDATE loops stay with their owners
 * (Game feeds iskanders flares, Bomber samples terrain under tomahawks) —
 * the registry only decides when a dead projectile leaves the world.
 *
 * Linger durations are per-type and deliberately different — do not harmonize:
 *  - Iskander 2s: lingering explosion effects finish before dispose()
 *  - Defense 1.5s: airburst finishes and Rocket View can hold on the blast;
 *    retired via release() — DefenseMissiles are POOLED (re-armed with a
 *    trajectoryGeneration token), so the registry tracks live pool members
 *    and must never dispose() them itself
 *  - Tomahawk 10s: lingering smoke trail finishes before dispose()
 *
 * Bomb is deliberately NOT registered: it never enters a linger sweep —
 * Game.updateBombs removes it the frame it detonates and Bomb.explode()
 * tears its ~13 meshes + trail down on its own setTimeout schedule.
 */
export class ProjectileRegistry {
  private readonly iskanders = new ProjectileChannel<IskanderMissile>(2, (m) => m.dispose());
  private readonly defense = new ProjectileChannel<DefenseMissile>(1.5, (m) => m.release());
  private readonly tomahawks = new ProjectileChannel<TomahawkMissile>(10, (m) => m.dispose());

  addIskander(missile: IskanderMissile): void {
    this.iskanders.add(missile);
  }

  addDefenseMissile(missile: DefenseMissile): void {
    this.defense.add(missile);
  }

  addTomahawk(missile: TomahawkMissile): void {
    this.tomahawks.add(missile);
  }

  // Typed accessors (live array references, not copies) — consumers do
  // type-specific work: radar draws different marker classes, guidance and
  // collision read type-specific state, camera candidates branch per kind.
  getIskanders(): IskanderMissile[] {
    return this.iskanders.live;
  }

  getDefenseMissiles(): DefenseMissile[] {
    return this.defense.live;
  }

  getTomahawks(): TomahawkMissile[] {
    return this.tomahawks.live;
  }

  /**
   * Once per frame, AFTER all per-type update loops (Game's loop calls it
   * right after updateDefenseMissiles). currentTime is GameClock time —
   * gameplay lingers must freeze with the sim, never performance.now().
   */
  sweep(currentTime: number): void {
    this.iskanders.sweep(currentTime);
    this.defense.sweep(currentTime);
    this.tomahawks.sweep(currentTime);
  }
}
