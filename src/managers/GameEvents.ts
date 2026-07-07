/** The camera's exclusive view mode. 'chase' is the plain bomber follow. */
export type ViewMode = 'chase' | 'rocket' | 'panic';

/**
 * Cross-system event map for EventBus<GameEvents>. Keep this to genuinely
 * discrete transitions — continuous values (cooldowns, health, threat
 * distance) stay polled, and per-frame data feeds stay provider closures.
 */
export interface GameEvents {
  /** Emitted by CameraController.setViewMode after every actual transition. */
  viewModeChanged: { mode: ViewMode };
  /** Emitted by AIController.setEnabled (unconditionally, mirroring the old per-frame backstop). */
  aiEnabledChanged: { enabled: boolean };
}
