import { Game } from '../managers/Game';
import { GameClock } from '../utils/GameClock';

/**
 * Dev/debug HUD, enabled with ?debug=1 (composes with ?perf=1 and ?seed=).
 * Read-only: pulls state through the same public getters the headless drivers
 * use and repaints on a wall-clock interval (UI repaint cadence is wall-clock
 * by convention; only gameplay logic runs on GameClock).
 */
export class DebugOverlay {
  private readonly el: HTMLElement;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly game: Game) {
    this.el = document.createElement('pre');
    this.el.id = 'debug-overlay';
    this.el.style.cssText = [
      'position:fixed',
      'left:8px',
      'bottom:8px',
      'z-index:10000',
      'margin:0',
      'padding:6px 8px',
      'font:10px/1.45 monospace',
      'color:#9f9',
      'background:rgba(0,0,0,0.55)',
      'border:1px solid rgba(0,255,0,0.25)',
      'border-radius:4px',
      'pointer-events:none',
      'white-space:pre',
    ].join(';');
    document.body.appendChild(this.el);
    this.timer = setInterval(() => this.repaint(), 250);
  }

  private repaint(): void {
    try {
      const g = this.game;
      const bomber = g.getBomber();
      const cam = g.getCameraController();
      const ai = g.getAIController();
      if (!bomber || !cam || !ai) return;

      const pos = bomber.getPositionRef();
      const threat = g.getClosestIskanderThreatDistance();
      const lines = [
        `seed ${g.getWorldSeed()}  clock ${GameClock.now().toFixed(1)}s  fps ${Math.round(g.getScene().getEngine().getFps())}`,
        `pos ${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)}  hp ${g.getBomberHealth().toFixed(0)}%`,
        `ai ${ai.isEnabled() ? ai.getStateLabel() : 'OFF'}${ai.isSuspended() ? ' (suspended)' : ''}`,
        `view ${cam.getViewMode()}  rocket ${cam.getRocketSubState()}  panic ${cam.getPanicSubState()}`,
        `isk ${g.getIskanderMissiles().length}  def ${g.getDefenseMissiles().length}` +
          `  toma ${bomber.getMissiles().length}  bombs ${g.getBombCount()}`,
        `threat ${Number.isFinite(threat) ? threat.toFixed(0) + 'u' : '—'}`,
      ];
      this.el.textContent = lines.join('\n');
    } catch {
      // Never let the debug HUD take the game down (e.g. mid-teardown reads)
    }
  }

  public dispose(): void {
    clearInterval(this.timer);
    this.el.remove();
  }
}
