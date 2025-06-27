import { Engine, Scene } from '@babylonjs/core';
import { Game } from './game/Game';

// Performance monitoring
class PerformanceMonitor {
    private frameCount: number = 0;
    private lastTime: number = performance.now();
    private fpsDisplay: HTMLElement;

    constructor() {
        this.fpsDisplay = document.createElement('div');
        this.fpsDisplay.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            color: white;
            font-family: monospace;
            font-size: 12px;
            background: rgba(0, 0, 0, 0.7);
            padding: 5px;
            border-radius: 3px;
            z-index: 10000;
        `;
        document.body.appendChild(this.fpsDisplay);
    }

    public update(): void {
        this.frameCount++;
        const currentTime = performance.now();
        
        if (currentTime - this.lastTime >= 1000) {
            const fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastTime));
            this.fpsDisplay.textContent = `FPS: ${fps}`;
            this.frameCount = 0;
            this.lastTime = currentTime;
        }
    }
}

// Initialize performance monitor
const performanceMonitor = new PerformanceMonitor();

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
                console.warn('Babylon Inspector could not be loaded:', error);
            });
        }
    });
}

// Create the game instance
const game = new Game(scene, canvas);

// Initialize the game
game.initialize().then(() => {
    console.log('Game initialized successfully');
}).catch(error => {
    console.error('Failed to initialize game:', error);
});

// Register the render loop
engine.runRenderLoop(() => {
    scene.render();
    performanceMonitor.update();
});

// Handle window resize
window.addEventListener('resize', () => {
    engine.resize();
}); 