import { Vector3 } from '@babylonjs/core';
import { Bomber } from '../entities/Bomber';
import { Building } from '../entities/Building';
import { InputManager } from './InputManager';
import { TerrainManager } from './TerrainManager';
import { Game } from './Game';

enum AIState {
  SEARCH = 'SEARCH',
  NAVIGATE = 'NAVIGATE',
  STANDOFF = 'STANDOFF',
  EXTEND = 'EXTEND',
  BOMB_RUN = 'BOMB RUN',
}

/**
 * Autopilot: flies the bomber to nearby targets, runs bombing passes, fires
 * tomahawks at defense launchers, and pops flares when Iskanders threaten.
 * Cruise altitude wanders randomly inside the flyable band so launch-time
 * lead prediction is never systematically right.
 * Issues all commands through InputManager's AI virtual controls, so the
 * existing weapon handlers keep enforcing every cooldown and safety gate.
 */
export class AIController {
  // Both fixed-rate turning circles; hoisted so isPositionReachable allocates nothing
  private static readonly turnSides: readonly number[] = [1, -1];

  private game: Game;
  private bomber: Bomber;
  private terrainManager: TerrainManager;
  private inputManager: InputManager;

  private enabled: boolean = false;
  private state: AIState = AIState.SEARCH;
  private currentTarget: Building | null = null;
  private lastTargetScanTime: number = -Infinity;
  // Refreshed by each 1 Hz scan; gates the missile press so the launch handler's
  // 60 Hz building query only runs when a launcher can actually be acquired.
  // Up to 1 s stale either way, which is fine: the launch path re-validates.
  private launcherInRange = false;
  private manualOverrideUntil: number = -Infinity;
  private sawRunActive: boolean = false;
  private extendAnchor: Vector3 | null = null;

  private readonly targetScanRadius = 500; // matches radar range
  private readonly targetScanInterval = 1; // seconds between building queries
  // Altitude wander: defense missiles can now outclimb the bomber's 200 ceiling,
  // so there is no altitude to hide at. Every ~6-11 s the AI retargets to the
  // OPPOSITE extreme of [wanderFloor, wanderCeiling] (see update()), so each change
  // is a large ~30-46 u swing rather than a small re-roll. The band stays ~one
  // deadband off the 150 floor and 200 ceiling so the clamp is never pegged.
  private altitudeTarget = 185;
  private nextAltitudeRetargetTime = -Infinity;
  private readonly wanderFloor = 152;
  private readonly wanderCeiling = 198;
  private readonly altitudeRetargetMin = 5.9; // seconds (8/1.35 — retarget 35% more often)
  private readonly altitudeRetargetSpan = 5.2; // seconds of random extra (7/1.35)
  private readonly altitudeDeadband = 5;
  private readonly headingDeadband = 0.04; // rad; > per-frame turn step (0.5 * 1/60)
  // Bombs fall straight down; the 9-bomb stick lands 25-225 units past run start
  // at speed 25, so starting 125 units short centers the stick on the target.
  private readonly bombLeadDistance = 125;
  private readonly bombHeadingTolerance = 0.12; // rad; cross-track ~15 u at lead distance, blast radius is 75
  private readonly standoffTurnDistance = 250; // orbit out when bombing is on cooldown
  // Fixed-rate turn circle: Bomber speed (25) / turnSpeed (0.5). A target inside
  // either turning circle can never be aligned with by pure pursuit.
  private readonly turnRadius = 50;
  private readonly reachabilityMargin = 1.2; // boundary-grazing targets are practically unreachable too
  private readonly reattackDistance = 250; // extend out at least this far before turning back in
  private readonly tomahawkHoldDistance = 200; // don't tie up the bomb bay this close to a run
  private readonly manualOverrideGrace = 2.5; // seconds the AI yields after manual input
  // Hold flares until the missile is this close. Its seeker grabs flares within
  // 225 u (flareDetectionRange 150 × 1.5), so releasing at 300 u puts fresh flares
  // in seeker range within ~1 s instead of spending the burn while it's far out.
  // Flares are the ONLY Iskander response: their seeker turns at 1.25-3.5 rad/s
  // vs the bomber's 0.5, so steering evasion can't work against them.
  private readonly flareReleaseRange = 300;

