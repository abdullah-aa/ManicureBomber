import { Bomber } from '../entities/Bomber';
import { Building } from '../entities/Building';
import { IskanderMissile } from '../entities/IskanderMissile';
import { DefenseMissile } from '../entities/DefenseMissile';
import {
  RocketViewCandidate,
  RocketViewKind,
  PanicViewCandidate,
  PanicViewKind,
} from './CameraController';

/**
 * Rocket View cinematography direction: chooses what the camera should NEWLY
 * acquire each frame. Extracted from Game (which owns the missile arrays and
 * launch scheduling); camera state is read through closures so this module
 * stays camera-agnostic (house provider-closure pattern).
 */
export class CinematicCandidateProvider {
  // Reused descriptor — the camera copies its fields out synchronously, so a
  // single instance avoids per-frame allocation. anchorX/anchorZ are only
  // meaningful for anchor-only kinds (IskanderPrelaunch).
  private readonly rocketCandidate: RocketViewCandidate = {
    missile: null,
    kind: RocketViewKind.Iskander,
    anchorX: 0,
    anchorZ: 0,
  };

  constructor(
    private readonly bomber: Bomber,
    // Live array refs from the ProjectileRegistry — mutated in place
    // (push/splice), identity is stable for the game's lifetime.
    private readonly iskanderMissiles: readonly IskanderMissile[],
    private readonly defenseMissiles: readonly DefenseMissile[],
    private readonly getPendingIskanderLauncher: () => Building | null,
    private readonly isInTomahawkSequence: () => boolean,
  ) {}

  /**
   * Candidate for Rocket View to NEWLY acquire. Priority: Iskanders > Iskander
   * prelaunch dwell > Tomahawks > Tomahawk bay-open > defense missiles (the
   * camera generalizes this into a preemption chain; the live missile displacing
   * its own anchor-only precursor IS the prelaunch→launch / bay→drop handoff).
   *
   * Acquisition windows differ by kind: an Iskander is acquirable its whole life;
   * a Tomahawk only during its bomb-bay launch animation (isInLaunchPhase); a
   * defense missile only in its on-pad window (velocity still (0,0,0) before the
   * async trajectory worker replies). So the camera catches Tomahawks/Defense at
   * launch and shows the full lifecycle rather than snapping onto one already
   * mid-flight; once followed, it keeps the missile regardless. The anchor-only
   * kinds carry no missile: IskanderPrelaunch frames the pre-selected launcher
   * (anchorX/anchorZ) and TomahawkBay frames the bomber's bay while the doors
   * open. Returns a single reused descriptor (the camera copies its fields out).
   */
  public getRocketViewCandidate(): RocketViewCandidate | null {
    // While the camera is committed to a Tomahawk sequence, withhold Iskander
    // candidates: the tomahawk story plays to impact + explosion hold first.
    if (!this.isInTomahawkSequence()) {
      for (const missile of this.iskanderMissiles) {
        if (missile.isLaunched() && !missile.hasExploded()) {
          this.rocketCandidate.missile = missile;
          this.rocketCandidate.kind = RocketViewKind.Iskander;
          return this.rocketCandidate;
        }
      }
      // Nulled at fire time, so the dwell ends the instant the real missile exists.
      const pending = this.getPendingIskanderLauncher();
      if (pending && !pending.getIsDestroyed()) {
        const p = pending.getPosition();
        this.rocketCandidate.missile = null;
        this.rocketCandidate.kind = RocketViewKind.IskanderPrelaunch;
        this.rocketCandidate.anchorX = p.x;
        this.rocketCandidate.anchorZ = p.z;
        return this.rocketCandidate;
      }
    }
    for (const missile of this.bomber.getMissiles()) {
      // Catch the Tomahawk only during its launch pop-up, then the follow persists.
      if (!missile.hasExploded() && missile.isInLaunchPhase()) {
        this.rocketCandidate.missile = missile;
        this.rocketCandidate.kind = RocketViewKind.Tomahawk;
        return this.rocketCandidate;
      }
    }
    // Bay doors opening for a Tomahawk that doesn't exist yet (clears on spawn or abort).
    if (this.bomber.isMissileLaunchPending()) {
      this.rocketCandidate.missile = null;
      this.rocketCandidate.kind = RocketViewKind.TomahawkBay;
      return this.rocketCandidate;
    }
    for (const missile of this.defenseMissiles) {
      if (missile.isLaunched() && !missile.hasExploded() && missile.getVelocityRef().lengthSquared() === 0) {
        this.rocketCandidate.missile = missile;
        this.rocketCandidate.kind = RocketViewKind.Defense;
        return this.rocketCandidate;
      }
    }
    return null;
  }
}

/**
 * Panic View story direction: WHAT story is being told and its anchor, with
 * explicit begin/end transitions. The camera keeps the HOW (sub-states, poses,
 * holds). Owns the previously-smeared Game.panicBombingBuilding.
 */
export class PanicStory {
  // The bombing-run target captured at trigger time — the camera's story
  // anchor. Sticky on purpose: mid-run AI retargets never yank the victim's
  // viewpoint. Cleared when the run is over and the stick has landed.
  private bombingBuilding: Building | null = null;

  // The Iskander the chase story follows — sticky once offered (bombingBuilding
  // precedent) so the camera's subject is referentially stable; its explosion
  // clears it and ends the story. The NEXT inbound missile gets a fresh
  // acquisition after the camera's hold — no mid-story swap.
  private chaseIskander: IskanderMissile | null = null;

