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
  BOMB_RUN = 'BOMB RUN',
}

/**
 * Autopilot: flies the bomber to nearby targets, runs bombing passes, fires
 * tomahawks at defense launchers and pops flares (with evasive weaving) when
 * Iskanders threaten. Issues all commands through InputManager's AI virtual
 * controls, so the existing weapon handlers keep enforcing every cooldown and
 * safety gate.
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
  private weavePhase: number = 0;
  private sawRunActive: boolean = false;

  private readonly targetScanRadius = 500; // matches radar range
  private readonly targetScanInterval = 1; // seconds between building queries
  private readonly cruiseAltitude = 200;
  private readonly altitudeDeadband = 5;
  private readonly headingDeadband = 0.04; // rad; > per-frame turn step (0.5 * 1/60)
  // Bombs fall straight down; the 9-bomb stick lands 25-225 units past run start
  // at speed 25, so starting 125 units short centers the stick on the target.
  private readonly bombLeadDistance = 125;
  private readonly bombHeadingTolerance = 0.12; // rad; cross-track ~15 u at lead distance, blast radius is 75
  private readonly standoffTurnDistance = 250; // orbit out when bombing is on cooldown
  private readonly tomahawkHoldDistance = 200; // don't tie up the bomb bay this close to a run
  private readonly manualOverrideGrace = 2.5; // seconds the AI yields after manual input
  private readonly weavePeriod = 2; // seconds per evasive S-turn
  // Hold flares until the missile is this close. Its seeker grabs flares within
  // 225 u (flareDetectionRange 150 × 1.5), so releasing at 300 u puts fresh flares
  // in seeker range within ~1 s instead of spending the burn while it's far out.
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
      this.manualOverrideUntil = -Infinity;
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
    this.holdAltitude();

    // Evasive weave replaces normal steering while threatened, except on a bomb
    // run where wings must stay level over the target
    if (underThreat && this.state !== AIState.BOMB_RUN) {
      this.weavePhase += deltaTime;
      const turnRight = this.weavePhase % this.weavePeriod < this.weavePeriod / 2;
      this.inputManager.setAIControl(turnRight ? 'turnRight' : 'turnLeft', true);
      return;
    }

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
    let nearest: Building | null = null;
    let nearestDistanceSq = Infinity;
    for (const building of buildings) {
      if (building.isTarget() && !building.getIsDestroyed()) {
        const distanceSq = Vector3.DistanceSquared(bomberPosition, building.getPosition());
        if (distanceSq < nearestDistanceSq) {
          nearestDistanceSq = distanceSq;
          nearest = building;
        }
      }
    }
    if (nearest) {
      this.currentTarget = nearest;
    }
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
    const altitudeError = this.bomber.getPositionRef().y - this.cruiseAltitude;
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
