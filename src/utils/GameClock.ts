/**
 * Pausable game clock. Game's loop advances it by the CLAMPED deltaTime once
 * per frame, only while the game is actually running (post-splash, pre-game-
 * over) — so gameplay time freezes with the simulation.
 *
 * Every gameplay cooldown, schedule and linger sweep reads THIS clock, never
 * performance.now(): wall-clock timers kept running through a hidden tab
 * (rAF stopped, sim frozen), so returning from a 60s tab-away meant every
 * cooldown was ready and an Iskander fired instantly. Frame-cadence throttles
 * (UI repaint intervals) and FX bookkeeping stay on the wall clock on purpose.
 *
 * Static like the other app-level singletons (AudioManager, EffectTextures);
 * starts at 0, and -Infinity "last fired" defaults still work naturally.
 */
export class GameClock {
  private static currentTime = 0;

  /** Seconds of accumulated (clamped) game time. */
  static now(): number {
    return GameClock.currentTime;
  }

  /** Advance by one frame's clamped delta — Game's loop only. */
  static advance(deltaSeconds: number): void {
    GameClock.currentTime += deltaSeconds;
  }
}
