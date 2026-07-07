/**
 * Cross-file gameplay/rendering balance constants.
 *
 * Only numbers that form CONTRACTS BETWEEN FILES live here — the pairs and
 * chains that used to be kept in agreement by comments alone ("matches radar
 * range", "outranges the Tomahawk's 300"). Derived values are COMPUTED, not
 * duplicated, so changing a base value can't silently break its dependents.
 * Purely local tuning (camera pose offsets, particle colors, per-state AI
 * timings) stays in its own class — see the TUNABLE blocks there.
 *
 * Deliberately Babylon-free so web workers can import it (same rule as
 * worker-utils).
 */

// ------------------------------------------------------------- bomber flight
export const BOMBER_SPEED = 25; // units/second
export const BOMBER_TURN_RATE = 0.5; // radians/second
export const BOMBER_CLIMB_RATE = 20; // units/second
export const BOMBER_MIN_ALTITUDE = 150;
export const BOMBER_MAX_ALTITUDE = 200;

/** Fixed-rate turn circle. A target inside it can never be aligned with by
 *  pure pursuit — the AI's reachability math depends on this staying derived. */
export const BOMBER_TURN_RADIUS = BOMBER_SPEED / BOMBER_TURN_RATE; // 50

// --------------------------------------------------------- sensors & weapons
/** Radar UI range, AI target-scan radius, and the Iskander alert radius — one
 *  number so what the player sees, what the AI attacks, and what beeps agree. */
export const RADAR_RANGE = 500;

/** Defense-launcher detection range. Contract: must exceed
 *  TOMAHAWK_ACQUISITION_RANGE so launchers always get to fire first and a
 *  Tomahawk run is never free. */
export const LAUNCHER_RADAR_RANGE = 450;

/** How close the bomber must get to a launcher before a Tomahawk can lock it. */
export const TOMAHAWK_ACQUISITION_RANGE = 300;

// --------------------------------------------------------- iskander & flares
/** Base IR-seeker sensitivity of the Iskander. */
export const ISKANDER_FLARE_DETECTION_RANGE = 150;
/** Seeker sensitivity widening applied in guidance (real IR seekers grab
 *  decoys well outside their nominal cone). */
export const FLARE_SEEKER_RANGE_MULTIPLIER = 1.5;
/** Radius within which a flare can seduce an Iskander (derived). */
export const FLARE_SEEKER_RANGE = ISKANDER_FLARE_DETECTION_RANGE * FLARE_SEEKER_RANGE_MULTIPLIER; // 225

/** AI holds flares until the missile is this close: seeker range + ~75u of
 *  closing distance, so fresh flares enter the seeker's grab radius within
 *  ~1s of release instead of burning out while the missile is far away.
 *  Flares are the ONLY Iskander response (its seeker out-turns the bomber
 *  many times over), so this margin is load-bearing for survivability. */
export const AI_FLARE_RELEASE_RANGE = FLARE_SEEKER_RANGE + 75; // 300

/** Iskander boost ceiling — must clear max terrain (60) plus building tops. */
export const ISKANDER_CLIMB_ALTITUDE = 90;

// ---------------------------------------------------------- defense missiles
/** Contract: airburst floor must exceed BOMBER_MAX_ALTITUDE so climbing can
 *  never escape a defense missile (they airburst above the bomber's ceiling). */
export const DEFENSE_MIN_AIRBURST_ALTITUDE = 220;
export const DEFENSE_MAX_ALTITUDE = 280;

// ------------------------------------------------------------ world & camera
export const TERRAIN_CHUNK_SIZE = 900;
export const TERRAIN_KEEP_RADIUS = 2;
export const TERRAIN_GENERATION_THRESHOLD = 300; // < CHUNK_SIZE/2 so it fires near an edge, not always

export const FOG_END = 1500;
/** Far clip — must exceed FOG_END so terrain fully fades to sky before the
 *  clip plane can cut it. */
export const CAMERA_MAX_Z = 1700;

// Invariant from TerrainManager's keep-set geometry: the nearest loaded chunk
// edge must always sit beyond the fog, or the world edge shows as a
// sky-colored bite in the horizon.
const NEAREST_LOADED_EDGE = TERRAIN_KEEP_RADIUS * TERRAIN_CHUNK_SIZE - TERRAIN_GENERATION_THRESHOLD;
if (NEAREST_LOADED_EDGE < FOG_END) {
  throw new Error(
    `Balance invariant violated: keepRadius*chunkSize - generationThreshold (${NEAREST_LOADED_EDGE}) < fogEnd (${FOG_END})`,
  );
}

// ---------------------------------------------------------------------- sky
/** One sky color shared by the scene clearColor, fog color, and the Sun's
 *  baked occlusion disc (which must match the sky exactly or the disc edge
 *  shows as a square). Plain numbers 0..1 — Babylon-free on purpose. */
export const SKY_COLOR = { r: 0.5, g: 0.7, b: 0.9 } as const;
