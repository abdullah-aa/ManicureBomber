import { GameClock } from './GameClock';

/**
 * Game-time cooldown. Replaces the hand-rolled lastTime/cooldownTime/status
 * triple that was independently implemented for bombing runs, Tomahawks and
 * flares. Starts ready (lastFired = -Infinity).
 */
export class Cooldown {
  private lastFired = -Infinity;

  constructor(private readonly durationSeconds: number) {}

  ready(): boolean {
    return GameClock.now() - this.lastFired >= this.durationSeconds;
  }

  /** Stamp the cooldown as just used. */
  fire(): void {
    this.lastFired = GameClock.now();
  }

  /** Atomically check-and-fire; false if still cooling down. */
  tryFire(): boolean {
    if (!this.ready()) return false;
    this.fire();
    return true;
  }

  /** 0..1 recharge progress for cooldown UI fills (1 = ready). */
  status(): number {
    return Math.min((GameClock.now() - this.lastFired) / this.durationSeconds, 1);
  }
}
