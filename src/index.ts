import { Engine, Scene } from '@babylonjs/core';
import { Game } from './managers/Game';

// Get the canvas element
const canvasElement = document.getElementById('renderCanvas');
if (!canvasElement || !(canvasElement instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element not found or is not a canvas');
}
const canvas = canvasElement;

// Create the Babylon.js engine
const engine = new Engine(canvas, true);

// Create the scene
const scene = new Scene(engine);

// Enable Babylon Inspector in development mode
if (process.env.NODE_ENV === 'development') {
    // Add keyboard shortcut for inspector
    window.addEventListener('keydown', (event) => {
        if (event.key === 'F12') {
            event.preventDefault();
            
            // Dynamically import and show inspector
            import('@babylonjs/inspector').then(() => {
                if (scene.debugLayer.isVisible()) {
                    scene.debugLayer.hide();
                } else {
                    scene.debugLayer.show();
                }
            }).catch(error => {
                // Silent error handling - no console logging
            });
        }
    });
}

// Create the game instance
const game = new Game(scene, canvas);

// Initialize the game
game.initialize().then(() => {
    // Silent initialization - no console logging
}).catch(error => {
    // Silent error handling - no console logging
});

// Register the render loop
engine.runRenderLoop(() => {
    scene.render();
});

// Handle window resize
window.addEventListener('resize', () => {
    engine.resize();
}); 