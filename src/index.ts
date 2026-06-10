import { Engine, Scene, SceneInstrumentation, EngineInstrumentation } from '@babylonjs/core';
import { Game } from './managers/Game';

// Get the canvas element
const canvasElement = document.getElementById('renderCanvas');
if (!canvasElement || !(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error('Canvas element not found or is not a canvas');
}
const canvas = canvasElement;

// Create the Babylon.js engine
const engine = new Engine(canvas, true, { powerPreference: 'high-performance' });

// Render at a sensible resolution on high-DPI (mostly mobile) screens; full
// devicePixelRatio rendering quadruples fill-rate cost for little visible gain.
if (window.devicePixelRatio > 1.5) {
  engine.setHardwareScalingLevel(window.devicePixelRatio / 1.5);
}

// Create the scene
const scene = new Scene(engine);

// Enable Babylon Inspector in development mode
if (process.env.NODE_ENV === 'development') {
  // Add keyboard shortcut for inspector
  window.addEventListener('keydown', (event) => {
    if (event.key === 'F12') {
      event.preventDefault();

      // Dynamically import and show inspector
      import('@babylonjs/inspector')
        .then(() => {
          if (scene.debugLayer.isVisible()) {
            scene.debugLayer.hide();
          } else {
            scene.debugLayer.show();
          }
        })
        .catch(() => {
          // Silent error handling - no console logging
        });
    }
  });
}

// Performance probe for measurement runs, enabled with ?perf=1
if (new URLSearchParams(window.location.search).get('perf') === '1') {
  const sceneInstr = new SceneInstrumentation(scene);
  sceneInstr.captureInterFrameTime = true;
  sceneInstr.captureFrameTime = true;
  const engineInstr = new EngineInstrumentation(engine);
  (window as any).__perf = { engine, scene, sceneInstr, engineInstr };
}

// Create the game instance
const game = new Game(scene, canvas);

// Wire up the splash screen: gameplay stays paused until the player taps START
const splashScreen = document.getElementById('splashScreen');
const startButton = document.getElementById('startButton');
startButton?.addEventListener('click', () => {
  game.start();
  if (splashScreen) {
    splashScreen.style.display = 'none';
  }
});

// Initialize the game
game
  .initialize()
  .then(() => {
    // Silent initialization - no console logging
  })
  .catch(() => {
    // Silent error handling - no console logging
  });

// Register the render loop, capped at 60fps. rAF fires at display rate (120Hz+ on
// many devices); rendering every tick would run the whole pipeline at display rate.
// Game logic lives in scene.registerBeforeRender, so this caps logic too.
const targetFrameMs = 1000 / 60;
let lastRenderTime = performance.now();
engine.runRenderLoop(() => {
  const now = performance.now();
  if (now - lastRenderTime < targetFrameMs - 2) {
    return; // ~2ms tolerance absorbs rAF jitter at exactly 60Hz
  }
  lastRenderTime = now - ((now - lastRenderTime) % targetFrameMs);
  scene.render();
});

// Handle window resize
window.addEventListener('resize', () => {
  engine.resize();
});
