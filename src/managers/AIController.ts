import { Vector3 } from '@babylonjs/core';
import { Bomber } from '../entities/Bomber';
import { Building } from '../entities/Building';
import { DefenseMissile } from '../entities/DefenseMissile';
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
 * tomahawks at defense launchers, and defends itself with a split by threat
 * type — defense missiles fly straight after a launch-time lead prediction, so
 * a hard perpendicular turn defeats them (CPA check + steering override below);
 * Iskanders are seeker-guided and can't be out-turned, so flares remain the
 * sole response to them. Cruise altitude wanders randomly inside the flyable
 * band so launch-time lead prediction is never systematically right.
 * Issues all commands through InputManager's AI virtual controls, so the
 * existing weapon handlers keep enforcing every cooldown and safety gate.
 */
export class AIController {
  private game: Game;
  private bomber: Bomber;
  private terrainManager: TerrainManager;
  private inputManager: InputManager;

  private enabled: boolean = false;
  private state: AIState = AIState.SEARCH;
  private currentTarget: Building | null = null;
  private lastTargetScanTime: number = -Infinity;
  private manualOverrideUntil: number = -Infinity;
  private sawRunActive: boolean = false;
  private extendAnchor: Vector3 | null = null;

  private readonly targetScanRadius = 500; // matches radar range
  private readonly targetScanInterval = 1; // seconds between building queries
  // Altitude wander: defense missiles can now outclimb the bomber's 200 ceiling,
  // so there is no altitude to hide at. Instead the AI re-rolls a random cruise
  // target inside [wanderFloor, wanderCeiling] every 8-15 s. The band stays 18 u
  // off the bomber's 150 floor ("not too close to the minimum") and one deadband
  // off the 200 ceiling so the clamp is never pegged.
  private altitudeTarget = 185;
  private nextAltitudeRetargetTime = -Infinity;
  private readonly wanderFloor = 168;
  private readonly wanderCeiling = 195;
  private readonly altitudeRetargetMin = 8; // seconds
  private readonly altitudeRetargetSpan = 7; // seconds of random extra
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

  // Defense-missile evasion. A defense missile is aimed once at launch (lead
  // prediction + random error) and then flies straight, so it's evaded by
  // breaking perpendicular to its path the moment a closest-point-of-approach
  // check says it would pass inside the danger radius.
  private evading = false;
  private evadeThreat: DefenseMissile | null = null;
  private readonly evadeHorizon = 4; // seconds of look-ahead; a 90° break takes ~3.1 s
  private readonly evadeMissDistance = 40; // u; 20 u proximity-damage radius + aim-error margin

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
      this.evading = false;
      this.evadeThreat = null;
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

    // Detect inbound defense missiles before the state machine runs so NAVIGATE
    // can hold its bomb press while a break turn is about to hijack the heading
    this.updateEvasionThreat();

    this.scanForTarget(currentTime);
    this.handleTomahawk();

    if (currentTime >= this.nextAltitudeRetargetTime) {
      this.altitudeTarget = this.wanderFloor + Math.random() * (this.wanderCeiling - this.wanderFloor);
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

    // Steering override LAST so it wins over whatever the state machine pressed.
    // The states keep progressing underneath (scan timers, extend anchors, run
    // watchers) and resume seamlessly once the threat passes.
    if (this.evading) {
      this.applyEvasionSteering();
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
    let nearest: Building | null = null;
    let nearestDistanceSq = Infinity;
    let nearestReachable: Building | null = null;
    let nearestReachableDistanceSq = Infinity;
    for (const building of buildings) {
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
    for (const side of [1, -1]) {
      const dx = targetPosition.x - (position.x + perpX * side);
      const dz = targetPosition.z - (position.z + perpZ * side);
      if (dx * dx + dz * dz < minDistanceSq) {
        return false;
      }
    }
    return true;
  }

  private handleTomahawk(): void {
    if (this.state === AIState.BOMB_RUN || !this.bomber.canLaunchMissile()) {
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
      this.game.isBombingAvailable() &&
      // Don't start a run on the same frame a break turn hijacks the heading —
      // the 9-bomb stick would scatter along the evasion arc
      !this.evading
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

  /**
   * Closest-point-of-approach sweep over live defense missiles. Bomber velocity
   * must be included: missiles are lead-aimed at the bomber's FUTURE position, so
   * a bomber-stationary check would classify true intercepts as clean misses.
   * Re-evaluated every frame; the break turn itself grows the predicted miss past
   * the threshold within ~1-2 s, which is what ends the evasion.
   */
  private updateEvasionThreat(): void {
    this.evading = false;
    this.evadeThreat = null;

    const bomberPosition = this.bomber.getPositionRef();
    const bomberVelocity = this.bomber.getVelocityRef();
    const missDistanceSq = this.evadeMissDistance * this.evadeMissDistance;
    let soonestCpaTime = Infinity;

    for (const missile of this.game.getDefenseMissiles()) {
      if (!missile.isLaunched() || missile.hasExploded()) continue;

      const missilePosition = missile.getPositionRef();
      const missileVelocity = missile.getVelocityRef();
      const rx = missilePosition.x - bomberPosition.x;
      const ry = missilePosition.y - bomberPosition.y;
      const rz = missilePosition.z - bomberPosition.z;
      const vx = missileVelocity.x - bomberVelocity.x;
      const vy = missileVelocity.y - bomberVelocity.y;
      const vz = missileVelocity.z - bomberVelocity.z;
      const closingSpeedSq = vx * vx + vy * vy + vz * vz;
      // Pre-trajectory missiles still have zero velocity; skip them
      if (closingSpeedSq < 1e-6) continue;

      const cpaTime = -(rx * vx + ry * vy + rz * vz) / closingSpeedSq;
      if (cpaTime <= 0 || cpaTime > this.evadeHorizon || cpaTime >= soonestCpaTime) continue;

      const cx = rx + vx * cpaTime;
      const cy = ry + vy * cpaTime;
      const cz = rz + vz * cpaTime;
      if (cx * cx + cy * cy + cz * cz < missDistanceSq) {
        soonestCpaTime = cpaTime;
        this.evading = true;
        this.evadeThreat = missile;
      }
    }
  }

  /**
   * Break perpendicular to the threat's path, on the side of the path line the
   * bomber already occupies — that grows the existing miss distance fastest, and
   * the missile cannot correct after launch.
   */
  private applyEvasionSteering(): void {
    if (!this.evadeThreat) return;

    // steerToward only SETS flags (and sets nothing inside its deadband), so the
    // state machine's earlier presses must be cleared explicitly to be overridden
    this.inputManager.setAIControl('turnLeft', false);
    this.inputManager.setAIControl('turnRight', false);

    const bomberPosition = this.bomber.getPositionRef();
    const missilePosition = this.evadeThreat.getPositionRef();
    const missileVelocity = this.evadeThreat.getVelocityRef();
    const relX = bomberPosition.x - missilePosition.x;
    const relZ = bomberPosition.z - missilePosition.z;
    // Sign of the horizontal cross product = which side of the path line we're on
    const side = relX * missileVelocity.z - relZ * missileVelocity.x >= 0 ? 1 : -1;
    const missileHeading = Math.atan2(missileVelocity.x, missileVelocity.z);
    this.steerToward(missileHeading + (side * Math.PI) / 2);
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
