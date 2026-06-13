# ManicureBomber

A browser-based WebGL bomber game built with [Babylon.js](https://www.babylonjs.com/), TypeScript, and webpack. You fly a strategic bomber over procedurally generated terrain, destroy ground targets and SAM launchers, and survive incoming Iskander and defense-missile threats. Flight is **touch-first** (swipe to fly) with a mouse/touch free-camera; the game also ships an **autopilot AI** and a **cinematic missile-chase camera** ("Rocket View").

It is a single-player, client-only application — there is no backend, no networking, and (currently) no audio.

## Tech stack

| Area | Choice |
|---|---|
| 3D engine | `@babylonjs/core` ^8.14 (+ `@babylonjs/inspector` in development) |
| Language | TypeScript ^5, `strict` mode, ES2020 target |
| Bundler | webpack 5 + `ts-loader` + `html-webpack-plugin` |
| Concurrency | three Web Workers (terrain, missile physics, collision) |
| Procedural data | custom `NoiseGenerator` (`src/utils/NoiseGenerator.ts`) |

No external game engine, ECS framework, physics library, or asset pipeline is used — meshes, textures, and particle systems are generated procedurally at runtime.

## Getting started

### Prerequisites

- A modern browser with **WebGL 2.0** and Web Worker support.
- **Node.js + npm** for the dev/build toolchain.

### Install

```bash
git clone https://github.com/abdullah-aa/ManicureBomber.git
cd ManicureBomber
npm install
```

### Develop

```bash
npm run dev     # or: npm start  — webpack-dev-server with HMR
```

The dev server runs on `http://localhost:8080`. Development-only extras:

- **F12** opens the Babylon.js Inspector (wired only when `NODE_ENV === 'development'`, `src/index.ts`).
- Append **`?perf=1`** to the URL to attach Babylon `SceneInstrumentation`/`EngineInstrumentation` to `window.__perf` for frame/draw-call profiling (`src/index.ts`).

### Build, lint, format

```bash
npm run build   # webpack --mode=production -> dist/ (code-split bundles)
npm run lint    # eslint . --ext .ts
npm run format  # prettier --write .
```

> **Build-script caveat:** the `build` script currently also copies the output to `pages/` **and** to a hardcoded absolute path (`~/projects/ManicureBomber/`). The hardcoded copy is specific to one machine and should be removed before other contributors rely on `npm run build`.

## Controls

The game is **touch/mouse only — there are no gameplay keyboard controls.** (The internal `InputManager` maps actions to key codes like `KeyW`/`KeyX`, but those codes are synthesized by on-screen buttons and touch-to-key simulation; no physical keyboard drives gameplay. The only real `keydown` handler is the dev-only F12 inspector toggle.)

| Input | Action |
|---|---|
| **Swipe** the canvas (PLANE mode, default) | Fly: left/right turns & banks, up/down dives/climbs. 20px dead-zone. |
| **🕹️ Bomb** button (bottom-right) | Start a bombing run. |
| **🚀 Missile** button | Fire a Tomahawk at the locked ground target (lights green when a target is locked). |
| **🔥 Flare** button | Release a flare volley (active only while an Iskander is locked on). |
| **🎯 Crosshair** button | Toggle the ground targeting reticle. |
| **⚙️ Settings** gear (top-right) | Open the settings modal (below). Game keeps running. |
| **Mouse drag** (CAMERA mode only) | X = pan camera around the bomber; Y = raise/lower it (vertical is ~3× to match the pan rate). |

The settings modal exposes three toggles:

- **🤖 Autopilot** — enable/disable the AI pilot. Manual flight input temporarily *suspends* (not disables) it.
- **Control Mode (✈️ PLANE / 📹 CAMERA)** — whether a swipe flies the plane or orbits the free-camera. **This is the only camera-mode switch** — the 🎯 button toggles crosshairs, not the camera.
- **🚀 Rocket View** — cinematic missile-chase camera. Only available while Autopilot is on (the row is disabled otherwise).

## Gameplay systems

Tuning constants below are taken directly from the source; file references point at the owning module.

- **Flight** (`src/entities/Bomber.ts`) — banking turns up to **30°**, altitude clamped to **150–200** units (spawns at 175), velocity-based movement with smoothing.
- **Bombing** (`src/managers/Game.ts`) — a run drops **9 bombs**, one per second, after a **1s** bomb-bay door animation; **15s** cooldown. Bombing and missile launches are mutually exclusive.
- **Tomahawk** (`src/entities/TomahawkMissile.ts`) — player cruise missile with a worker-generated curved path and main-thread terminal guidance; **10s** cooldown; fires only at a valid locked target.
- **Flares / countermeasures** (`src/entities/Bomber.ts`) — an **8-flare** volley with a **7s** life and **8s** cooldown; flares are the counter to Iskanders, whose IR seeker detects them within **150** units.
- **Iskander threat** (`src/entities/IskanderMissile.ts`, launch in `Game.ts`) — launched every **30–75s** from the defense launcher **farthest** from the bomber; vertical boost to a **chase altitude of 90** before guidance/lock; **4s** lock-on; proximity damage within **25** units (`max(15, 50 − distance)` on a 100-HP bomber). Defeated by flares, not maneuvering.
- **Defense missiles** (`src/entities/DefenseMissile.ts`) — SAMs fired from launcher buildings; airburst between **220–280** units (deliberately above the bomber's 200 ceiling so you can't out-climb them), speed **120–150** u/s. Velocity stays zero until an async worker trajectory reply arrives (the brief "on-pad" window).
- **Autopilot AI** (`src/managers/AIController.ts`) — a state machine (search / navigate / standoff / extend / bomb-run) that flies to targets, runs bombing passes, fires Tomahawks at launchers, and pops flares when Iskanders close in. It issues commands through the same `InputManager` virtual controls as the player, so all cooldowns and safety gates still apply; manual input yields a short grace-period suspend rather than a hard toggle-off.
- **Rocket View** (`src/managers/CameraController.ts`, candidate selection in `Game.ts`) — an Autopilot-only cinematic camera with a sub-state machine: frames an Iskander launch, hands off to a tail chase once it reaches chase altitude, follows defense missiles caught at the launch instant, and holds on the explosion (~1.5s) before reverting to the bomber.
- **World** (`src/managers/TerrainManager.ts`, `src/entities/Building.ts`) — procedural terrain in **900-unit chunks** (48 subdivisions) kept within a Chebyshev radius of 2 around the bomber, sized so the loaded edge always sits beyond `fogEnd = 1500`. Buildings include residential/commercial/industrial/skyscraper types plus destructible SAM launchers with health and destruction states.
- **Health / damage** — the bomber has a health value shown in the top-right bar (green → yellow → red); damage comes from missile proximity (`src/ui/UIManager.ts`).

## Architecture

### Source layout

```
src/
├── index.ts, index.html        # bootstrap, render-loop pacing, splash, dev hooks
├── entities/                   # Bomb, Bomber, Building, BuildingAssets,
│                               #   DefenseMissile, IskanderMissile, TomahawkMissile
├── managers/                   # AIController, CameraController, Game, InputManager,
│                               #   LightManager, MissileGuidance, TerrainManager, WorkerManager
├── effects/                    # ExplosionPool, EffectTextures
├── ui/                         # UIManager, RadarManager
├── utils/                      # NoiseGenerator
└── workers/                    # terrain, missile-physics, collision-detection (+ worker-utils)
```

The design is a conventional **entity / manager separation** (OOP), not an ECS. Entities own their meshes and per-frame state; managers own cross-cutting systems (input, camera, terrain, workers, AI, UI) and are coordinated by `Game`.

### Web Workers (`src/managers/WorkerManager.ts`)

Three workers handle work that is genuinely heavy or batchable:

- **terrain.worker** — generates chunk heightmaps; the main thread reads back per-coordinate heights.
- **missile-physics.worker** — **one-shot only**: `GENERATE_TOMAHAWK_PATH` and `CALCULATE_DEFENSE_TRAJECTORY`. Per-frame Tomahawk/Iskander guidance was deliberately moved **back onto the main thread** (`src/managers/MissileGuidance.ts`) because the worker round-trip cost more than the math itself.
- **collision-detection.worker** — Iskander and defense-missile collision checks against the bomber.

Workers communicate via structured-clone `postMessage` (no `SharedArrayBuffer`, so no cross-origin-isolation / COOP-COEP requirement).

### Performance patterns

- **Pooling** — `src/managers/LightManager.ts` keeps a fixed pool of scene `PointLight`s with priority-based stealing, TTL auto-release, and generation-stamped handles whose setters no-op after release. `src/effects/ExplosionPool.ts` keeps a per-scene pool of pre-built particle systems re-armed via `manualEmitCount` (with shared procedural textures in `EffectTextures.ts`), pre-warmed at startup.
- **Allocation-free updates** — hot paths use `getPositionRef()/getVelocityRef()/getRotationRef()` instead of cloning, reuse scratch `Vector3`s and a single reused Rocket-View candidate descriptor, and cache trigonometry to avoid per-frame `sin`/`cos`.
- **Frame pacing** — `src/index.ts` caps the render loop to ~60fps (with a small rAF-jitter tolerance) since `requestAnimationFrame` fires at the display rate (120Hz+); game logic lives in `scene.registerBeforeRender`, so this caps logic too.
- **Throttled subsystems** — update intervals are staggered: UI 50ms, radar 100ms, terrain 100ms, defense launchers 50ms, collision checks ~16ms.

## Project status / known gaps

- **No audio.** `src/entities/Bomb.ts` imports Babylon `Sound` and calls `play()`, but the sound is never assigned — audio is effectively stubbed and there are no sound assets.
- **No device detection / responsive branching.** The UI is built the same way on all devices; the only resolution handling is `engine.setHardwareScalingLevel`.
- **Build script** copies to a hardcoded local path (see the build caveat above).
- **Single-player only** — no networking or multiplayer.

Possible future work: audio, additional aircraft, mission/campaign objectives, richer terrain (water/vegetation), and weather.

## License

MIT — see the `LICENSE` file.

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first to discuss the approach.