  // Reused descriptor (rocketCandidate's pattern).
  private readonly panicCandidate: PanicViewCandidate = {
    kind: PanicViewKind.Bombing,
    missile: null,
    anchorX: 0,
    anchorZ: 0,
    topY: 0,
  };

  constructor(
    private readonly bomber: Bomber,
    // Live array ref from the ProjectileRegistry — mutated in place, stable identity.
    private readonly iskanderMissiles: readonly IskanderMissile[],
    /** The story kind the camera is committed to (CameraController.getActivePanicKind). */
    private readonly getCommittedKind: () => PanicViewKind | null,
  ) {}

  /** Begin transition: called the instant a bombing run starts. */
  public beginBombingRun(target: Building | null): void {
    this.bombingBuilding = target;
  }

  /**
   * End transition: the bombing story ends only when the run is over AND the
   * stick has landed (bombsAloft alone is also false during the bay-open window).
   */
  public endBombingStoryIfComplete(runActive: boolean, bombsAloft: boolean): void {
    if (this.bombingBuilding && !runActive && !bombsAloft) {
      this.bombingBuilding = null;
    }
  }

  /**
   * Candidate for Panic View. Kind-gated on the camera's committed story: no
   * preemption — the first story plays out, and returning null for the committed
   * kind IS the end-of-story signal (the camera enters its impact hold or
   * reverts). Block order encodes ACQUISITION priority: Bombing > Iskander >
   * Tomahawk (each block only runs when uncommitted or committed to that kind).
   * Bombing anchors to the sticky bombingBuilding; Iskander follows the sticky
   * cruising missile (anchorless — the camera's chase hangs off it); Tomahawk
   * anchors to the bomber's pending capture, then the missile's impact point.
   * Destroyed anchors are deliberately NOT filtered — the camera keeps watching
   * (the blast is the payoff); lifecycle clears end the story. Returns a single
   * reused descriptor (the camera copies its fields out).
   */
  public getCandidate(): PanicViewCandidate | null {
    const committed = this.getCommittedKind();
    // Bombing — highest acquisition priority.
    if (committed === null || committed === PanicViewKind.Bombing) {
      if (this.bombingBuilding) {
        const p = this.bombingBuilding.getPosition();
        this.panicCandidate.kind = PanicViewKind.Bombing;
        this.panicCandidate.missile = null;
        this.panicCandidate.anchorX = p.x;
        this.panicCandidate.anchorZ = p.z;
        this.panicCandidate.topY = p.y + this.bombingBuilding.getApexHeight();
        return this.panicCandidate;
      }
      if (committed === PanicViewKind.Bombing) {
        return null; // stick landed — story over
      }
    }
    // Iskander chase — outranks Tomahawk at acquisition. Only cruising missiles
    // (isClimbing() false): the vertical boost has no chase geometry yet, and
    // the launch spectacle already belongs to Rocket View. Never re-picks while
    // committed: if the sticky missile dies the story ends rather than swapping
    // (the camera's own explosion check normally fires first — the null return
    // is a backstop).
    if (committed === null || committed === PanicViewKind.Iskander) {
      if (this.chaseIskander && this.chaseIskander.hasExploded()) {
        this.chaseIskander = null;
      }
      if (this.chaseIskander === null && committed === null) {
        this.chaseIskander = this.pickClosestCruisingIskander();
      }
      if (this.chaseIskander) {
        this.panicCandidate.kind = PanicViewKind.Iskander;
        this.panicCandidate.missile = this.chaseIskander;
        this.panicCandidate.anchorX = 0; // chase kind is anchorless — the pose
        this.panicCandidate.anchorZ = 0; // hangs off the missile (PanicViewDirector)
        this.panicCandidate.topY = 0;
        return this.panicCandidate;
      }
      if (committed === PanicViewKind.Iskander) {
        return null; // missile gone — story over
      }
    }
    // Tomahawk: the pending window (bay doors opening), then the missile in flight.
    const pendingTarget = this.bomber.getPendingMissileTargetBuilding();
    if (pendingTarget) {
      const p = pendingTarget.getPosition();
      this.panicCandidate.kind = PanicViewKind.Tomahawk;
      this.panicCandidate.missile = null;
      this.panicCandidate.anchorX = p.x;
      this.panicCandidate.anchorZ = p.z;
      this.panicCandidate.topY = p.y + pendingTarget.getApexHeight();
      return this.panicCandidate;
    }
    for (const missile of this.bomber.getMissiles()) {
      if (!missile.hasExploded()) {
        const tp = missile.getTargetPosition();
        this.panicCandidate.kind = PanicViewKind.Tomahawk;
        this.panicCandidate.missile = missile;
        this.panicCandidate.anchorX = tp.x;
        this.panicCandidate.anchorZ = tp.z;
        this.panicCandidate.topY = tp.y;
        return this.panicCandidate;
      }
    }
    return null;
  }

  /** Closest cruising Iskander to the bomber — the most imminent threat reads best. */
  private pickClosestCruisingIskander(): IskanderMissile | null {
    const bp = this.bomber.getPositionRef();
    let best: IskanderMissile | null = null;
    let bestD = Infinity;
    for (const m of this.iskanderMissiles) {
      if (!m.isLaunched() || m.hasExploded() || m.isClimbing()) continue;
      const p = m.getPositionRef();
      const dx = p.x - bp.x;
      const dy = p.y - bp.y;
      const dz = p.z - bp.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }
}
