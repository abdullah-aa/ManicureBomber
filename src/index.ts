import { Engine, Scene, FreeCamera, Vector3, HemisphericLight, DirectionalLight, Color3 } from '@babylonjs/core';
import { Game } from './game/Game';

class App {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;
    private game: Game;

    constructor() {
        // Get the canvas element
        const canvasElement = document.getElementById('renderCanvas');
        if (!canvasElement || !(canvasElement instanceof HTMLCanvasElement)) {
            throw new Error('Canvas element not found or is not a canvas');
        }
        this.canvas = canvasElement;
        
        // Initialize the Babylon.js engine
        this.engine = new Engine(this.canvas, true);
        
        // Create the scene
        this.scene = new Scene(this.engine);
        
        // Initialize the game
        this.game = new Game(this.scene, this.canvas);
        
        // Start the render loop
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });

        // Handle browser resize
        window.addEventListener('resize', () => {
            this.engine.resize();
        });
    }
}

// Initialize the application
new App(); 