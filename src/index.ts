import { Engine, Scene } from '@babylonjs/core';
import { Game } from './game/Game';

class App {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene!: Scene;
    private game!: Game;

    constructor() {
        const canvasElement = document.getElementById('renderCanvas');
        if (!canvasElement || !(canvasElement instanceof HTMLCanvasElement)) {
            throw new Error('Canvas element not found or is not a canvas');
        }
        this.canvas = canvasElement;
        
        this.engine = new Engine(this.canvas, true);
    }

    async start() {
        this.scene = new Scene(this.engine);
        
        this.game = new Game(this.scene, this.canvas);
        await this.game.initialize();
        
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });

        window.addEventListener('resize', () => {
            this.engine.resize();
        });
    }
}

new App().start(); 