  constructor(game: Game, bomber: Bomber, terrainManager: TerrainManager, inputManager: InputManager) {
    this.game = game;
    this.bomber = bomber;
    this.terrainManager = terrainManager;
    this.inputManager = inputManager;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.inputManager.clearAIControls();
      this.state = AIState.SEARCH;
      this.currentTarget = null;
      this.sawRunActive = false;
      this.extendAnchor = null;
      this.manualOverrideUntil = -Infinity;
      this.nextAltitudeRetargetTime = -Infinity; // re-roll the wander target on re-enable
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public isSuspended(): boolean {
    return this.enabled && performance.now() / 1000 < this.manualOverrideUntil;
  }

  public getStateLabel(): string {
    return this.state;
  }

  public update(deltaTime: number, currentTime: number): void {
    // All outputs are recomputed every frame, so the bomb press is a one-frame pulse
    this.inputManager.clearAIControls();

    if (!this.enabled) {
      return;
    }

    // Manual input wins: yield completely but stay enabled — the toggle button is
    // the explicit off switch, and incidental touches shouldn't kill the autopilot
    if (this.inputManager.isManualFlightInputActive()) {
      this.manualOverrideUntil = currentTime + this.manualOverrideGrace;
    }
    if (currentTime < this.manualOverrideUntil) {
      return;
    }

    const underThreat = this.game.hasIskanderMissilesForAlert();
    if (underThreat && this.game.getClosestIskanderThreatDistance() <= this.flareReleaseRange) {
      this.inputManager.setAIControl('countermeasure', true);
    }

    this.scanForTarget(currentTime);
    this.handleTomahawk();

    if (currentTime >= this.nextAltitudeRetargetTime) {
      // Swing to the opposite extreme of the band (with small jitter) so every
      // altitude change is large rather than an occasional near-zero re-roll.
      const mid = (this.wanderFloor + this.wanderCeiling) / 2;
      const goLow = this.bomber.getPositionRef().y > mid;
      this.altitudeTarget = goLow
        ? this.wanderFloor + Math.random() * 8
        : this.wanderCeiling - Math.random() * 8;
      this.nextAltitudeRetargetTime =
        currentTime + this.altitudeRetargetMin + Math.random() * this.altitudeRetargetSpan;
    }
    this.holdAltitude();

    switch (this.state) {
      case AIState.SEARCH:
        // Fly straight; terrain and targets stream in ahead while scans continue
        if (this.currentTarget) {
          this.state = AIState.NAVIGATE;
        }
        break;

      case AIState.NAVIGATE:
        this.updateNavigate();
        break;

      case AIState.STANDOFF:
        this.updateStandoff();
        break;

      case AIState.EXTEND:
        this.updateExtend();
        break;

      case AIState.BOMB_RUN:
        this.updateBombRun();
        break;
    }
  }

  private scanForTarget(currentTime: number): void {
    if (this.state === AIState.BOMB_RUN) return;

    // Drop a target that was destroyed (e.g. by a tomahawk) between scans
    if (this.currentTarget && this.currentTarget.getIsDestroyed()) {
      this.currentTarget = null;
      if (this.state !== AIState.SEARCH) {
        this.state = AIState.SEARCH;
      }
    }

    if (currentTime - this.lastTargetScanTime < this.targetScanInterval) {
      return;
    }
    this.lastTargetScanTime = currentTime;

    const bomberPosition = this.bomber.getPositionRef();
    const buildings = this.terrainManager.getBuildingsInRadiusSync(bomberPosition, this.targetScanRadius);
    // The scan radius (500) is a superset of the tomahawk acquisition range (300),
    // so this pass also answers "is any launcher acquirable?" — launchers aren't
    // necessarily isTarget() buildings, so check every building independently
    const acquisitionRangeSq = this.bomber.getDefenseAcquisitionRange() ** 2;
    this.launcherInRange = false;
    let nearest: Building | null = null;
    let nearestDistanceSq = Infinity;
    let nearestReachable: Building | null = null;
    let nearestReachableDistanceSq = Infinity;
    for (const building of buildings) {
      if (
        !this.launcherInRange &&
        building.isDefenseLauncher() &&
        !building.getIsDestroyed() &&
        Vector3.DistanceSquared(bomberPosition, building.getPosition()) <= acquisitionRangeSq
      ) {
        this.launcherInRange = true;
      }
      if (building.isTarget() && !building.getIsDestroyed()) {
        const distanceSq = Vector3.DistanceSquared(bomberPosition, building.getPosition());
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearest = building;
        }
        if (distanceSq < nearestReachableDistanceSq && this.isPositionReachable(building.getPosition())) {
          nearestReachableDistanceSq = distanceSq;
          nearestReachable = building;
        }
      }
    }
    // Stick with a still-viable target (in radius and reachable): the turning
    // circles sweep with heading, so re-ranking every scan would churn between
    // buildings mid-approach
    if (
      this.currentTarget &&
      Vector3.DistanceSquared(bomberPosition, this.currentTarget.getPosition()) <=
        this.targetScanRadius * this.targetScanRadius &&
      this.isPositionReachable(this.currentTarget.getPosition())
    ) {
      return;
    }
    const next = nearestReachable ?? nearest;
    if (next) {
      this.currentTarget = next;
    }
  }

  /**
   * A target inside either fixed-rate turning circle (centers abeam at turnRadius)
   * can never be aligned with by pure pursuit — the bomber would orbit it forever.
   */
  private isPositionReachable(targetPosition: Vector3): boolean {
    const position = this.bomber.getPositionRef();
    const yaw = this.bomber.getRotationRef().y;
    // Heading is (sin yaw, cos yaw); perpendicular-right is (cos yaw, -sin yaw)
    const perpX = Math.cos(yaw) * this.turnRadius;
    const perpZ = -Math.sin(yaw) * this.turnRadius;
    const minDistanceSq = (this.reachabilityMargin * this.turnRadius) ** 2;
    for (const side of AIController.turnSides) {
      const dx = targetPosition.x - (position.x + perpX * side);
      const dz = targetPosition.z - (position.z + perpZ * side);
      if (dx * dx + dz * dz < minDistanceSq) {
        return false;
      }
    }
    return true;
  }

  private handleTomahawk(): void {
    if (this.state === AIState.BOMB_RUN || !this.launcherInRange || !this.bomber.canLaunchMissile()) {
      return;
    }
    // The launch handler self-acquires the nearest defense launcher within range;
    // just avoid tying up the bomb bay when a bombing run is imminent
    const distance = this.currentTarget ? this.distanceToTarget() : Infinity;
    if (distance > this.tomahawkHoldDistance) {
      this.inputManager.setAIControl('missile', true);
    }
  }

  private holdAltitude(): void {
    const altitudeError = this.bomber.getPositionRef().y - this.altitudeTarget;
    if (altitudeError < -this.altitudeDeadband) {
      this.inputManager.setAIControl('altitudeUp', true);
    } else if (altitudeError > this.altitudeDeadband) {
      this.inputManager.setAIControl('altitudeDown', true);
    }
  }

  private updateNavigate(): void {
    if (!this.currentTarget) {
      this.state = AIState.SEARCH;
      return;
    }

    // A target inside the turning circle would orbit forever; extend out and re-attack
    if (!this.isPositionReachable(this.currentTarget.getPosition())) {
      this.extendAnchor = this.currentTarget.getPosition().clone();
      this.state = AIState.EXTEND;
      return;
    }

    const headingError = this.steerToward(this.headingToTarget());
    const distance = this.distanceToTarget();

    if (
      distance <= this.bombLeadDistance &&
      Math.abs(headingError) < this.bombHeadingTolerance &&
      this.game.isBombingAvailable()
    ) {
      this.inputManager.setAIControl('bomb', true);
      this.sawRunActive = false;
      this.state = AIState.BOMB_RUN;
    } else if (distance < this.standoffTurnDistance && !this.game.isBombingAvailable()) {
      this.state = AIState.STANDOFF;
    }
  }

  private updateStandoff(): void {
    if (!this.currentTarget) {
      this.state = AIState.SEARCH;
      return;
    }
    if (this.game.isBombingAvailable()) {
      this.state = AIState.NAVIGATE;
      return;
    }
    // Gentle orbit around the target until the bombing cooldown is ready
    this.steerToward(this.headingToTarget() + Math.PI / 2);
  }

  private updateExtend(): void {
    if (!this.currentTarget || !this.extendAnchor) {
      this.extendAnchor = null;
      this.state = AIState.SEARCH;
      return;
    }
    // The scan may have swapped in a viable target far enough for a clean turn-in.
    // (Reachable alone isn't enough: the original target sits "behind" us within
    // seconds of turning away, and turning back that early re-traps it.)
    if (
      this.distanceToTarget() >= this.reattackDistance &&
      this.isPositionReachable(this.currentTarget.getPosition())
    ) {
      this.extendAnchor = null;
      this.state = AIState.NAVIGATE;
      return;
    }
    const position = this.bomber.getPositionRef();
    const dx = position.x - this.extendAnchor.x;
    const dz = position.z - this.extendAnchor.z;
    if (dx * dx + dz * dz >= this.reattackDistance * this.reattackDistance) {
      this.extendAnchor = null;
      this.state = AIState.NAVIGATE;
      return;
    }
    // Steer away from the anchor (not currentTarget) so scan churn can't whipsaw us
    this.steerToward(Math.atan2(dx, dz));
  }

  private updateBombRun(): void {
    // Wings level toward the target while the stick drops
    if (this.currentTarget && !this.currentTarget.getIsDestroyed()) {
      this.steerToward(this.headingToTarget());
    }

    // The run flag goes up a frame after the bomb press, so wait until we've
    // seen it active before treating inactive as "run complete"
    if (this.game.isBombingRunActive()) {
      this.sawRunActive = true;
    } else if (this.sawRunActive) {
      this.sawRunActive = false;
      this.state = AIState.SEARCH;
    }
  }

  private headingToTarget(): number {
    const position = this.bomber.getPositionRef();
    const targetPosition = this.currentTarget!.getPosition();
    // Heading convention matches Bomber velocity: yaw measured from +Z
    return Math.atan2(targetPosition.x - position.x, targetPosition.z - position.z);
  }

  private distanceToTarget(): number {
    const position = this.bomber.getPositionRef();
    const targetPosition = this.currentTarget!.getPosition();
    const dx = targetPosition.x - position.x;
    const dz = targetPosition.z - position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Presses turn controls toward the desired heading; returns the wrapped heading error. */
  private steerToward(desiredHeading: number): number {
    let error = desiredHeading - this.bomber.getRotationRef().y;
    error = ((((error + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    if (error > this.headingDeadband) {
      this.inputManager.setAIControl('turnRight', true);
    } else if (error < -this.headingDeadband) {
      this.inputManager.setAIControl('turnLeft', true);
    }
    return error;
  }
}
